/**
 * Permission management — HITL (Human-in-the-Loop) tool approval.
 *
 * Classifies tools by risk level and gates execution on user approval
 * depending on the current permission mode.
 *
 * Supports fine-grained rules:
 *   - Glob patterns for file paths (e.g. "src/**" allows all file writes under src/)
 *   - Prefix matching for bash commands (e.g. "npm test" allows "npm test --watch")
 */

import type { PermissionMode, ToolRiskLevel, ApprovalDecision, ApprovalCallback } from './types.js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve, relative, isAbsolute } from 'path'
import { homedir } from 'os'

const SETTINGS_PATH = join(homedir(), '.cmdr', 'settings.json')

interface PathRule {
  /** Glob pattern relative to project root. */
  pattern: string
  /** Whether to allow or deny matching paths. */
  allow: boolean
}

interface BashRule {
  /** Command prefix to match (e.g. "npm test", "git"). */
  prefix: string
  allow: boolean
}

interface PersistedSettings {
  allowedTools?: string[]
  permissionMode?: PermissionMode
  pathRules?: PathRule[]
  bashRules?: BashRule[]
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
  'memory_read',
])

const DANGEROUS_TOOLS = new Set([
  'bash',
])

/** Tools that operate on file paths — their inputs contain paths to check. */
const FILE_TOOLS = new Set([
  'file_write',
  'file_edit',
  'file_read',
])

export function classifyTool(toolName: string): ToolRiskLevel {
  if (READ_ONLY_TOOLS.has(toolName)) return 'read-only'
  if (DANGEROUS_TOOLS.has(toolName)) return 'dangerous'
  return 'write'
}

// ---------------------------------------------------------------------------
// Glob matching (minimal implementation — no external deps)
// ---------------------------------------------------------------------------

/**
 * Simple glob match supporting *, **, and ?.
 * Not as full-featured as minimatch but handles common patterns.
 */
function globMatch(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars (except * and ?)
    .replace(/\*\*/g, '{{GLOBSTAR}}')        // Temp placeholder for **
    .replace(/\*/g, '[^/]*')                 // * matches within a segment
    .replace(/\?/g, '[^/]')                  // ? matches single char
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')      // ** matches across segments

  return new RegExp(`^${regexStr}$`).test(path)
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
  /** Path-based rules for file tools. */
  private pathRules: PathRule[] = []
  /** Command-prefix rules for bash tool. */
  private bashRules: BashRule[] = []
  /** Project root for resolving relative paths in rules. */
  private projectRoot: string = process.cwd()

  constructor(mode: PermissionMode = 'normal') {
    this.mode = mode
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root
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
      if (settings.pathRules) {
        this.pathRules = settings.pathRules
      }
      if (settings.bashRules) {
        this.bashRules = settings.bashRules
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
        pathRules: this.pathRules.length > 0 ? this.pathRules : undefined,
        bashRules: this.bashRules.length > 0 ? this.bashRules : undefined,
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
    this.sessionAllowed.clear()
  }

  /** Add a path rule (e.g. allow writes to "src/**"). */
  addPathRule(pattern: string, allow: boolean = true): void {
    this.pathRules.push({ pattern, allow })
  }

  /** Add a bash command rule (e.g. allow "npm test"). */
  addBashRule(prefix: string, allow: boolean = true): void {
    this.bashRules.push({ prefix, allow })
  }

  /**
   * Check if a specific file path is allowed by path rules.
   * Returns true (allowed), false (denied), or undefined (no matching rule).
   */
  private checkPathRules(filePath: string): boolean | undefined {
    // Normalize to relative path from project root
    const absPath = isAbsolute(filePath)
      ? filePath
      : resolve(this.projectRoot, filePath)
    const relPath = relative(this.projectRoot, absPath)

    // Check rules in reverse order (last rule wins)
    for (let i = this.pathRules.length - 1; i >= 0; i--) {
      if (globMatch(this.pathRules[i].pattern, relPath)) {
        return this.pathRules[i].allow
      }
    }
    return undefined
  }

  /**
   * Check if a bash command matches any bash rules.
   * Returns true (allowed), false (denied), or undefined (no matching rule).
   */
  private checkBashRules(command: string): boolean | undefined {
    const trimmedCmd = command.trim()
    // Check rules in reverse order (last rule wins)
    for (let i = this.bashRules.length - 1; i >= 0; i--) {
      if (trimmedCmd === this.bashRules[i].prefix || trimmedCmd.startsWith(this.bashRules[i].prefix + ' ')) {
        return this.bashRules[i].allow
      }
    }
    return undefined
  }

  /**
   * Check fine-grained rules for a specific tool invocation.
   * Returns true if auto-approved by rules, false otherwise.
   */
  private checkFineGrainedRules(toolName: string, input: Record<string, unknown>): boolean {
    // File tool path checks
    if (FILE_TOOLS.has(toolName)) {
      const path = (input.path ?? input.filePath ?? input.file) as string | undefined
      if (path) {
        const result = this.checkPathRules(path)
        if (result !== undefined) return result
      }
    }

    // Bash command prefix checks
    if (toolName === 'bash') {
      const command = (input.command ?? input.cmd) as string | undefined
      if (command) {
        const result = this.checkBashRules(command)
        if (result !== undefined) return result
      }
    }

    return false
  }

  /**
   * Decide whether a tool call should proceed.
   */
  needsApproval(toolName: string, input?: Record<string, unknown>): boolean {
    if (this.mode === 'yolo') return false
    if (this.sessionAllowed.has(toolName)) return false
    if (this.persistedAllowed.has(toolName)) return false

    const risk = classifyTool(toolName)

    if (this.mode === 'strict') {
      // In strict, fine-grained rules can still auto-approve
      if (input && this.checkFineGrainedRules(toolName, input)) return false
      return true
    }

    // Normal mode — read-only never needs approval
    if (risk === 'read-only') return false

    // Check fine-grained rules before prompting
    if (input && this.checkFineGrainedRules(toolName, input)) return false

    return true
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
    if (!this.needsApproval(toolName, input)) {
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
