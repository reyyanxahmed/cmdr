/**
 * cmdr theme — AMOLED black with green + purple accents.
 *
 * This module centralizes all color and styling constants for the TUI.
 */

import chalk from 'chalk'

// ---------------------------------------------------------------------------
// Core palette — AMOLED black (#000000) background assumption
// ---------------------------------------------------------------------------

/** Bright neon green — primary accent (user input, success, active elements) */
export const GREEN = chalk.hex('#00FF41')
/** Dim green — secondary text, borders */
export const GREEN_DIM = chalk.hex('#00BB30')
/** Bright purple/violet — secondary accent (AI responses, highlights) */
export const PURPLE = chalk.hex('#BF40FF')
/** Dim purple — subtle decorations */
export const PURPLE_DIM = chalk.hex('#8A2BE2')
/** Cyan accent — tool names, links */
export const CYAN = chalk.hex('#00FFFF')
/** Dim cyan */
export const CYAN_DIM = chalk.hex('#008B8B')
/** Yellow — warnings, important notices */
export const YELLOW = chalk.hex('#FFD700')
/** Red — errors */
export const RED = chalk.hex('#FF3333')
/** White — primary readable text */
export const WHITE = chalk.hex('#E0E0E0')
/** Dim gray — metadata, timestamps, less important info */
export const DIM = chalk.hex('#555555')
/** Bright white — emphasis */
export const BRIGHT = chalk.hex('#FFFFFF')

// ---------------------------------------------------------------------------
// Semantic styles
// ---------------------------------------------------------------------------

/** User input prompt arrow and text */
export const userPrompt = GREEN.bold
/** AI/assistant response text */
export const assistantText = PURPLE
/** Tool execution labels */
export const toolLabel = CYAN.bold
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
export const codeText = chalk.hex('#00FF41')
/** Slash command */
export const commandText = CYAN

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

export function renderWelcome(model: string, projectInfo: string): string {
  const lines = [
    renderBanner(),
    `  ${PURPLE.bold('cmdr')} ${DIM('v0.1.0')} ${DIM('—')} ${WHITE('local-first multi-agent coding tool')}`,
    `  ${DIM('Model:')} ${GREEN(model)}  ${DIM('Project:')} ${CYAN(projectInfo)}`,
    '',
    `  ${DIM('Type a message to start coding. Use')} ${commandText('/help')} ${DIM('for commands.')}`,
    SEPARATOR,
    '',
  ]
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
