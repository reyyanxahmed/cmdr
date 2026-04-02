/**
 * Tool executor with concurrency control and error isolation.
 */

import type { ToolResult, ToolUseContext } from '../core/types.js'
import type { ToolRegistry } from './registry.js'

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
      return { data: `Unknown tool: "${name}"`, isError: true }
    }

    try {
      const parsed = tool.inputSchema.parse(input)
      await this.acquire()
      try {
        return await tool.execute(parsed, context)
      } finally {
        this.release()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { data: `Tool "${name}" error: ${message}`, isError: true }
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
