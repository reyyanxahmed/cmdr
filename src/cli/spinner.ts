/**
 * Spinner — loading/thinking indicators for the terminal.
 */

import ora, { type Ora } from 'ora'
import { PURPLE, GREEN, CYAN, DIM } from './theme.js'

const CMDR_SPINNER = {
  frames: ['◇ ', '◈ ', '◆ ', '◈ '],
  interval: 120,
}

let activeSpinner: Ora | null = null

export function startThinking(message = 'thinking'): void {
  stopSpinner()
  activeSpinner = ora({
    text: PURPLE(message),
    spinner: CMDR_SPINNER,
    color: 'magenta',
    prefixText: '  ',
  }).start()
}

export function startToolExec(toolName: string): void {
  stopSpinner()
  activeSpinner = ora({
    text: `${CYAN(toolName)} ${DIM('executing...')}`,
    spinner: {
      frames: ['⚡', '⚡', '⚡', ' '],
      interval: 200,
    },
    color: 'cyan',
    prefixText: '  ',
  }).start()
}

export function spinnerSuccess(message?: string): void {
  if (activeSpinner) {
    activeSpinner.succeed(message ? GREEN(message) : undefined)
    activeSpinner = null
  }
}

export function spinnerFail(message?: string): void {
  if (activeSpinner) {
    activeSpinner.fail(message)
    activeSpinner = null
  }
}

export function stopSpinner(): void {
  if (activeSpinner) {
    activeSpinner.stop()
    activeSpinner = null
  }
}

export function updateSpinner(text: string): void {
  if (activeSpinner) {
    activeSpinner.text = text
  }
}
