/**
 * SessionManager — conversation history with token counting and compaction.
 */

import type { LLMMessage, LLMAdapter, SessionState, ProjectContext, TokenUsage } from '../core/types.js'
import { countMessageTokens } from '../llm/token-counter.js'
import {
  shouldCompact as checkCompact,
  compactHistory,
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
} from './compaction.js'

export class SessionManager {
  private session: SessionState
  private compactionConfig: CompactionConfig

  constructor(projectContext: ProjectContext, maxContextTokens = 32768) {
    this.session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      messages: [],
      tokenCount: 0,
      maxContextTokens,
      projectContext,
      createdAt: new Date(),
      lastActivity: new Date(),
    }
    this.compactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      maxContextTokens,
    }
  }

  get id(): string { return this.session.id }
  get messages(): LLMMessage[] { return this.session.messages }
  get tokenCount(): number { return this.session.tokenCount }
  get projectContext(): ProjectContext { return this.session.projectContext }

  addMessage(message: LLMMessage): void {
    this.session.messages.push(message)
    this.session.tokenCount = countMessageTokens(this.session.messages as any)
    this.session.lastActivity = new Date()
  }

  addMessages(messages: LLMMessage[]): void {
    for (const msg of messages) {
      this.session.messages.push(msg)
    }
    this.session.tokenCount = countMessageTokens(this.session.messages as any)
    this.session.lastActivity = new Date()
  }

  shouldCompact(): boolean {
    return checkCompact(this.session.messages, this.session.tokenCount, this.compactionConfig)
  }

  /**
   * Multi-stage compaction: truncate tool results → LLM summary → hard truncation.
   * Returns the number of tokens saved.
   */
  async compact(adapter: LLMAdapter, model: string): Promise<{ before: number; after: number; tokensSaved: number }> {
    const before = this.session.tokenCount
    const beforeCount = this.session.messages.length

    const result = await compactHistory(
      this.session.messages,
      this.compactionConfig,
      adapter,
      model,
    )

    this.session.messages = result.messages
    this.session.tokenCount = countMessageTokens(this.session.messages as any)

    return {
      before: beforeCount,
      after: this.session.messages.length,
      tokensSaved: result.tokensSaved,
    }
  }

  clear(): void {
    this.session.messages = []
    this.session.tokenCount = 0
  }

  /** Update the max context tokens (e.g. after switching models). */
  updateContextLength(maxContextTokens: number): void {
    this.session.maxContextTokens = maxContextTokens
    this.compactionConfig = {
      ...this.compactionConfig,
      maxContextTokens,
    }
  }

  getTokenUsage(): TokenUsage {
    return {
      input_tokens: this.session.tokenCount,
      output_tokens: 0,
    }
  }

  getState(): SessionState {
    return { ...this.session }
  }

  addRelevantFile(file: string): void {
    if (!this.session.projectContext.relevantFiles.includes(file)) {
      this.session.projectContext.relevantFiles.push(file)
    }
  }

  /** Replace session messages with the agent's current history. */
  syncFromAgent(messages: LLMMessage[]): void {
    this.session.messages = [...messages]
    this.session.tokenCount = countMessageTokens(this.session.messages as any)
    this.session.lastActivity = new Date()
  }
}
