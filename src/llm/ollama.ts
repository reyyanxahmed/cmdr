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
import { getDefaultContextLength, TOOL_CAPABLE_FAMILIES } from './model-registry.js'

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
// Per-model-family configuration
// ---------------------------------------------------------------------------

interface ModelFamilyConfig {
  supportsNativeTools: boolean
  needsPromptInjection: boolean
  thinkingMode: 'auto' | 'disabled' | 'strip'
  xmlToolFormat: boolean      // Parse <function=name> XML in text output
  jsonToolFormat: boolean     // Parse ```tool_call JSON in text output
}

const MODEL_FAMILY_CONFIGS: Record<string, ModelFamilyConfig> = {
  qwen2:    { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  'qwen2.5': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  qwen3:    { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  qwen3moe: { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  gemma4:   { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'disabled', xmlToolFormat: false, jsonToolFormat: true },
  'llama3.1': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'llama3.2': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'llama3.3': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  llama4:   { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  mistral:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'mistral-nemo': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'command-r': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  minimax:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  deepseek: { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  dolphin:  { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  phi:      { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  gemma:    { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  granite:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  nemotron: { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  hermes3:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  yi:       { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  default:  { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
}

/** Resolve the family config for a detected model family string. */
function getFamilyConfig(family: string): ModelFamilyConfig {
  // Exact match first
  if (MODEL_FAMILY_CONFIGS[family]) return MODEL_FAMILY_CONFIGS[family]
  // Prefix match (e.g. 'qwen3-coder' matches 'qwen3')
  for (const key of Object.keys(MODEL_FAMILY_CONFIGS)) {
    if (key !== 'default' && family.startsWith(key)) return MODEL_FAMILY_CONFIGS[key]
  }
  return MODEL_FAMILY_CONFIGS.default
}

/** Strip thinking channel markers from model output. */
function stripThinkingMarkers(text: string): string {
  return text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '').replace(/<channel\|>/g, '')
}

// ---------------------------------------------------------------------------
// OllamaAdapter
// ---------------------------------------------------------------------------

export class OllamaAdapter implements LLMAdapter {
  readonly name = 'ollama'
  private readonly baseUrl: string
  private familyCache = new Map<string, string>()

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

  /** Detect the model family via Ollama /api/show (cached). */
  async getModelFamily(model: string): Promise<string> {
    const cached = this.familyCache.get(model)
    if (cached !== undefined) return cached

    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      })

      if (!res.ok) {
        this.familyCache.set(model, 'unknown')
        return 'unknown'
      }

      const info = await res.json() as OllamaModelInfo
      const family = info.details?.family?.toLowerCase() ?? 'unknown'
      this.familyCache.set(model, family)
      return family
    } catch {
      this.familyCache.set(model, 'unknown')
      return 'unknown'
    }
  }

  /** Check if a specific model supports native tool calling. */
  async supportsTools(model: string): Promise<boolean> {
    const family = await this.getModelFamily(model)
    return getFamilyConfig(family).supportsNativeTools
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.chat
  // -----------------------------------------------------------------------

  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> {
    const hasTools = options.tools && options.tools.length > 0
    const family = await this.getModelFamily(options.model)
    const config = getFamilyConfig(family)
    const supportsNativeTools = hasTools ? config.supportsNativeTools : false
    const needsInjection = hasTools ? (!supportsNativeTools || config.needsPromptInjection) : false

    const contextLength = getDefaultContextLength(options.model)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt, needsInjection ? options.tools : undefined),
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

    // Thinking mode: user override > model family default
    if (options.thinkingEnabled === false) {
      body.think = false
    } else if (options.thinkingEnabled === true) {
      body.think = true
    } else if (config.thinkingMode === 'disabled') {
      body.think = false
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      })
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      throw new Error(`Ollama request failed: ${msg} (model=${options.model}, num_ctx=${contextLength})`)
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama API error (${res.status}): ${text.slice(0, 300)}`)
    }

    const data = await res.json() as OllamaChatResponse

    // Strip thinking channel markers from content
    const rawContent = stripThinkingMarkers(data.message.content || '')

    // Three-stage tool resolution waterfall (runs for ALL models)
    const content: ContentBlock[] = this.resolveToolCalls(
      data.message.tool_calls ?? null,
      rawContent,
      config,
      hasTools ?? false,
    )

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
    const family = await this.getModelFamily(options.model)
    const config = getFamilyConfig(family)
    const supportsNativeTools = hasTools ? config.supportsNativeTools : false
    const needsInjection = hasTools ? (!supportsNativeTools || config.needsPromptInjection) : false

    const contextLength = getDefaultContextLength(options.model)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt, needsInjection ? options.tools : undefined),
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

    // Thinking mode: user override > model family default
    if (options.thinkingEnabled === false) {
      body.think = false
    } else if (options.thinkingEnabled === true) {
      body.think = true
    } else if (config.thinkingMode === 'disabled') {
      body.think = false
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      })
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      yield { type: 'error', data: new Error(`Ollama request failed: ${msg} (model=${options.model}, num_ctx=${contextLength})`) }
      return
    }

    if (!res.ok) {
      const text = await res.text()
      yield { type: 'error', data: new Error(`Ollama API error (${res.status}): ${text.slice(0, 300)}`) }
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
            // Strip thinking channel markers from streamed content
            const cleaned = stripThinkingMarkers(chunk.message.content)
            if (cleaned) {
              fullText += cleaned
              yield { type: 'text', data: cleaned }
            }
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

    // Fallback: three-stage waterfall for text-based tool calls if no native calls were emitted
    if (hasTools && fullText && !nativeToolCallsEmitted) {
      const resolved = this.resolveToolCalls(null, fullText, config, true)
      const toolBlocks = resolved.filter(b => b.type === 'tool_use')
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

To call MULTIPLE tools, use one JSON object per line inside a single \`\`\`tool_call block:

\`\`\`tool_call
{"name": "tool1", "arguments": {"arg": "val"}}
{"name": "tool2", "arguments": {"arg": "val"}}
\`\`\`

Available tools:
${toolDescs}

IMPORTANT: Use ONLY the \`\`\`tool_call JSON format shown above. Do NOT use XML, <invoke>, <function>, or any other format for tool calls.
Always use tools when you need to interact with the filesystem or run commands.
After receiving a tool result, continue your analysis.`
  }

  /**
   * Three-stage tool resolution waterfall.
   * Runs for ALL models regardless of native tool support.
   */
  private resolveToolCalls(
    nativeToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> | null,
    textContent: string,
    config: ModelFamilyConfig,
    hasTools: boolean,
  ): ContentBlock[] {
    // Stage 1: Native tool_calls from Ollama response
    if (nativeToolCalls && nativeToolCalls.length > 0) {
      const content: ContentBlock[] = []
      if (textContent) {
        content.push({ type: 'text', text: textContent } as TextBlock)
      }
      for (const tc of nativeToolCalls) {
        content.push({
          type: 'tool_use',
          id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function.name,
          input: tc.function.arguments,
        } as ToolUseBlock)
      }
      return content
    }

    // Stage 2+3: Parse text-based tool calls only if we had tools available
    if (hasTools && textContent) {
      const parsed = this.parsePromptBasedToolCalls(textContent, config)
      if (parsed.length > 0) return parsed
    }

    // No tool calls — return as pure text
    if (textContent) {
      return [{ type: 'text', text: textContent } as TextBlock]
    }
    return []
  }

  private parsePromptBasedToolCalls(text: string, config?: ModelFamilyConfig): ContentBlock[] {
    const content: ContentBlock[] = []
    const checkJson = config?.jsonToolFormat !== false  // default true
    const checkXml = config?.xmlToolFormat !== false    // default true

    // Strategy 1: ```tool_call\n{JSON}\n``` format (supports multiple JSON objects per block)
    if (checkJson) {
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

        const blockContent = match[1].trim()
        const parsedObjects = this.parseMultipleJsonObjects(blockContent)

        if (parsedObjects.length > 0) {
          for (const parsed of parsedObjects) {
            if (parsed.name && parsed.arguments) {
              content.push({
                type: 'tool_use',
                id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: parsed.name,
                input: parsed.arguments,
              })
            }
          }
        } else {
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
    }

    // Strategy 2: XML <function=name><parameter=key>value</parameter></function> format
    if (checkXml) {
      const xmlToolRegex = /<function=(\w+)>([\s\S]*?)<\/function>/g
      const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g
      let lastIndex = 0
      let match: RegExpExecArray | null
      let foundToolCalls = false

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
    }

    // Strategy 3: <invoke name="..."><parameter name="...">value</parameter></invoke> format
    // Handles minimax <minimax:tool_call> and similar XML tool-call dialects
    const invokeRegex = /<invoke\s+name="([^"]+)">((?:.|\n)*?)<\/invoke>/g
    const invokeParamRegex = /<parameter\s+name="([^"]+)">((?:.|\n)*?)<\/parameter>/g
    let invokeLastIndex = 0
    let invokeMatch: RegExpExecArray | null
    let invokeFoundToolCalls = false

    while ((invokeMatch = invokeRegex.exec(text)) !== null) {
      invokeFoundToolCalls = true
      if (invokeMatch.index > invokeLastIndex) {
        const before = text.slice(invokeLastIndex, invokeMatch.index).trim()
        // Skip wrapper tags like <minimax:tool_call>
        const cleaned = before.replace(/<\/?[\w:]+>/g, '').trim()
        if (cleaned) content.push({ type: 'text', text: cleaned })
      }

      const toolName = invokeMatch[1]
      const paramsBlock = invokeMatch[2]
      const input: Record<string, string> = {}

      let paramMatch: RegExpExecArray | null
      while ((paramMatch = invokeParamRegex.exec(paramsBlock)) !== null) {
        input[paramMatch[1]] = paramMatch[2].trim()
      }
      invokeParamRegex.lastIndex = 0

      content.push({
        type: 'tool_use',
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: toolName,
        input,
      })

      invokeLastIndex = invokeMatch.index + invokeMatch[0].length
    }

    if (invokeFoundToolCalls) {
      if (invokeLastIndex < text.length) {
        // Strip closing wrapper tags
        const remainder = text.slice(invokeLastIndex).replace(/<\/?[\w:]+>/g, '').trim()
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

  /**
   * Parse multiple JSON objects from a block that may contain one object per line,
   * or a JSON array, or comma-separated objects.
   */
  private parseMultipleJsonObjects(block: string): Array<{ name: string; arguments: Record<string, unknown> }> {
    const results: Array<{ name: string; arguments: Record<string, unknown> }> = []

    // Try 1: Single JSON object
    try {
      const parsed = JSON.parse(block)
      if (parsed.name && parsed.arguments) {
        results.push(parsed)
        return results
      }
      // Could be an array
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.name && item.arguments) results.push(item)
        }
        if (results.length > 0) return results
      }
    } catch {
      // Not valid single JSON — try multi-line
    }

    // Try 2: One JSON object per line
    const lines = block.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('{')) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed.name && parsed.arguments) {
          results.push(parsed)
        }
      } catch {
        // Try stripping trailing comma
        const noComma = trimmed.replace(/,\s*$/, '')
        try {
          const parsed = JSON.parse(noComma)
          if (parsed.name && parsed.arguments) {
            results.push(parsed)
          }
        } catch {
          // Skip unparseable line
        }
      }
    }

    return results
  }
}
