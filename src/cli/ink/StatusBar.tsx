/**
 * Persistent footer status bar for cmdr.
 *
 * Shows current model, token usage, subagent count, cwd, and mode.
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
}

export default function StatusBar(props: StatusBarProps): React.ReactElement {
  const { model, tokensIn, tokensOut, turns, agentCount, permissionMode, cwd } = props
  const theme = getActiveTheme()

  const dim = chalk.hex(theme.text.secondary)
  const accent = chalk.hex(theme.ui.prompt)
  const info = chalk.hex(theme.status.info)
  const muted = chalk.hex(theme.text.muted)
  const border = chalk.hex(theme.ui.border)

  const dir = cwd.split('/').pop() || cwd

  const modeColor = permissionMode === 'yolo'
    ? chalk.hex(theme.status.warning)
    : permissionMode === 'strict'
    ? chalk.hex(theme.status.error)
    : accent

  const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  const parts = [
    `${accent(model)}`,
    `${dim('T')}${info(String(turns))}`,
    `${dim('↑')}${info(fmtNum(tokensIn))} ${dim('↓')}${info(fmtNum(tokensOut))}`,
    agentCount > 0 ? `${dim('agents:')}${info(String(agentCount))}` : '',
    `${modeColor(permissionMode)}`,
    `${muted(dir)}`,
  ].filter(Boolean)

  const line = border('─'.repeat(60))
  const content = parts.join(dim(' │ '))

  return (
    <Box flexDirection="column">
      <Text>{line}</Text>
      <Text>{`  ${content}`}</Text>
    </Box>
  )
}
