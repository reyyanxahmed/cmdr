/**
 * Slash command registry and handlers.
 */

import type { SlashCommand, CommandContext, LLMAdapter } from '../core/types.js'
import {
  PURPLE, GREEN, CYAN, DIM, WHITE, commandText, dimText,
  renderSessionStatus, SEPARATOR, renderInfo,
} from './theme.js'

const commands = new Map<string, SlashCommand>()

function registerCommand(cmd: SlashCommand): void {
  commands.set(cmd.name, cmd)
}

export function getCommand(name: string): SlashCommand | undefined {
  return commands.get(name)
}

export function getAllCommands(): SlashCommand[] {
  return Array.from(commands.values())
}

export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/')
}

export function parseSlashCommand(input: string): { name: string; args: string } {
  const trimmed = input.trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) {
    return { name: trimmed.slice(1), args: '' }
  }
  return {
    name: trimmed.slice(1, spaceIndex),
    args: trimmed.slice(spaceIndex + 1).trim(),
  }
}

// ---------------------------------------------------------------------------
// Built-in slash commands
// ---------------------------------------------------------------------------

registerCommand({
  name: 'help',
  description: 'Show available commands',
  execute: async () => {
    const lines = [
      '',
      `  ${PURPLE.bold('cmdr')} ${DIM('— available commands')}`,
      '',
    ]

    for (const cmd of commands.values()) {
      lines.push(`  ${commandText('/' + cmd.name.padEnd(12))} ${dimText(cmd.description)}`)
    }

    lines.push('')
    lines.push(SEPARATOR)
    return lines.join('\n')
  },
})

registerCommand({
  name: 'clear',
  description: 'Clear conversation history',
  execute: async (_args, context) => {
    context.clearHistory()
    return renderInfo('Conversation cleared.')
  },
})

registerCommand({
  name: 'model',
  description: 'Switch model (e.g. /model qwen2.5-coder:32b)',
  execute: async (args, context) => {
    if (!args) {
      return renderInfo('Usage: /model <model-name>')
    }
    context.switchModel(args)
    return renderInfo(`Switched to model: ${GREEN(args)}`)
  },
})

registerCommand({
  name: 'models',
  description: 'List available Ollama models',
  execute: async (_args, context) => {
    try {
      const adapter = context.adapter as any
      if (!adapter?.listModels) {
        return renderInfo('Model listing not supported for this adapter.')
      }
      const models = await adapter.listModels()
      if (models.length === 0) {
        return renderInfo('No models found. Run: ollama pull qwen2.5-coder:14b')
      }
      const lines = [
        '',
        `  ${PURPLE.bold('Available models')}`,
        '',
        ...models.map((m: string) => `  ${GREEN('•')} ${WHITE(m)}`),
        '',
      ]
      return lines.join('\n')
    } catch {
      return `  ${DIM('Could not connect to Ollama. Is it running?')}`
    }
  },
})

registerCommand({
  name: 'status',
  description: 'Show session info: tokens, turns, model',
  execute: async (_args, context) => {
    const session = context.session
    const turns = Math.floor(session.messages.length / 2)
    return '\n' + renderSessionStatus(
      'current model',
      turns,
      { input: session.tokenCount, output: 0 },
    ) + '\n'
  },
})

registerCommand({
  name: 'compact',
  description: 'Manually trigger history compaction',
  execute: async () => {
    // This will be handled by the REPL directly
    return '__COMPACT__'
  },
})

registerCommand({
  name: 'diff',
  description: 'Show git diff of changes this session',
  execute: async () => {
    // Handled by REPL which has access to tools
    return '__DIFF__'
  },
})

registerCommand({
  name: 'quit',
  description: 'Exit cmdr',
  execute: async () => {
    return '__QUIT__'
  },
})

registerCommand({
  name: 'exit',
  description: 'Exit cmdr',
  execute: async () => {
    return '__QUIT__'
  },
})
