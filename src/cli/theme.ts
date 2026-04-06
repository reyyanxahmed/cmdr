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

export function renderBanner(): string {
  const art = `
${GREEN.bold('   ██████╗███╗   ███╗██████╗ ██████╗ ')}
${GREEN.bold('  ██╔════╝████╗ ████║██╔══██╗██╔══██╗')}
${PURPLE.bold('  ██║     ██╔████╔██║██║  ██║██████╔╝')}
${PURPLE.bold('  ██║     ██║╚██╔╝██║██║  ██║██╔══██╗')}
${GREEN.bold('  ╚██████╗██║ ╚═╝ ██║██████╔╝██║  ██║')}
${GREEN_DIM('   ╚═════╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝')}
`
  return art
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
  cmdrMdLines?: number
  agentCount?: number
  customCmdCount?: number
  pluginCount?: number
  mcpServerCount?: number
  resumedSession?: string
  cwd?: string
}

function pad(str: string, len: number): string {
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '')
  const padding = Math.max(0, len - stripped.length)
  return str + ' '.repeat(padding)
}

export function renderWelcome(model: string, projectInfo: string, version = '0.0.0', opts?: WelcomeOptions): string {
  const termWidth = Math.min(process.stdout.columns || 100, 120)
  const innerWidth = termWidth - 4
  const dividerCol = Math.floor(innerWidth * 0.46)
  const leftCol = dividerCol - 1
  const rightCol = innerWidth - dividerCol - 2

  const B = {
    tl: GREEN_DIM('╭'), tr: GREEN_DIM('╮'), bl: GREEN_DIM('╰'), br: GREEN_DIM('╯'),
    h: GREEN_DIM('─'), v: GREEN_DIM('│'), cross: GREEN_DIM('┬'), bcross: GREEN_DIM('┴'),
  }

  const topBorder = `${B.tl}${B.h.repeat(dividerCol)}${B.cross}${B.h.repeat(innerWidth - dividerCol - 1)}${B.tr}`

  // ─── Left panel ───
  const leftLines: string[] = [
    '',
    `  ${PURPLE.bold('cmdr')} ${DIM(`v${version}`)}`,
    `  ${DIM('─'.repeat(Math.min(leftCol - 4, 22)))}`,
    '',
    `  ${DIM('Model:')}    ${GREEN(model)}`,
    `  ${DIM('Project:')}  ${CYAN(projectInfo)}`,
  ]

  if (opts?.gitBranch) {
    leftLines.push(`  ${DIM('Branch:')}   ${PURPLE(opts.gitBranch)}`)
  }

  const dir = (opts?.cwd || process.cwd()).replace(/^\/Users\/\w+/, '~')
  leftLines.push(`  ${DIM('Dir:')}      ${WHITE(dir.length > leftCol - 14 ? '…' + dir.slice(-(leftCol - 15)) : dir)}`)

  if (opts?.permissionMode) {
    const modeColor = opts.permissionMode === 'yolo' ? YELLOW
      : opts.permissionMode === 'strict' ? RED : GREEN
    leftLines.push(`  ${DIM('Mode:')}     ${modeColor(opts.permissionMode)}`)
  }

  leftLines.push('')

  // ─── Right panel ───
  const rightLines: string[] = [
    '',
    `  ${GREEN.bold('Getting started')}`,
    `  ${DIM('─'.repeat(Math.min(rightCol - 4, 22)))}`,
    '',
    `  ${WHITE('1.')} ${DIM('Ask coding questions or edit code')}`,
    `  ${WHITE('2.')} ${commandText('/help')} ${DIM('for all commands')}`,
    `  ${WHITE('3.')} ${DIM('@agent <task> to delegate')}`,
    '',
  ]

  // Context indicators
  const contextItems: string[] = []
  if (opts?.cmdrMdLines && opts.cmdrMdLines > 0) {
    contextItems.push(`${GREEN('●')} ${WHITE(`${opts.cmdrMdLines}`)} ${DIM('CMDR.md lines')}`)
  }
  if (opts?.agentCount && opts.agentCount > 0) {
    contextItems.push(`${PURPLE('●')} ${WHITE(`${opts.agentCount}`)} ${DIM(opts.agentCount === 1 ? 'agent loaded' : 'agents loaded')}`)
  }
  if (opts?.customCmdCount && opts.customCmdCount > 0) {
    contextItems.push(`${CYAN('●')} ${WHITE(`${opts.customCmdCount}`)} ${DIM('custom commands')}`)
  }
  if (opts?.pluginCount && opts.pluginCount > 0) {
    contextItems.push(`${YELLOW('●')} ${WHITE(`${opts.pluginCount}`)} ${DIM(opts.pluginCount === 1 ? 'plugin' : 'plugins')}`)
  }
  if (opts?.mcpServerCount && opts.mcpServerCount > 0) {
    contextItems.push(`${CYAN('●')} ${WHITE(`${opts.mcpServerCount}`)} ${DIM('MCP servers')}`)
  }

  if (contextItems.length > 0) {
    rightLines.push(`  ${DIM('Loaded:')}`)
    for (const item of contextItems) {
      rightLines.push(`    ${item}`)
    }
  } else {
    rightLines.push(`  ${DIM('No project context loaded.')}`)
    rightLines.push(`  ${DIM('Add a CMDR.md for custom instructions.')}`)
  }
  rightLines.push('')

  // Equalize rows
  const maxRows = Math.max(leftLines.length, rightLines.length)
  while (leftLines.length < maxRows) leftLines.push('')
  while (rightLines.length < maxRows) rightLines.push('')

  const bodyRows = leftLines.map((left, i) => {
    const right = rightLines[i] || ''
    return `${B.v}${pad(left, leftCol)}${B.v}${pad(right, rightCol)}${B.v}`
  })

  const bottomBorder = `${B.bl}${B.h.repeat(dividerCol)}${B.bcross}${B.h.repeat(innerWidth - dividerCol - 1)}${B.br}`

  // Hint bar below
  const hintLeft = `  ${DIM('Shift+Tab to accept edits')}`
  const hintRight = `${DIM('? for shortcuts')}`
  const hintGap = Math.max(1, termWidth - 28 - 16 - 2)
  const hintLine = `${hintLeft}${' '.repeat(hintGap)}${hintRight}`

  return [
    '',
    topBorder,
    ...bodyRows,
    bottomBorder,
    hintLine,
  ].join('\n')
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
