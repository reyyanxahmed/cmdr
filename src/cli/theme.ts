/**
 * cmdr theme — Industrial Terminal aesthetic.
 *
 * This module centralizes all color and styling constants for the TUI.
 * Colors now derive from the active CmdrTheme when possible.
 */

import chalk, { type ChalkInstance } from 'chalk'
import { getActiveTheme } from './themes.js'

// ---------------------------------------------------------------------------
// Core palette — theme-aware getters with fallback constants
// ---------------------------------------------------------------------------

/** Primary action accent (prompt/user) */
export const GREEN = chalk.hex('#7CFF5B')
/** Border/separator ink */
export const GREEN_DIM = chalk.hex('#314656')
/** Assistant/responding accent */
export const PURPLE = chalk.hex('#2DD4BF')
/** Secondary accent */
export const PURPLE_DIM = chalk.hex('#22D3EE')
/** Tool execution accent */
export const CYAN = chalk.hex('#F59E0B')
/** Muted tool accent */
export const CYAN_DIM = chalk.hex('#8A6A36')
/** Warning */
export const YELLOW = chalk.hex('#FBBF24')
/** Error */
export const RED = chalk.hex('#FF5D5D')
/** Primary text */
export const WHITE = chalk.hex('#D5DEE6')
/** Secondary text */
export const DIM = chalk.hex('#72808F')
/** Emphasis text */
export const BRIGHT = chalk.hex('#F2F7FB')

// Theme-aware color accessors (re-evaluated on each call)
export function themeGreen(): ChalkInstance { return chalk.hex(getActiveTheme().ui.prompt) }
export function themePurple(): ChalkInstance { return chalk.hex(getActiveTheme().text.accent) }
export function themeCyan(): ChalkInstance { return chalk.hex(getActiveTheme().message.system) }
export function themeSuccess(): ChalkInstance { return chalk.hex(getActiveTheme().status.success) }
export function themeError(): ChalkInstance { return chalk.hex(getActiveTheme().status.error) }
export function themeWarning(): ChalkInstance { return chalk.hex(getActiveTheme().status.warning) }
export function themeInfo(): ChalkInstance { return chalk.hex(getActiveTheme().status.info) }
export function themeMuted(): ChalkInstance { return chalk.hex(getActiveTheme().text.secondary) }

// ---------------------------------------------------------------------------
// Semantic styles
// ---------------------------------------------------------------------------

/** User input prompt arrow and text */
export const userPrompt = GREEN.bold
/** AI/assistant response text */
export const assistantText = PURPLE
/** Tool execution labels */
export const toolLabel = CYAN
/** Tool output */
export const toolOutput = WHITE
/** Error messages */
export const errorText = RED.bold
/** Warning messages */
export const warnText = YELLOW
/** Success messages */
export const successText = GREEN
/** Metadata / dim info */
export const dimText = DIM
/** Bold heading */
export const heading = BRIGHT.bold
/** Code/monospace text */
export const codeText = chalk.hex('#7CFF5B')
/** Slash command */
export const commandText = PURPLE_DIM

// ---------------------------------------------------------------------------
// Box drawing characters for panels
// ---------------------------------------------------------------------------

export const BOX = {
  topLeft: GREEN_DIM('╭'),
  topRight: GREEN_DIM('╮'),
  bottomLeft: GREEN_DIM('╰'),
  bottomRight: GREEN_DIM('╯'),
  horizontal: GREEN_DIM('─'),
  vertical: GREEN_DIM('│'),
  separator: GREEN_DIM('├'),
  separatorRight: GREEN_DIM('┤'),
} as const

// ---------------------------------------------------------------------------
// Decorative elements
// ---------------------------------------------------------------------------

/** The prompt symbol */
export const PROMPT_SYMBOL = GREEN.bold('❯ ')
/** Tool execution indicator */
export const TOOL_SYMBOL = CYAN('⚡')
/** Thinking indicator */
export const THINK_SYMBOL = PURPLE('◆')
/** Success indicator */
export const SUCCESS_SYMBOL = GREEN('✓')
/** Error indicator */
export const ERROR_SYMBOL = RED('✗')
/** Info indicator */
export const INFO_SYMBOL = PURPLE_DIM('ℹ')
/** Separator line */
export const SEPARATOR = GREEN_DIM('─'.repeat(60))

// ---------------------------------------------------------------------------
// Tool lifecycle indicators
// ---------------------------------------------------------------------------

/** Tool queued / pending */
export const TOOL_PENDING = DIM('◌')
/** Tool currently executing */
export const TOOL_EXECUTING = YELLOW('⟳')
/** Tool completed successfully */
export const TOOL_SUCCESS = GREEN('✓')
/** Tool failed with error */
export const TOOL_ERROR = RED('✗')
/** Tool was cancelled */
export const TOOL_CANCELLED = DIM('⊘')

// ---------------------------------------------------------------------------
// ASCII art banner
// ---------------------------------------------------------------------------

const CMDR_LOGO_LARGE = [
  '   ________  ___  ___  ________  ________ ',
  '  |\\   ____\\|\\  \\|\\  \\|\\   __  \\|\\   __  \\',
  '  \\ \\  \\___|\\ \\  \\\\  \\ \\  \\|\\  \\ \\  \\|\\  \\',
  '   \\ \\  \\    \\ \\   __  \\ \\   _  _\\ \\   _  _\\',
  '    \\ \\  \\____\\ \\  \\ \\  \\ \\  \\\\  \\\\ \\  \\\\  \\|',
  '     \\ \\_______\\ \\__\\ \\__\\ \\__\\ _\\\\ \\__\\ _\\',
  '      \\|_______|\\|__|\\|__|\\|__|\\|__|\\|__|\\|__|\\|__|',
]

const CMDR_LOGO_COMPACT = [
  '  ██████╗███╗   ███╗██████╗ ██████╗',
  ' ██╔════╝████╗ ████║██╔══██╗██╔══██╗',
  ' ██║     ██╔████╔██║██║  ██║██████╔╝',
  ' ██║     ██║╚██╔╝██║██║  ██║██╔══██╗',
  ' ╚██████╗██║ ╚═╝ ██║██████╔╝██║  ██║',
  '  ╚═════╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝',
]

const CMDR_LOGO_TINY = [
  '   CMDR',
]

const LOGO_COLORS: ChalkInstance[] = [
  GREEN.bold,
  GREEN.bold,
  PURPLE.bold,
  PURPLE.bold,
  CYAN.bold,
  CYAN.bold,
  GREEN_DIM,
]

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function visibleWidth(value: string): number {
  return stripAnsi(value).length
}

function truncatePlain(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (value.length <= maxWidth) return value
  if (maxWidth === 1) return '…'
  return `${value.slice(0, maxWidth - 1)}…`
}

function padAnsi(value: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(value))
  return value + ' '.repeat(padding)
}

function getLogoForWidth(width: number): string[] {
  if (width >= 70) return CMDR_LOGO_LARGE
  if (width >= 50) return CMDR_LOGO_COMPACT
  return CMDR_LOGO_TINY
}

function colorizeLogo(logoLines: string[]): string[] {
  return logoLines.map((line, idx) => {
    const color = LOGO_COLORS[Math.min(idx, LOGO_COLORS.length - 1)]
    return color(line)
  })
}

export function renderBanner(): string {
  const logo = colorizeLogo(CMDR_LOGO_COMPACT)
  return ['', ...logo, ''].join('\n')
}

// ---------------------------------------------------------------------------
// Advanced two-panel welcome screen
// ---------------------------------------------------------------------------

export interface WelcomeOptions {
  model: string
  projectInfo: string
  version?: string
  gitBranch?: string
  permissionMode?: string
  teamName?: string
  teamAgentCount?: number
  cmdrMdLines?: number
  agentCount?: number
  customCmdCount?: number
  pluginCount?: number
  mcpServerCount?: number
  resumedSession?: string
  cwd?: string
}

export function renderWelcome(model: string, projectInfo: string, version = '0.0.0', opts?: WelcomeOptions): string {
  const terminalWidth = Math.min(process.stdout.columns || 100, 120)
  const metadataValueWidth = Math.max(8, terminalWidth - 18)
  const shortDir = (opts?.cwd || process.cwd()).replace(/^\/Users\/\w+/, '~')
  const logoLines = colorizeLogo(getLogoForWidth(terminalWidth))

  const modelText = truncatePlain(model, metadataValueWidth)
  const projectText = truncatePlain(projectInfo, metadataValueWidth)
  const dirText = truncatePlain(shortDir, metadataValueWidth)
  const branchText = opts?.gitBranch ? truncatePlain(opts.gitBranch, metadataValueWidth) : ''

  const mode = opts?.permissionMode || 'normal'
  const modeText = mode === 'yolo' ? YELLOW(mode)
    : mode === 'strict' ? RED(mode)
      : GREEN(mode)

  const agentCount = opts?.agentCount ?? 0
  const pluginCount = opts?.pluginCount ?? 0
  const mcpServerCount = opts?.mcpServerCount ?? 0
  const customCmdCount = opts?.customCmdCount ?? 0
  const cmdrMdLines = opts?.cmdrMdLines ?? 0

  const lines: string[] = ['']

  for (const logoLine of logoLines) {
    lines.push(`  ${logoLine}`)
  }

  lines.push('')
  lines.push(`  ${WHITE.bold('cmdr CLI')} ${DIM(`v${version}`)}`)
  lines.push(`  ${DIM('─'.repeat(Math.max(16, Math.min(terminalWidth - 6, 38))))}`)
  lines.push('')

  const metadataRow = (label: string, value: string): void => {
    lines.push(`  ${DIM(label.padEnd(12))}: ${value}`)
  }

  metadataRow('Model', GREEN(modelText))
  metadataRow('Project', CYAN(projectText))
  metadataRow('Permission', modeText)

  if (branchText) {
    metadataRow('Branch', PURPLE(branchText))
  }

  metadataRow('Directory', WHITE(dirText))

  if (opts?.teamName) {
    const teamAgents = opts.teamAgentCount ?? 0
    const teamSummary = `${opts.teamName} (${teamAgents} ${teamAgents === 1 ? 'agent' : 'agents'})`
    metadataRow('Team', CYAN(truncatePlain(teamSummary, metadataValueWidth)))
  }

  if (opts?.resumedSession) {
    metadataRow('Session', PURPLE(truncatePlain(opts.resumedSession, metadataValueWidth)))
  }

  lines.push('')
  metadataRow('Loaded', WHITE(`${agentCount} ${agentCount === 1 ? 'agent' : 'agents'} · ${pluginCount} ${pluginCount === 1 ? 'plugin' : 'plugins'} · ${mcpServerCount} MCP`))
  metadataRow('Workspace', DIM(`${customCmdCount} ${customCmdCount === 1 ? 'command' : 'commands'} · ${cmdrMdLines} CMDR.md lines`))
  lines.push('')

  const tipsInnerWidth = Math.max(10, Math.min(94, terminalWidth - 6))
  const tipsCompact = terminalWidth < 74
  const tipsHeader = GREEN.bold('Initialize Sequence')
  const tipOne = tipsCompact ? `${WHITE('1.')} ${DIM('Input query to invoke assistant')}` : `${WHITE('1.')} ${DIM('Input query to invoke coding assistant')}`
  const tipTwo = tipsCompact ? `${WHITE('2.')} ${commandText('/help')} ${DIM('for configs')}` : `${WHITE('2.')} ${commandText('/help')} ${DIM('to override params and bindings')}`
  const tipThree = tipsCompact ? `${WHITE('3.')} ${DIM('@agent <task> for runtime')}` : `${WHITE('3.')} ${DIM('@agent <task> to load specialized runtime')}`

  if (terminalWidth >= 58) {
    const top = `  ${GREEN_DIM(`╭${'─'.repeat(tipsInnerWidth)}╮`)}`
    const bottom = `  ${GREEN_DIM(`╰${'─'.repeat(tipsInnerWidth)}╯`)}`
    const tipLine = (content: string): string => `  ${GREEN_DIM('│')}${padAnsi(` ${content}`, tipsInnerWidth)}${GREEN_DIM('│')}`

    lines.push(top)
    lines.push(tipLine(tipsHeader))
    lines.push(tipLine(tipOne))
    lines.push(tipLine(tipTwo))
    lines.push(tipLine(tipThree))
    lines.push(bottom)
  } else {
    lines.push(`  ${tipsHeader}`)
    lines.push(`  ${tipOne}`)
    lines.push(`  ${tipTwo}`)
    lines.push(`  ${tipThree}`)
  }

  const hintLeft = DIM('Shift+Tab to accept edits')
  const hintRight = DIM('? for shortcuts')
  if (terminalWidth >= 64) {
    const hintGap = Math.max(2, terminalWidth - visibleWidth(hintLeft) - visibleWidth(hintRight) - 4)
    lines.push(`  ${hintLeft}${' '.repeat(hintGap)}${hintRight}`)
  } else {
    lines.push(`  ${hintRight}`)
  }

  return lines.join('\n')
}

export function renderToolExec(toolName: string, input: Record<string, unknown>): string {
  const summary = Object.entries(input)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
      return `${DIM(k + ':')} ${WHITE(val)}`
    })
    .join(' ')
  return `  ${TOOL_SYMBOL} ${toolLabel(toolName)} ${summary}`
}

export function renderToolResult(toolName: string, result: string, isError?: boolean): string {
  const prefix = isError ? ERROR_SYMBOL : SUCCESS_SYMBOL
  const truncated = result.length > 300 ? result.slice(0, 300) + DIM('...') : result
  return `  ${prefix} ${DIM(toolName + ':')} ${isError ? errorText(truncated) : dimText(truncated)}`
}

export function renderError(message: string): string {
  return `\n  ${ERROR_SYMBOL} ${errorText(message)}\n`
}

export function renderInfo(message: string): string {
  return `  ${INFO_SYMBOL} ${WHITE(message)}`
}

export function renderSessionStatus(
  model: string,
  turns: number,
  tokens: { input: number; output: number },
): string {
  return [
    `  ${DIM('Model:')} ${GREEN(model)}`,
    `  ${DIM('Turns:')} ${WHITE(String(turns))}`,
    `  ${DIM('Tokens:')} ${CYAN(String(tokens.input))} ${DIM('in /')} ${PURPLE(String(tokens.output))} ${DIM('out')}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Context window visualization
// ---------------------------------------------------------------------------

export function renderContextWindow(opts: {
  model: string
  usedTokens: number
  maxTokens: number
  inputTokens: number
  outputTokens: number
  systemPromptTokens: number
  conversationTokens: number
  turns: number
  messageCount: number
}): string {
  const { model, usedTokens, maxTokens, inputTokens, outputTokens,
    systemPromptTokens, conversationTokens, turns, messageCount } = opts

  const remaining = Math.max(0, maxTokens - usedTokens)
  const pct = maxTokens > 0 ? (usedTokens / maxTokens) * 100 : 0

  // Build the progress bar (40 chars wide)
  const barWidth = 40
  const filledCount = Math.round((pct / 100) * barWidth)
  const emptyCount = barWidth - filledCount

  // Color the bar based on usage: green < 60%, yellow 60-85%, red > 85%
  const barColor = pct > 85 ? RED : pct > 60 ? YELLOW : GREEN
  const filled = barColor('█'.repeat(filledCount))
  const empty = DIM('░'.repeat(emptyCount))
  const pctStr = pct.toFixed(1)

  const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  const lines = [
    '',
    `  ${PURPLE.bold('Context Window')} ${DIM('—')} ${GREEN(model)}`,
    '',
    `  ${filled}${empty} ${WHITE(pctStr + '%')}`,
    '',
    `  ${DIM('Used:')}      ${CYAN(fmtNum(usedTokens))} ${DIM('/')} ${WHITE(fmtNum(maxTokens))} ${DIM('tokens')}`,
    `  ${DIM('Remaining:')} ${remaining > maxTokens * 0.3 ? GREEN(fmtNum(remaining)) : remaining > maxTokens * 0.15 ? YELLOW(fmtNum(remaining)) : RED(fmtNum(remaining))} ${DIM('tokens')}`,
    '',
    `  ${DIM('Breakdown:')}`,
    `    ${PURPLE('●')} ${DIM('System prompt:')}   ${WHITE(fmtNum(systemPromptTokens))}`,
    `    ${CYAN('●')} ${DIM('Conversation:')}    ${WHITE(fmtNum(conversationTokens))}`,
    `    ${GREEN('●')} ${DIM('Input tokens:')}    ${WHITE(fmtNum(inputTokens))} ${DIM('(API reported)')}`,
    `    ${PURPLE_DIM('●')} ${DIM('Output tokens:')}   ${WHITE(fmtNum(outputTokens))} ${DIM('(API reported)')}`,
    '',
    `  ${DIM('Turns:')} ${WHITE(String(turns))}  ${DIM('Messages:')} ${WHITE(String(messageCount))}`,
    '',
    SEPARATOR,
  ]
  return lines.join('\n')
}
