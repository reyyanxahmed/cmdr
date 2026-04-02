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
import { listTeamPresets } from '../core/presets.js'
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
      const template = `# CMDR Instructions

<!-- cmdr reads this file on every session start. Add project-specific rules here. -->

## Project Overview
<!-- Describe what this project does -->

## Code Style
<!-- e.g., "Use bun instead of npm", "Prefer functional style", "Always add JSDoc comments" -->

## Testing
<!-- e.g., "Run \`vitest\` after every change", "Tests are in __tests__/ directories" -->

## Rules
<!-- e.g., "Never modify files in /core without asking first", "Always run linting before committing" -->
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
  name: 'session',
  description: 'Session management: /session save, /session resume <id>',
  execute: async (args, context) => {
    const sub = args.trim().split(/\s+/)
    const action = sub[0]?.toLowerCase()

    if (!action || action === 'list') {
      // Default: list sessions
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
        const summaryText = s.summary ? `  ${DIM(s.summary.slice(0, 40))}` : ''
        lines.push(`  ${GREEN('•')} ${DIM(s.id.slice(0, 20))}  ${WHITE(dir)}  ${DIM(s.model)}  ${DIM(timeStr)}  ${DIM(`${s.messageCount} msgs`)}${summaryText}`)
      }
      lines.push('')
      return lines.join('\n')
    }

    if (action === 'save') {
      return '__SESSION_SAVE__'
    }

    if (action === 'resume') {
      const sessionId = sub[1]
      if (!sessionId) {
        return renderInfo('Usage: /session resume <session-id>')
      }
      return `__SESSION_RESUME__:${sessionId}`
    }

    return renderInfo('Usage: /session [save|resume <id>|list]')
  },
})

registerCommand({
  name: 'team',
  description: 'Switch to team mode (review, fullstack, security)',
  execute: async (args) => {
    if (!args) {
      const presets = listTeamPresets()
      const lines = [
        '',
        `  ${PURPLE.bold('Team presets')}`,
        '',
        ...presets.map(p => `  ${GREEN('•')} ${WHITE(p)}`),
        '',
        `  ${DIM('Usage: /team <preset>  or  cmdr --team <preset>')}`,
        '',
      ]
      return lines.join('\n')
    }
    return `__TEAM_SWITCH__:${args.trim()}`
  },
})

registerCommand({
  name: 'agents',
  description: 'Show active agents and their status',
  execute: async () => {
    return '__AGENTS_STATUS__'
  },
})

registerCommand({
  name: 'tasks',
  description: 'Show task queue status',
  execute: async () => {
    return '__TASKS_STATUS__'
  },
})

registerCommand({
  name: 'config',
  description: 'View or set configuration',
  execute: async (args, context) => {
    if (!args) {
      const lines = [
        '',
        `  ${PURPLE.bold('Configuration')}`,
        '',
        `  ${DIM('Model:')}     ${WHITE(context.model)}`,
        `  ${DIM('Ollama:')}    ${WHITE(context.ollamaUrl)}`,
        '',
        `  ${DIM('Config files:')}`,
        `  ${DIM('  User:')}    ~/.cmdr/config.toml`,
        `  ${DIM('  Project:')} .cmdr.toml`,
        '',
        `  ${DIM('Env vars: CMDR_MODEL, CMDR_OLLAMA_URL, CMDR_PROVIDER')}`,
        '',
      ]
      return lines.join('\n')
    }
    return renderInfo(`Config editing not yet supported. Edit ~/.cmdr/config.toml directly.`)
  },
})

registerCommand({
  name: 'plugin',
  description: 'Manage plugins: /plugin list',
  execute: async (args) => {
    return `__PLUGIN__:${args || 'list'}`
  },
})

registerCommand({
  name: 'mcp',
  description: 'Manage MCP servers: /mcp list, /mcp connect <url>',
  execute: async (args) => {
    return `__MCP__:${args || 'list'}`
  },
})

registerCommand({
  name: 'cost',
  description: 'Show token usage breakdown for this session',
  execute: async () => {
    return '__COST__'
  },
})

registerCommand({
  name: 'undo',
  description: 'Revert the last file change made by the agent',
  execute: async () => {
    return '__UNDO__'
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
