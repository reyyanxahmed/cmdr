/**
 * Persistent footer status bar for cmdr.
 *
 * Gemini CLI-inspired multi-column bar: workspace · branch · model · context · tokens
 */

import React from 'react'
import { Box, Text } from 'ink'
import chalk from 'chalk'
import { getActiveTheme } from '../themes.js'

export interface StatusBarProps {
  model: string
  tokensIn: number
  tokensOut: number
  turns: number
  agentCount: number
  permissionMode: string
  cwd: string
  gitBranch?: string
  contextPct?: number
  version?: string
}

export default function StatusBar(props: StatusBarProps): React.ReactElement {
  const {
    model, tokensIn, tokensOut, turns, agentCount,
    permissionMode, cwd, gitBranch, contextPct = 0, version,
  } = props
  const theme = getActiveTheme()

  const dim = chalk.hex(theme.text.secondary)
  const accent = chalk.hex(theme.ui.prompt)
  const info = chalk.hex(theme.status.info)
  const border = chalk.hex(theme.ui.border)
  const warn = chalk.hex(theme.status.warning)
  const error = chalk.hex(theme.status.error)

  const modeColor = permissionMode === 'yolo' ? warn
    : permissionMode === 'strict' ? error : accent

  const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  // Context bar: [████░░░░░░] 42%
  const barLen = 10
  const filled = Math.round((contextPct / 100) * barLen)
  const barColor = contextPct > 85 ? error : contextPct > 65 ? warn : info
  const bar = barColor('█'.repeat(filled)) + dim('░'.repeat(barLen - filled))
  const pctStr = contextPct > 85 ? error(`${contextPct}%`) : contextPct > 65 ? warn(`${contextPct}%`) : info(`${contextPct}%`)

  const dir = cwd.replace(/^\/Users\/\w+/, '~').split('/').pop() || cwd

  const segments = [
    `${dim('📁')} ${info(dir)}`,
    gitBranch ? `${dim('⎇')} ${accent(gitBranch)}` : '',
    `${accent(model)}`,
    `${dim('ctx')} ${bar} ${pctStr}`,
    `${dim('↑')}${info(fmtNum(tokensIn))} ${dim('↓')}${info(fmtNum(tokensOut))}`,
    `${dim('T')}${info(String(turns))}`,
    agentCount > 0 ? `${dim('⚡')}${info(String(agentCount))}` : '',
    `${modeColor(permissionMode)}`,
  ].filter(Boolean)

  const termWidth = process.stdout.columns || 80
  const topLine = border('─'.repeat(termWidth))
  const content = segments.join(dim(' │ '))

  return (
    <Box flexDirection="column">
      <Text>{topLine}</Text>
      <Text>{` ${content}`}</Text>
    </Box>
  )
}
