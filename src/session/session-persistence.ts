/**
 * Session persistence — save/load conversation sessions to ~/.cmdr/sessions/.
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { LLMMessage, SessionState, ProjectContext } from '../core/types.js'

const CMDR_DIR = join(homedir(), '.cmdr')
const SESSIONS_DIR = join(CMDR_DIR, 'sessions')

export interface SavedSession {
  id: string
  messages: LLMMessage[]
  projectRoot: string
  model: string
  createdAt: string
  lastActivity: string
  toolsUsed?: string[]
  summary?: string
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** Extract list of unique tool names used in a conversation. */
function extractToolsUsed(messages: LLMMessage[]): string[] {
  const tools = new Set<string>()
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        tools.add((block as any).name)
      }
    }
  }
  return [...tools]
}

/** Generate a short summary from the first user message. */
function extractSummary(messages: LLMMessage[]): string {
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text)
        .join('')
        .trim()
      if (text) {
        return text.length > 120 ? text.slice(0, 117) + '...' : text
      }
    }
  }
  return ''
}

export async function saveSession(
  sessionState: SessionState,
  model: string,
): Promise<string> {
  await ensureDir(SESSIONS_DIR)

  const saved: SavedSession = {
    id: sessionState.id,
    messages: sessionState.messages,
    projectRoot: sessionState.projectContext.rootDir,
    model,
    createdAt: sessionState.createdAt.toISOString(),
    lastActivity: new Date().toISOString(),
    toolsUsed: extractToolsUsed(sessionState.messages),
    summary: extractSummary(sessionState.messages),
  }

  const filePath = join(SESSIONS_DIR, `${sessionState.id}.json`)
  await writeFile(filePath, JSON.stringify(saved, null, 2), 'utf-8')
  return sessionState.id
}

export async function loadSession(sessionId: string): Promise<SavedSession | null> {
  try {
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`)
    const data = await readFile(filePath, 'utf-8')
    return JSON.parse(data) as SavedSession
  } catch {
    return null
  }
}

/** Find the most recent session for a given project directory. */
export async function findRecentSession(projectRoot: string): Promise<SavedSession | null> {
  const sessions = await listSessions()
  const match = sessions.find(s => s.projectRoot === projectRoot)
  if (!match) return null
  return loadSession(match.id)
}

export async function listSessions(): Promise<Array<{
  id: string
  projectRoot: string
  model: string
  lastActivity: string
  messageCount: number
  toolsUsed?: string[]
  summary?: string
}>> {
  try {
    await ensureDir(SESSIONS_DIR)
    const files = await readdir(SESSIONS_DIR)
    const sessions: Array<{
      id: string
      projectRoot: string
      model: string
      lastActivity: string
      messageCount: number
      toolsUsed?: string[]
      summary?: string
    }> = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const data = await readFile(join(SESSIONS_DIR, file), 'utf-8')
        const saved = JSON.parse(data) as SavedSession
        sessions.push({
          id: saved.id,
          projectRoot: saved.projectRoot,
          model: saved.model,
          lastActivity: saved.lastActivity,
          messageCount: saved.messages.length,
          toolsUsed: saved.toolsUsed,
          summary: saved.summary,
        })
      } catch {
        // skip corrupt files
      }
    }

    // Most recent first
    sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
    return sessions
  } catch {
    return []
  }
}

/** Get the ~/.cmdr directory path. */
export function getCmdrDir(): string {
  return CMDR_DIR
}

// ---------------------------------------------------------------------------
// Debounced auto-save
// ---------------------------------------------------------------------------

export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly intervalMs: number

  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs
  }

  /**
   * Schedule a save. If one is already pending, it's a no-op (coalesce).
   * Guaranteed at most once per intervalMs.
   */
  schedule(fn: () => Promise<void>): void {
    if (this.timer) return // already scheduled
    this.timer = setTimeout(async () => {
      this.timer = null
      try {
        await fn()
      } catch {
        // best effort
      }
    }, this.intervalMs)
  }

  /** Cancel any pending save. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Flush immediately (e.g., on exit). */
  async flush(fn: () => Promise<void>): Promise<void> {
    this.cancel()
    await fn()
  }
}
