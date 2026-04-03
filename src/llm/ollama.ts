/**
 * OllamaAdapter — primary LLM backend for cmdr.
 *
 * Uses Ollama's /api/chat endpoint with native tool calling support.
 * Falls back to prompt-based tool injection for models without tool support.
 */

import type {
  LLMAdapter, LLMMessage, LLMChatOptions, LLMStreamOptions,
  LLMResponse, StreamEvent, ContentBlock, TextBlock,
  ToolUseBlock, LLMToolDef, TokenUsage,
} from '../core/types.js'
import { getDefaultContextLength } from './model-registry.js'

// ---------------------------------------------------------------------------
// Types for Ollama API responses
// ---------------------------------------------------------------------------

interface OllamaChatResponse {
  model: string
  message: {
    role: string
    content: string
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> }
    }>
  }
  done: boolean
  total_duration?: number
  prompt_eval_count?: number
  eval_count?: number
}

interface OllamaModelInfo {
  modelfile: string
  parameters: string
  template: string
  details: {
    family: string
    parameter_size: string
    quantization_level: string
  }
  model_info?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Models known to support native tool calling via Ollama
// ---------------------------------------------------------------------------

const TOOL_CAPABLE_FAMILIES = new Set([
  'qwen2', 'qwen2.5', 'qwen3', 'qwen3moe',
  'llama3.1', 'llama3.2', 'llama3.3', 'llama4',
  'mistral', 'mistral-nemo', 'command-r', 'firefunction',
  'granite', 'nemotron', 'hermes3',
  'minimax',
])

// ---------------------------------------------------------------------------
// OllamaAdapter
// ---------------------------------------------------------------------------

export class OllamaAdapter implements LLMAdapter {
  readonly name = 'ollama'
  private readonly baseUrl: string
  private toolCapabilityCache = new Map<string, boolean>()

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** Check if Ollama is running and reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      return res.ok
    } catch {
      return false
    }
  }

  /** List available models. */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`)
    const data = await res.json() as { models: Array<{ name: string }> }
    return data.models.map(m => m.name)
  }

  /** Check if a specific model supports native tool calling. */
  async supportsTools(model: string): Promise<boolean> {
    const cached = this.toolCapabilityCache.get(model)
    if (cached !== undefined) return cached

    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      })

      if (!res.ok) {
        this.toolCapabilityCache.set(model, false)
        return false
      }

      const info = await res.json() as OllamaModelInfo
      const family = info.details?.family?.toLowerCase() ?? ''

      const supports = TOOL_CAPABLE_FAMILIES.has(family) ||
        family.includes('qwen') ||
        family.includes('llama3') ||
        family.includes('llama4') ||
        family.includes('mistral') ||
        family.includes('gemma')

      this.toolCapabilityCache.set(model, supports)
      return supports
    } catch {
      this.toolCapabilityCache.set(model, false)
      return false
    }
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.chat
  // -----------------------------------------------------------------------

  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> {
    const hasTools = options.tools && options.tools.length > 0
    const supportsNativeTools = hasTools ? await this.supportsTools(options.model) : false

    const contextLength = getDefaultContextLength(options.model)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt, !supportsNativeTools && hasTools ? options.tools : undefined),
      stream: false,
      options: {
        num_ctx: contextLength,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
      },
    }

    if (supportsNativeTools && options.tools) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.abortSignal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama /api/chat failed (${res.status}): ${text}`)
    }

    const data = await res.json() as OllamaChatResponse

    // Parse response - handle both native tool calls and prompt-based tool calls
    const content: ContentBlock[] = []

    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      // Native tool calling response
      if (data.message.content) {
        content.push({ type: 'text', text: data.message.content } as TextBlock)
      }
      for (const tc of data.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function.name,
          input: tc.function.arguments,
        } as ToolUseBlock)
      }
    } else if (hasTools && data.message.content) {
      // Parse prompt-based tool calls from text (fallback for all models)
      const parsed = this.parsePromptBasedToolCalls(data.message.content)
      content.push(...parsed)
    } else {
      content.push({ type: 'text', text: data.message.content || '' } as TextBlock)
    }

    const usage: TokenUsage = {
      input_tokens: data.prompt_eval_count ?? 0,
      output_tokens: data.eval_count ?? 0,
    }

    const hasToolUse = content.some(b => b.type === 'tool_use')

    return {
      id: `ollama_${Date.now()}`,
      content,
      model: data.model,
      stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
      usage,
    }
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.stream
  // -----------------------------------------------------------------------

  async *stream(messages: LLMMessage[], options: LLMStreamOptions): AsyncIterable<StreamEvent> {
    const hasTools = options.tools && options.tools.length > 0
    const supportsNativeTools = hasTools ? await this.supportsTools(options.model) : false

    const contextLength = getDefaultContextLength(options.model)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt, !supportsNativeTools && hasTools ? options.tools : undefined),
      stream: true,
      options: {
        num_ctx: contextLength,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
      },
    }

    if (supportsNativeTools && options.tools) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.abortSignal,
    })

    if (!res.ok) {
      const text = await res.text()
      yield { type: 'error', data: new Error(`Ollama stream failed (${res.status}): ${text}`) }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      yield { type: 'error', data: new Error('No response body from Ollama') }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let model = options.model
    let nativeToolCallsEmitted = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          let chunk: OllamaChatResponse
          try {
            chunk = JSON.parse(line)
          } catch {
            continue
          }

          model = chunk.model

          if (chunk.message?.content) {
            fullText += chunk.message.content
            yield { type: 'text', data: chunk.message.content }
          }

          if (chunk.message?.tool_calls) {
            nativeToolCallsEmitted = true
            for (const tc of chunk.message.tool_calls) {
              yield {
                type: 'tool_use',
                data: {
                  type: 'tool_use',
                  id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function.name,
                  input: tc.function.arguments,
                },
              }
            }
          }

          if (chunk.done) {
            totalInputTokens = chunk.prompt_eval_count ?? 0
            totalOutputTokens = chunk.eval_count ?? 0
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Fallback: parse prompt-based tool calls from text if no native tool calls were emitted
    if (hasTools && fullText && !nativeToolCallsEmitted) {
      const parsed = this.parsePromptBasedToolCalls(fullText)
      const toolBlocks = parsed.filter(b => b.type === 'tool_use')
      if (toolBlocks.length > 0) {
        for (const block of toolBlocks) {
          yield { type: 'tool_use', data: block }
        }
      }
    }

    const finalContent: ContentBlock[] = fullText
      ? [{ type: 'text', text: fullText }]
      : []

    const response: LLMResponse = {
      id: `ollama_${Date.now()}`,
      content: finalContent,
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    }

    yield { type: 'done', data: response }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string,
    fallbackTools?: readonly LLMToolDef[],
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = []

    // System prompt
    let sysContent = systemPrompt || ''
    if (fallbackTools && fallbackTools.length > 0) {
      sysContent += this.buildToolPromptSuffix(fallbackTools)
    }
    if (sysContent) {
      result.push({ role: 'system', content: sysContent })
    }

    // Conversation messages
    for (const msg of messages) {
      if (msg.role === 'user') {
        const textParts: string[] = []
        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text)
          } else if (block.type === 'tool_result') {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.content,
            })
          }
        }

        if (toolResults.length > 0) {
          // Ollama expects tool results as separate messages with role 'tool'
          for (const tr of toolResults) {
            result.push({ role: 'tool', content: tr.content })
          }
        } else {
          result.push({ role: 'user', content: textParts.join('\n') })
        }
      } else if (msg.role === 'assistant') {
        const text = msg.content
          .filter((b): b is TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')

        const toolCalls = msg.content
          .filter((b): b is ToolUseBlock => b.type === 'tool_use')
          .map(b => ({
            function: { name: b.name, arguments: b.input },
          }))

        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: text,
        }
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls
        }
        result.push(assistantMsg)
      }
    }

    return result
  }

  private convertToolDef(tool: LLMToolDef): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }
  }

  private buildToolPromptSuffix(tools: readonly LLMToolDef[]): string {
    const toolDescs = tools.map(t =>
      `- ${t.name}: ${t.description}\n  Input: ${JSON.stringify(t.inputSchema)}`
    ).join('\n')

    return `\n\nYou have access to the following tools. To use a tool, respond with a JSON block:

\`\`\`tool_call
{"name": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

Available tools:
${toolDescs}

Always use tools when you need to interact with the filesystem or run commands.
After receiving a tool result, continue your analysis.`
  }

  private parsePromptBasedToolCalls(text: string): ContentBlock[] {
    const content: ContentBlock[] = []

    // Strategy 1: ```tool_call\n{JSON}\n``` format
    const toolCallRegex = /```tool_call\s*\n([\s\S]*?)\n```/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    let foundToolCalls = false

    while ((match = toolCallRegex.exec(text)) !== null) {
      foundToolCalls = true
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index).trim()
        if (before) content.push({ type: 'text', text: before })
      }

      try {
        const parsed = JSON.parse(match[1])
        if (parsed.name && parsed.arguments) {
          content.push({
            type: 'tool_use',
            id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            input: parsed.arguments,
          })
        }
      } catch {
        content.push({ type: 'text', text: match[0] })
      }

      lastIndex = match.index + match[0].length
    }

    if (foundToolCalls) {
      if (lastIndex < text.length) {
        const remainder = text.slice(lastIndex).trim()
        if (remainder) content.push({ type: 'text', text: remainder })
      }
      return content
    }

    // Strategy 2: XML <function=name><parameter=key>value</parameter></function> format
    const xmlToolRegex = /<function=(\w+)>([\s\S]*?)<\/function>/g
    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g
    lastIndex = 0

    while ((match = xmlToolRegex.exec(text)) !== null) {
      foundToolCalls = true
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index).trim()
        if (before) content.push({ type: 'text', text: before })
      }

      const toolName = match[1]
      const paramsBlock = match[2]
      const input: Record<string, string> = {}

      let paramMatch: RegExpExecArray | null
      while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
        input[paramMatch[1]] = paramMatch[2].trim()
      }
      paramRegex.lastIndex = 0 // Reset for next tool call

      content.push({
        type: 'tool_use',
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: toolName,
        input,
      })

      lastIndex = match.index + match[0].length
    }

    if (foundToolCalls) {
      if (lastIndex < text.length) {
        const remainder = text.slice(lastIndex).trim()
        if (remainder) content.push({ type: 'text', text: remainder })
      }
      return content
    }

    // No tool calls found — return as pure text
    if (text) {
      content.push({ type: 'text', text })
    }

    return content
  }
}
