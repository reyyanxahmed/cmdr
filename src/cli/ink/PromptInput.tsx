/**
 * Gemini-style multiline prompt input for Ink.
 *
 * Features:
 * - Cursor-aware multiline editing
 * - History navigation
 * - Common shell shortcuts (Ctrl+A/E/U/K)
 * - Large paste hinting
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import chalk, { type ChalkInstance } from 'chalk'
import { getActiveTheme } from '../themes.js'
import { InputBuffer } from './input-buffer.js'

const LARGE_PASTE_LINE_THRESHOLD = 5
const LARGE_PASTE_CHAR_THRESHOLD = 500

export interface PromptInputProps {
  disabled?: boolean
  placeholder?: string
  onSubmit: (value: string) => void | Promise<void>
}

function toCodePoints(text: string): string[] {
  return Array.from(text)
}

function renderLineWithCursor(line: string, col: number, color: ChalkInstance): React.ReactNode {
  const cp = toCodePoints(line)
  const before = cp.slice(0, col).join('')
  const current = cp[col] ?? ' '
  const after = cp.slice(col + (cp[col] ? 1 : 0)).join('')

  return (
    <>
      {color(before)}
      <Text inverse>{current}</Text>
      {color(after)}
    </>
  )
}

export default function PromptInput(props: PromptInputProps): React.ReactElement {
  const {
    disabled = false,
    placeholder = 'Ask anything, @file to include, /help for commands',
    onSubmit,
  } = props

  const theme = getActiveTheme()
  const promptColor = chalk.hex(theme.ui.prompt)
  const borderColor = theme.ui.border
  const textColor = chalk.hex(theme.text.primary)
  const dim = chalk.hex(theme.text.secondary)
  const assist = chalk.hex(theme.text.accent)

  const bufferRef = useRef(new InputBuffer(''))
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('')

  const [version, setVersion] = useState(0)
  const [pasteHint, setPasteHint] = useState<string | null>(null)

  const snapshot = useMemo(() => bufferRef.current.snapshot(), [version])

  const bump = (): void => setVersion(v => v + 1)

  useEffect(() => {
    if (!pasteHint) return
    const t = setTimeout(() => setPasteHint(null), 1800)
    return () => clearTimeout(t)
  }, [pasteHint])

  const submit = (): void => {
    const raw = bufferRef.current.getText()
    const value = raw.trim()
    if (!value) return

    const history = historyRef.current
    if (history.length === 0 || history[history.length - 1] !== value) {
      history.push(value)
    }

    historyIndexRef.current = -1
    historyDraftRef.current = ''
    bufferRef.current.clear()
    bump()
    void onSubmit(value)
  }

  const browseHistoryUp = (): void => {
    const history = historyRef.current
    if (history.length === 0) return

    if (historyIndexRef.current === -1) {
      historyDraftRef.current = bufferRef.current.getText()
      historyIndexRef.current = history.length - 1
    } else if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1
    }

    bufferRef.current.setText(history[historyIndexRef.current] ?? '')
    bump()
  }

  const browseHistoryDown = (): void => {
    const history = historyRef.current
    if (history.length === 0) return
    if (historyIndexRef.current === -1) return

    if (historyIndexRef.current < history.length - 1) {
      historyIndexRef.current += 1
      bufferRef.current.setText(history[historyIndexRef.current] ?? '')
    } else {
      historyIndexRef.current = -1
      bufferRef.current.setText(historyDraftRef.current)
    }
    bump()
  }

  useInput((input, key) => {
    if (disabled) return false

    if (key.ctrl && input === 'c') return false
    if (key.ctrl && input === 'd') return false

    if (key.return) {
      if (key.shift || key.meta) {
        bufferRef.current.insertNewLine()
        bump()
        return true
      }
      submit()
      return true
    }

    if (key.upArrow) {
      if (snapshot.lines.length === 1) browseHistoryUp()
      else {
        bufferRef.current.moveUp()
        bump()
      }
      return true
    }

    if (key.downArrow) {
      if (snapshot.lines.length === 1) browseHistoryDown()
      else {
        bufferRef.current.moveDown()
        bump()
      }
      return true
    }

    if (key.leftArrow) {
      bufferRef.current.moveLeft()
      bump()
      return true
    }

    if (key.rightArrow) {
      bufferRef.current.moveRight()
      bump()
      return true
    }

    if (key.backspace || key.delete) {
      if (key.delete) bufferRef.current.deleteForward()
      else bufferRef.current.backspace()
      bump()
      return true
    }

    if (key.tab) {
      bufferRef.current.insert('  ')
      bump()
      return true
    }

    if (key.ctrl && input === 'a') {
      bufferRef.current.moveLineStart()
      bump()
      return true
    }

    if (key.ctrl && input === 'e') {
      bufferRef.current.moveLineEnd()
      bump()
      return true
    }

    if (key.ctrl && input === 'u') {
      bufferRef.current.deleteToLineStart()
      bump()
      return true
    }

    if (key.ctrl && input === 'k') {
      bufferRef.current.deleteToLineEnd()
      bump()
      return true
    }

    if (key.ctrl && input === 'l') {
      bufferRef.current.clear()
      bump()
      return true
    }

    if (input) {
      const isLargePaste =
        input.length > LARGE_PASTE_CHAR_THRESHOLD ||
        input.split('\n').length > LARGE_PASTE_LINE_THRESHOLD
      if (isLargePaste) {
        setPasteHint(`Large paste inserted (${input.split('\n').length} lines)`)
      }
      bufferRef.current.insert(input)
      bump()
      return true
    }

    return false
  })

  const isEmpty = snapshot.lines.length === 1 && snapshot.lines[0].length === 0

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={0} flexDirection="column">
        {snapshot.lines.map((line, idx) => {
          const isCursorLine = !disabled && idx === snapshot.row
          const prefix = idx === 0 ? promptColor('❯ ') : dim('  ')
          return (
            <Text key={`line-${idx}`}>
              {prefix}
              {isCursorLine
                ? renderLineWithCursor(line, snapshot.col, textColor)
                : idx === 0 && isEmpty
                  ? dim(placeholder)
                  : textColor(line)}
            </Text>
          )
        })}
      </Box>

      <Text>
        {pasteHint
          ? assist(pasteHint)
          : dim('Enter send  •  Shift+Enter newline  •  Ctrl+A/E line nav  •  ↑/↓ history')}
      </Text>
    </Box>
  )
}
