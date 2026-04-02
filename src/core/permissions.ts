/**
 * Permission management — HITL (Human-in-the-Loop) tool approval.
 *
 * Classifies tools by risk level and gates execution on user approval
 * depending on the current permission mode.
 */

import type { PermissionMode, ToolRiskLevel, ApprovalDecision, ApprovalCallback } from './types.js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const SETTINGS_PATH = join(homedir(), '.cmdr', 'settings.json')

interface PersistedSettings {
  allowedTools?: string[]
  permissionMode?: PermissionMode
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = new Set([
  'file_read',
  'glob',
  'grep',
  'git_diff',
  'git_log',
  'think',
])

const DANGEROUS_TOOLS = new Set([
  'bash',
])

export function classifyTool(toolName: string): ToolRiskLevel {
  if (READ_ONLY_TOOLS.has(toolName)) return 'read-only'
  if (DANGEROUS_TOOLS.has(toolName)) return 'dangerous'
  return 'write'
}

// ---------------------------------------------------------------------------
// Permission manager
// ---------------------------------------------------------------------------

export class PermissionManager {
  private mode: PermissionMode
  /** Tools the user has permanently allowed for this session. */
  private sessionAllowed = new Set<string>()
  /** Tools persisted in ~/.cmdr/settings.json. */
  private persistedAllowed = new Set<string>()

  constructor(mode: PermissionMode = 'normal') {
    this.mode = mode
  }

  /** Load persisted settings from ~/.cmdr/settings.json. */
  async loadSettings(): Promise<void> {
    try {
      const data = await readFile(SETTINGS_PATH, 'utf-8')
      const settings = JSON.parse(data) as PersistedSettings
      if (settings.allowedTools) {
        for (const tool of settings.allowedTools) {
          this.persistedAllowed.add(tool)
        }
      }
      if (settings.permissionMode) {
        this.mode = settings.permissionMode
      }
    } catch {
      // no settings file yet — that's fine
    }
  }

  /** Save current persisted allow-list to disk. */
  private async saveSettings(): Promise<void> {
    try {
      await mkdir(join(homedir(), '.cmdr'), { recursive: true })
      const settings: PersistedSettings = {
        allowedTools: [...this.persistedAllowed],
        permissionMode: this.mode,
      }
      await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    } catch {
      // best effort
    }
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
    // Reset session-allowed when mode changes
    this.sessionAllowed.clear()
  }

  /**
   * Decide whether a tool call should proceed.
   *
   * Returns true if auto-approved, false if the user must be prompted.
   */
  needsApproval(toolName: string): boolean {
    // Yolo mode — everything auto-approved
    if (this.mode === 'yolo') return false

    // Session-allowed or persisted-allowed tools skip the prompt
    if (this.sessionAllowed.has(toolName)) return false
    if (this.persistedAllowed.has(toolName)) return false

    const risk = classifyTool(toolName)

    if (this.mode === 'strict') {
      // Strict mode — everything needs approval
      return true
    }

    // Normal mode — only write/dangerous need approval
    return risk !== 'read-only'
  }

  /**
   * Gate a tool call. If approval is needed, calls the approvalCallback.
   * Returns the decision (allow/deny). Handles 'allow-always' by recording it.
   */
  async gate(
    toolName: string,
    input: Record<string, unknown>,
    approvalCallback: ApprovalCallback,
  ): Promise<'allow' | 'deny'> {
    if (!this.needsApproval(toolName)) {
      return 'allow'
    }

    const risk = classifyTool(toolName)
    const decision = await approvalCallback(toolName, input, risk)

    if (decision === 'allow-always') {
      this.sessionAllowed.add(toolName)
      this.persistedAllowed.add(toolName)
      await this.saveSettings()
      return 'allow'
    }

    return decision
  }

  /** Reset session-allowed set (e.g. on /clear). */
  resetSession(): void {
    this.sessionAllowed.clear()
  }
}
