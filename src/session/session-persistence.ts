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
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
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

export async function listSessions(): Promise<Array<{
  id: string
  projectRoot: string
  model: string
  lastActivity: string
  messageCount: number
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
