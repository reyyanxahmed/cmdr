/**
 * SessionManager — conversation history with token counting and compaction.
 */

import type { LLMMessage, SessionState, ProjectContext, TokenUsage } from '../core/types.js'
import { countMessageTokens } from '../llm/token-counter.js'

export class SessionManager {
  private session: SessionState

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
    return this.session.tokenCount > this.session.maxContextTokens * 0.85
  }

  /** Compact old messages, keeping the most recent exchanges intact. */
  compact(keepRecentTurns = 6): void {
    const msgs = this.session.messages
    if (msgs.length <= keepRecentTurns * 2) return

    // Keep the most recent turns
    const keepCount = keepRecentTurns * 2
    const toSummarize = msgs.slice(0, msgs.length - keepCount)
    const toKeep = msgs.slice(msgs.length - keepCount)

    // Build a summary of old messages
    const summaryParts: string[] = ['[Previous conversation summary]']
    for (const msg of toSummarize) {
      const text = msg.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text)
        .join('')
        .slice(0, 200)
      if (text) {
        summaryParts.push(`${msg.role}: ${text}${text.length >= 200 ? '...' : ''}`)
      }

      // For tool results, keep just a brief note
      const tools = msg.content.filter(b => b.type === 'tool_use' || b.type === 'tool_result')
      if (tools.length > 0) {
        const toolNames = tools
          .filter(b => b.type === 'tool_use')
          .map(b => (b as any).name)
        if (toolNames.length > 0) {
          summaryParts.push(`  [tools used: ${toolNames.join(', ')}]`)
        }
      }
    }

    const summaryMessage: LLMMessage = {
      role: 'user',
      content: [{ type: 'text', text: summaryParts.join('\n') }],
    }

    this.session.messages = [summaryMessage, ...toKeep]
    this.session.tokenCount = countMessageTokens(this.session.messages as any)
  }

  clear(): void {
    this.session.messages = []
    this.session.tokenCount = 0
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
