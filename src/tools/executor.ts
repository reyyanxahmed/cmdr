/**
 * Tool executor with concurrency control, Zod validation, and error isolation.
 *
 * Mirrors Claude Code's tool execution flow:
 * 1. Tool lookup (with unknown tool rejection)
 * 2. Zod schema validation (with corrective error messages)
 * 3. Concurrency-limited execution
 * 4. Error isolation (tool failures don't crash the agent loop)
 */

import type { ToolResult, ToolUseContext } from '../core/types.js'
import type { ToolRegistry } from './registry.js'
import { validateToolInput } from '../llm/validation/tool-call-schema.js'

export interface ToolExecutorOptions {
  maxConcurrency?: number
}

export interface BatchToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export class ToolExecutor {
  private readonly registry: ToolRegistry
  private active = 0
  private readonly maxConcurrency: number
  private readonly waitQueue: Array<() => void> = []

  constructor(registry: ToolRegistry, options: ToolExecutorOptions = {}) {
    this.registry = registry
    this.maxConcurrency = options.maxConcurrency ?? 4
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolUseContext,
  ): Promise<ToolResult> {
    const tool = this.registry.get(name)
    if (!tool) {
      const availableTools = this.registry.list().map(t => t.name).join(', ')
      return {
        data: `Unknown tool: "${name}". Available tools: ${availableTools}`,
        isError: true,
      }
    }

    // Validate input through Zod schema with corrective error messages
    const validation = validateToolInput(name, input, tool.inputSchema)
    if (!validation.ok) {
      return { data: validation.message, isError: true }
    }

    try {
      await this.acquire()
      try {
        return await tool.execute(validation.parsed, context)
      } finally {
        this.release()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { data: `Tool "${name}" execution error: ${message}`, isError: true }
    }
  }

  async executeBatch(
    calls: BatchToolCall[],
    context: ToolUseContext,
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>()
    const promises = calls.map(async (call) => {
      const result = await this.execute(call.name, call.input, context)
      results.set(call.id, result)
    })
    await Promise.all(promises)
    return results
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.waitQueue.shift()
    if (next) next()
  }
}
