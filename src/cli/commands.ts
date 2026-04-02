/**
 * Slash command registry and handlers.
 */

import type { SlashCommand, CommandContext, LLMAdapter, PermissionMode } from '../core/types.js'
import {
  PURPLE, GREEN, CYAN, DIM, WHITE, commandText, dimText, YELLOW, RED,
  renderSessionStatus, renderContextWindow, SEPARATOR, renderInfo,
} from './theme.js'
import { getDefaultContextLength } from '../llm/model-registry.js'
import { countTokens } from '../llm/token-counter.js'
import { listSessions } from '../session/session-persistence.js'
import { writeFile, mkdir, stat } from 'fs/promises'
import { join } from 'path'

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
  name: 'context',
  description: 'Show context window usage and remaining tokens',
  execute: async (_args, context) => {
    const session = context.session
    const model = context.model
    const maxTokens = session.maxContextTokens || getDefaultContextLength(model)

    // Estimate system prompt tokens (the prompt builder output)
    // We approximate from the first system-like content or fixed estimate
    const systemPromptTokens = countTokens(context.session.projectContext.rootDir) + 500

    const conversationTokens = session.tokenCount
    const usedTokens = systemPromptTokens + conversationTokens

    const apiTokens = context.agentTokenUsage
    const turns = Math.floor(session.messages.length / 2)

    return renderContextWindow({
      model,
      usedTokens,
      maxTokens,
      inputTokens: apiTokens.input_tokens,
      outputTokens: apiTokens.output_tokens,
      systemPromptTokens,
      conversationTokens,
      turns,
      messageCount: session.messages.length,
    })
  },
})

registerCommand({
  name: 'init',
  description: 'Create CMDR.md and .cmdr/ in current project',
  execute: async (_args, context) => {
    const root = context.session.projectContext.rootDir
    const cmdrMdPath = join(root, 'CMDR.md')
    const cmdrDir = join(root, '.cmdr')

    let created: string[] = []

    // Create .cmdr/ directory
    try {
      await stat(cmdrDir)
    } catch {
      await mkdir(cmdrDir, { recursive: true })
      created.push('.cmdr/')
    }

    // Create CMDR.md template
    try {
      await stat(cmdrMdPath)
    } catch {
      const template = `# CMDR.md — Project Instructions

<!-- cmdr reads this file on every session start. -->
<!-- Add project-specific rules and context here. -->

## Build & Test

- Build: \`npm run build\`
- Test: \`npm test\`
- Lint: \`npm run lint\`

## Conventions

- Use TypeScript strict mode
- Prefer ESM imports
- Follow existing code patterns

## Do NOT

- Modify files in \`dist/\` or \`node_modules/\`
- Commit generated files
`
      await writeFile(cmdrMdPath, template, 'utf-8')
      created.push('CMDR.md')
    }

    if (created.length === 0) {
      return renderInfo('CMDR.md and .cmdr/ already exist.')
    }
    return renderInfo(`Created: ${created.join(', ')}`)
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
  name: 'sessions',
  description: 'List saved sessions (resume with --resume <id>)',
  execute: async () => {
    const sessions = await listSessions()
    if (sessions.length === 0) {
      return renderInfo('No saved sessions.')
    }
    const lines = [
      '',
      `  ${PURPLE.bold('Saved sessions')}`,
      '',
    ]
    for (const s of sessions.slice(0, 10)) {
      const date = new Date(s.lastActivity)
      const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
      const dir = s.projectRoot.split('/').pop() || s.projectRoot
      lines.push(`  ${GREEN('•')} ${DIM(s.id.slice(0, 20))}  ${WHITE(dir)}  ${DIM(s.model)}  ${DIM(timeStr)}  ${DIM(`${s.messageCount} msgs`)}`)
    }
    lines.push('')
    lines.push(`  ${DIM('Resume with: cmdr --resume <session-id>')}`)
    lines.push('')
    return lines.join('\n')
  },
})

registerCommand({
  name: 'permissions',
  description: 'View or change permission mode (normal/yolo/strict)',
  execute: async (args, context) => {
    const pm = context.permissionManager
    if (!pm) {
      return renderInfo('Permission manager not available.')
    }

    if (!args) {
      const mode = pm.getMode()
      const modeColor = mode === 'yolo' ? YELLOW : mode === 'strict' ? RED : GREEN
      const lines = [
        '',
        `  ${PURPLE.bold('Permissions')}`,
        '',
        `  ${DIM('Current mode:')} ${modeColor(mode)}`,
        '',
        `  ${DIM('Modes:')}`,
        `    ${GREEN('normal')}  ${DIM('— read-only tools auto-approved, write/bash require confirmation')}`,
        `    ${YELLOW('yolo')}    ${DIM('— all tools auto-approved (dangerous)')}`,
        `    ${RED('strict')}  ${DIM('— all tools require approval')}`,
        '',
        `  ${DIM('Usage: /permissions <mode>')}`,
        '',
      ]
      return lines.join('\n')
    }

    const newMode = args.trim().toLowerCase()
    if (newMode !== 'normal' && newMode !== 'yolo' && newMode !== 'strict') {
      return renderInfo(`Invalid mode: ${args}. Use normal, yolo, or strict.`)
    }

    pm.setMode(newMode as PermissionMode)
    const modeColor = newMode === 'yolo' ? YELLOW : newMode === 'strict' ? RED : GREEN
    return renderInfo(`Permission mode set to ${modeColor(newMode)}`)
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
