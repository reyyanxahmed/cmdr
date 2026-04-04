/**
 * AgentRunner — the core conversation loop engine for cmdr.
 *
 * Drives: LLM call -> tool extraction -> parallel execution -> tool results -> loop
 */

import type {
  LLMMessage, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock,
  ToolCallRecord, TokenUsage, StreamEvent, ToolResult, ToolUseContext,
  LLMAdapter, LLMChatOptions, LLMResponse, ApprovalCallback, LLMToolDef,
} from '../core/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ToolExecutor } from '../tools/executor.js'
import type { PermissionManager } from './permissions.js'
import { classifyIntent, filterToolsByIntent, detectFrustration, FRUSTRATION_NUDGE } from './intent.js'

// ---------------------------------------------------------------------------
// Safe parallel tools — read-only tools that can safely run concurrently
// ---------------------------------------------------------------------------

const SAFE_PARALLEL_TOOLS = new Set([
  'file_read',
  'grep',
  'grep_search',
  'glob',
  'git_diff',
  'git_log',
  'think',
])

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface RunnerOptions {
  readonly model: string
  readonly systemPrompt?: string
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly temperature?: number
  readonly abortSignal?: AbortSignal
  readonly allowedTools?: readonly string[]
  readonly agentName?: string
  readonly agentRole?: string
  readonly cwd?: string
}

export interface RunCallbacks {
  readonly onToolCall?: (name: string, input: Record<string, unknown>) => void
  readonly onToolResult?: (name: string, result: ToolResult) => void
  readonly onMessage?: (message: LLMMessage) => void
  readonly onText?: (text: string) => void
  /** If provided, the runner will ask for approval before executing write/dangerous tools. */
  readonly onToolApproval?: ApprovalCallback
}

export interface RunResult {
  readonly messages: LLMMessage[]
  readonly output: string
  readonly toolCalls: ToolCallRecord[]
  readonly tokenUsage: TokenUsage
  readonly turns: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(content: readonly ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

function extractToolUseBlocks(content: readonly ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
}

function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  }
}

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 }

// ---------------------------------------------------------------------------
// AgentRunner
// ---------------------------------------------------------------------------

export class AgentRunner {
  private readonly maxTurns: number

  constructor(
    private readonly adapter: LLMAdapter,
    private readonly toolRegistry: ToolRegistry,
    private readonly toolExecutor: ToolExecutor,
    private readonly options: RunnerOptions,
    private readonly permissionManager?: PermissionManager,
  ) {
    this.maxTurns = options.maxTurns ?? 10
  }

  /** Run a complete conversation, collecting all stream events internally. */
  async run(messages: LLMMessage[], callbacks: RunCallbacks = {}): Promise<RunResult> {
    let result: RunResult = {
      messages: [],
      output: '',
      toolCalls: [],
      tokenUsage: ZERO_USAGE,
      turns: 0,
    }

    for await (const event of this.stream(messages, callbacks)) {
      if (event.type === 'done') {
        result = event.data as RunResult
      }
    }

    return result
  }

  /** Run the conversation and yield StreamEvents incrementally.
   *  Uses the adapter's stream() for real-time token-by-token output. */
  async *stream(
    initialMessages: LLMMessage[],
    callbacks: RunCallbacks = {},
  ): AsyncGenerator<StreamEvent> {
    const conversationMessages: LLMMessage[] = [...initialMessages]

    let totalUsage: TokenUsage = ZERO_USAGE
    const allToolCalls: ToolCallRecord[] = []
    let finalOutput = ''
    let turns = 0

    // Build the full tool set (may be narrowed per-turn by intent)
    const allDefs = this.toolRegistry.toToolDefs()
    const fullToolDefs = this.options.allowedTools
      ? allDefs.filter(d => this.options.allowedTools!.includes(d.name))
      : allDefs

    // Extract latest user text for intent classification
    const lastUserMsg = [...conversationMessages]
      .reverse()
      .find(m => m.role === 'user')
    const lastUserText = lastUserMsg
      ? lastUserMsg.content
          .filter((b): b is TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')
      : ''
    const intent = classifyIntent(lastUserText)
    const frustrated = detectFrustration(lastUserText)

    // If user is frustrated, inject a nudge as a transient system-level hint
    if (frustrated && lastUserMsg) {
      conversationMessages.push({
        role: 'user',
        content: [{ type: 'text', text: FRUSTRATION_NUDGE }],
        isMeta: true,
      })
    }

    try {
      while (true) {
        if (this.options.abortSignal?.aborted) break
        if (turns >= this.maxTurns) break

        turns++

        // Dynamic tool injection:
        // Turn 1 uses intent-filtered tools (may be empty for chat).
        // Turns 2+ (model is mid-agentic-loop after tool results) get full tools.
        const turnTools: LLMToolDef[] = turns === 1
          ? filterToolsByIntent(intent, fullToolDefs)
          : fullToolDefs

        const turnChatOptions: LLMChatOptions = {
          model: this.options.model,
          tools: turnTools.length > 0 ? turnTools : undefined,
          maxTokens: this.options.maxTokens,
          temperature: this.options.temperature,
          systemPrompt: this.options.systemPrompt,
          abortSignal: this.options.abortSignal,
        }

        // Step 1: Stream from LLM — yield text tokens in real-time
        const turnContent: ContentBlock[] = []
        let turnText = ''
        const pendingToolUse: ToolUseBlock[] = []
        let turnUsage: TokenUsage = ZERO_USAGE

        for await (const event of this.adapter.stream(conversationMessages, turnChatOptions)) {
          if (event.type === 'text') {
            const chunk = event.data as string
            turnText += chunk
            yield { type: 'text', data: chunk }
            callbacks.onText?.(chunk)
          } else if (event.type === 'tool_use') {
            const block = event.data as ToolUseBlock
            pendingToolUse.push(block)
            yield { type: 'tool_use', data: block }
          } else if (event.type === 'done') {
            const response = event.data as LLMResponse
            turnUsage = response.usage
          } else if (event.type === 'error') {
            yield event
            return
          }
        }

        totalUsage = addTokenUsage(totalUsage, turnUsage)

        // Build assistant content blocks
        if (turnText) {
          turnContent.push({ type: 'text', text: turnText } as TextBlock)
        }
        for (const block of pendingToolUse) {
          turnContent.push(block)
        }

        // Step 2: Build assistant message
        const assistantMessage: LLMMessage = {
          role: 'assistant',
          content: turnContent,
        }
        conversationMessages.push(assistantMessage)
        callbacks.onMessage?.(assistantMessage)

        // Step 3: No tools? We're done.
        if (pendingToolUse.length === 0) {
          finalOutput = turnText
          break
        }

        // Step 4: Execute tool calls — parallelize safe read-only tools,
        // execute write/dangerous tools sequentially.
        const toolContext: ToolUseContext = {
          agent: {
            name: this.options.agentName ?? 'cmdr',
            role: this.options.agentRole ?? 'assistant',
            model: this.options.model,
          },
          cwd: this.options.cwd,
          abortSignal: this.options.abortSignal,
        }

        const allSafe = pendingToolUse.every(tc => SAFE_PARALLEL_TOOLS.has(tc.name))

        const executeOne = async (block: ToolUseBlock) => {
          callbacks.onToolCall?.(block.name, block.input)

          // --- HITL gate: check permissions before executing ---
          if (this.permissionManager && callbacks.onToolApproval) {
            const decision = await this.permissionManager.gate(
              block.name,
              block.input,
              callbacks.onToolApproval,
            )
            if (decision === 'deny') {
              const deniedResult: ToolResult = {
                data: `Tool "${block.name}" was denied by the user.`,
                isError: true,
              }
              callbacks.onToolResult?.(block.name, deniedResult)
              const resultBlock: ToolResultBlock = {
                type: 'tool_result',
                tool_use_id: block.id,
                content: deniedResult.data,
                is_error: true,
              }
              return { resultBlock, record: {
                toolName: block.name,
                input: block.input,
                output: deniedResult.data,
                duration: 0,
              } as ToolCallRecord }
            }
          }

          const startTime = Date.now()
          let result: ToolResult

          try {
            result = await this.toolExecutor.execute(block.name, block.input, toolContext)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            result = { data: message, isError: true }
          }

          const duration = Date.now() - startTime
          callbacks.onToolResult?.(block.name, result)

          const record: ToolCallRecord = {
            toolName: block.name,
            input: block.input,
            output: result.data,
            duration,
          }

          const resultBlock: ToolResultBlock = {
            type: 'tool_result',
            tool_use_id: block.id,
            content: result.data,
            is_error: result.isError,
          }

          return { resultBlock, record }
        }

        let executions: { resultBlock: ToolResultBlock; record: ToolCallRecord }[]

        if (allSafe) {
          // All tools are read-only — execute in parallel
          executions = await Promise.all(pendingToolUse.map(executeOne))
        } else {
          // Mixed or write tools — execute sequentially for safety
          executions = []
          for (const block of pendingToolUse) {
            executions.push(await executeOne(block))
          }
        }

        // Step 5: Accumulate results
        const toolResultBlocks: ContentBlock[] = executions.map(e => e.resultBlock)

        for (const { record, resultBlock } of executions) {
          allToolCalls.push(record)
          yield { type: 'tool_result', data: resultBlock }
        }

        const toolResultMessage: LLMMessage = {
          role: 'user',
          content: toolResultBlocks,
        }

        conversationMessages.push(toolResultMessage)
        callbacks.onMessage?.(toolResultMessage)

        // Loop back — send updated conversation to LLM
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      yield { type: 'error', data: error }
      return
    }

    // If loop exited due to maxTurns, use last text
    if (finalOutput === '' && conversationMessages.length > 0) {
      const lastAssistant = [...conversationMessages]
        .reverse()
        .find(m => m.role === 'assistant')
      if (lastAssistant) {
        finalOutput = extractText(lastAssistant.content)
      }
    }

    const runResult: RunResult = {
      messages: conversationMessages.slice(initialMessages.length),
      output: finalOutput,
      toolCalls: allToolCalls,
      tokenUsage: totalUsage,
      turns,
    }

    yield { type: 'done', data: runResult }
  }
}
