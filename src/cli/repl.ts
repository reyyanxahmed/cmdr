/**
 * Interactive REPL — the primary cmdr interface.
 *
 * Streaming output, tool execution display, markdown rendering,
 * AMOLED black + green/purple aesthetic.
 */

import * as readline from 'readline'
import type { LLMMessage, LLMAdapter, ToolUseBlock, ToolResultBlock, StreamEvent, ApprovalDecision, ToolRiskLevel } from '../core/types.js'
import { Agent } from '../core/agent.js'
import { OllamaAdapter } from '../llm/ollama.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltInTools } from '../tools/built-in/index.js'
import { SOLO_CODER, getTeamPreset } from '../core/presets.js'
import { Orchestrator } from '../core/orchestrator.js'
import type { TeamConfig, OrchestratorEvent } from '../core/types.js'
import { SessionManager } from '../session/session-manager.js'
import { discoverProject } from '../session/project-context.js'
import { buildSystemPrompt } from '../session/prompt-builder.js'
import { renderMarkdown } from './renderer.js'
import { startThinking, startToolExec, stopSpinner, spinnerSuccess, spinnerFail, getCompletionSummary } from './spinner.js'
import {
  renderWelcome, renderToolExec, renderError,
  PROMPT_SYMBOL, SEPARATOR, GREEN, PURPLE, DIM, WHITE, CYAN,
  renderInfo, GREEN_DIM, YELLOW, RED, SUCCESS_SYMBOL, ERROR_SYMBOL,
} from './theme.js'
import {
  isSlashCommand, parseSlashCommand, getCommand,
} from './commands.js'
import { PermissionManager, classifyTool } from '../core/permissions.js'
import type { RunCallbacks } from '../core/agent-runner.js'
import { saveSession, loadSession, listSessions, findRecentSession, DebouncedSaver } from '../session/session-persistence.js'
import { PluginManager } from '../plugins/plugin-manager.js'
import { McpClient } from '../plugins/mcp-client.js'
import { loadConfig } from '../config/config-loader.js'
import { CostTracker } from '../session/cost-tracker.js'
import { UndoManager } from '../session/undo-manager.js'

export interface ReplOptions {
  model: string
  ollamaUrl: string
  version?: string
  initialPrompt?: string
  dangerouslySkipPermissions?: boolean
  resume?: string
  continue?: boolean
  verbose?: boolean
  team?: string
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const cwd = process.cwd()
  const verbose = options.verbose ?? false

  // --- Setup ---
  const adapter = new OllamaAdapter(options.ollamaUrl)

  // Check Ollama connectivity
  const healthy = await adapter.healthCheck()
  if (!healthy) {
    console.error(renderError(
      `Cannot connect to Ollama at ${options.ollamaUrl}\n` +
      `  Make sure Ollama is running: ollama serve\n` +
      `  Then pull a model: ollama pull ${options.model}`,
    ))
    process.exit(1)
  }

  // Discover project
  const projectContext = await discoverProject(cwd)
  const projectInfo = projectContext.language !== 'unknown'
    ? `${projectContext.language}${projectContext.framework ? ' / ' + projectContext.framework : ''}`
    : cwd.split('/').pop() || 'unknown'

  // Session
  const session = new SessionManager(projectContext)

  // Build system prompt with project context
  const systemPrompt = buildSystemPrompt({
    basePrompt: SOLO_CODER.systemPrompt!,
    projectContext,
    model: options.model,
  })

  // Tool registry
  const toolRegistry = new ToolRegistry()
  registerBuiltInTools(toolRegistry)

  // Load config
  const config = await loadConfig(cwd)

  // Plugin manager
  const pluginManager = new PluginManager()
  for (const pluginSource of config.plugins) {
    try {
      await pluginManager.load(pluginSource)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${DIM('⚠ Plugin load failed:')} ${msg}`)
    }
  }
  pluginManager.registerTools(toolRegistry)

  // MCP client
  const mcpClient = new McpClient()
  for (const server of config.mcp.servers) {
    try {
      await mcpClient.connect(server)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${DIM('⚠ MCP connect failed:')} ${msg}`)
    }
  }
  mcpClient.registerTools(toolRegistry)

  // Cost tracker
  const costTracker = new CostTracker()

  // Undo manager
  const undoManager = new UndoManager()

  // Permission manager
  const permissionManager = new PermissionManager(
    options.dangerouslySkipPermissions ? 'yolo' : 'normal',
  )
  await permissionManager.loadSettings()
  // CLI flag overrides persisted mode
  if (options.dangerouslySkipPermissions) {
    permissionManager.setMode('yolo')
  }

  // Orchestrator for team mode
  const orchestrator = new Orchestrator(adapter, toolRegistry, {
    maxConcurrency: 2,
    defaultModel: options.model,
  }, cwd, permissionManager)
  let activeTeamConfig: TeamConfig | undefined
  if (options.team) {
    activeTeamConfig = getTeamPreset(options.team)
    if (!activeTeamConfig) {
      console.error(renderError(`Unknown team preset: ${options.team}. Use: review, fullstack, security`))
      process.exit(1)
    }
  }

  // Create agent
  let currentModel = options.model
  const agent = new Agent(
    { ...SOLO_CODER, model: currentModel, systemPrompt },
    adapter,
    toolRegistry,
    cwd,
    permissionManager,
  )

  // --- Welcome ---
  const modeLabel = permissionManager.getMode() === 'yolo'
    ? YELLOW('⚠ yolo (all tools auto-approved)')
    : permissionManager.getMode() === 'strict'
    ? RED('strict (all tools require approval)')
    : GREEN('normal (write tools require approval)')
  console.log(renderWelcome(currentModel, projectInfo, options.version))
  console.log(`  ${DIM('Permissions:')} ${modeLabel}`)

  if (activeTeamConfig) {
    const teamAgents = activeTeamConfig.agents.map(a => a.name).join(', ')
    console.log(`  ${DIM('Team:')} ${PURPLE(activeTeamConfig.name)} ${DIM(`(${teamAgents})`)}`)
  }

  // Show CMDR.md loading status
  if (projectContext.cmdrInstructions) {
    const lineCount = projectContext.cmdrInstructions.split('\n').length
    console.log(`  ${DIM(`CMDR.md loaded (${lineCount} lines)`)}`)
  }

  // --- Resume session if requested ---
  if (options.resume) {
    const saved = await loadSession(options.resume)
    if (saved) {
      agent.replaceMessages(saved.messages)
      session.syncFromAgent(saved.messages)
      console.log(renderInfo(`Resumed session ${DIM(saved.id)} (${saved.messages.length} messages)`))
    } else {
      console.log(renderError(`Session not found: ${options.resume}`))
    }
  } else if (options.continue) {
    const saved = await findRecentSession(cwd)
    if (saved) {
      agent.replaceMessages(saved.messages)
      session.syncFromAgent(saved.messages)
      console.log(renderInfo(`Continued session ${DIM(saved.id)} (${saved.messages.length} messages)`))
    } else {
      console.log(DIM('  No previous session found for this directory.'))
    }
  }

  // Debounced auto-save (max once per 5s)
  const autoSaver = new DebouncedSaver(5000)
  const doSave = async () => {
    session.syncFromAgent(agent.getHistory())
    if (session.messages.length > 0) {
      await saveSession(session.getState(), currentModel)
    }
  }

  console.log('')

  // --- Handle initial prompt if provided ---
  if (options.initialPrompt) {
    await handleUserMessage(options.initialPrompt, agent, session, currentModel, permissionManager, verbose, adapter, costTracker, undoManager)
    await doSave()
    return
  }

  // --- Interactive REPL ---
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT_SYMBOL,
    terminal: true,
  })

  // Prevent unhandled errors from crashing the REPL
  process.on('uncaughtException', (err) => {
    console.error(renderError(`Uncaught: ${err.message}`))
  })
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason)
    console.error(renderError(`Unhandled: ${msg}`))
  })

  // Ctrl+C clears current line instead of exiting; double Ctrl+C exits
  let lastSigint = 0
  rl.on('SIGINT', () => {
    const now = Date.now()
    if (now - lastSigint < 500) {
      // Double Ctrl+C — exit
      rl.close()
      return
    }
    lastSigint = now
    if (processing) {
      console.log(`\n  ${DIM('Interrupt — waiting for current operation to finish...')}`)
      console.log(`  ${DIM('Press Ctrl+C again to force exit.')}`)
    } else {
      // Clear line and re-prompt
      rl.write('', { ctrl: true, name: 'u' })
      console.log('')
      rl.prompt()
    }
  })

  rl.prompt()

  // --- Paste detection ---
  // Buffer lines arriving within 50ms of each other and join as single input
  let pasteBuffer: string[] = []
  let pasteTimer: ReturnType<typeof setTimeout> | null = null
  const PASTE_THRESHOLD_MS = 50

  // Async queue — ensures commands are processed sequentially
  let processing = false
  let closed = false

  async function processInput(input: string): Promise<void> {
    processing = true
    try {
      await processLine(input)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(renderError(msg))
    } finally {
      processing = false
      if (closed) {
        process.exit(0)
      } else {
        rl.prompt()
      }
    }
  }

  function flushPasteBuffer(): void {
    pasteTimer = null
    if (pasteBuffer.length === 0) return

    const lines = pasteBuffer.slice()
    pasteBuffer = []

    if (lines.length > 1) {
      console.log(`  ${DIM(`+${lines.length} lines pasted`)}`)
    }

    const merged = lines.join('\n').trim()
    if (!merged) {
      rl.prompt()
      return
    }

    processInput(merged)
  }

  async function processLine(input: string): Promise<void> {
    // Slash commands
    if (isSlashCommand(input)) {
      const { name, args } = parseSlashCommand(input)
      const cmd = getCommand(name)
      if (!cmd) {
        console.log(renderError(`Unknown command: /${name}. Type /help for available commands.`))
        return
      }

      const result = await cmd.execute(args, {
        session: session.getState(),
        switchModel: (model: string) => {
          currentModel = model
        },
        clearHistory: () => {
          session.clear()
          agent.reset()
          permissionManager.resetSession()
        },
        ollamaUrl: options.ollamaUrl,
        adapter,
        model: currentModel,
        agentTokenUsage: agent.getState().tokenUsage,
        permissionManager,
      })

      if (result === '__QUIT__') {
        autoSaver.cancel()
        session.syncFromAgent(agent.getHistory())
        if (session.messages.length > 0) {
          const sid = await saveSession(session.getState(), currentModel)
          console.log(`\n  ${DIM('Session saved:')} ${DIM(sid)}`)
        }
        console.log(`\n  ${PURPLE('Goodbye.')} ${DIM('Session ended.')}\n`)
        closed = true
        rl.close()
        return
      }

      if (result === '__COMPACT__') {
        session.syncFromAgent(agent.getHistory())
        const beforeTokens = session.tokenCount
        const stats = await session.compact(adapter, currentModel)
        agent.replaceMessages(session.messages)
        const afterTokens = session.tokenCount
        console.log(renderInfo(
          `${DIM(`◇ compacted: ${stats.before} messages → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`,
        ))
        return
      }

      if (result === '__DIFF__') {
        const gitTool = toolRegistry.get('git_diff')
        if (gitTool) {
          const diffResult = await gitTool.execute({ staged: false }, {
            agent: { name: 'cmdr', role: 'assistant', model: currentModel },
            cwd,
          })
          console.log(`\n${WHITE(diffResult.data)}\n`)
        }
        return
      }

      if (result === '__SESSION_SAVE__') {
        session.syncFromAgent(agent.getHistory())
        if (session.messages.length > 0) {
          const sid = await saveSession(session.getState(), currentModel)
          console.log(renderInfo(`Session saved: ${DIM(sid)}`))
        } else {
          console.log(renderInfo('No messages to save.'))
        }
        return
      }

      if (typeof result === 'string' && result.startsWith('__SESSION_RESUME__:')) {
        const sessionId = result.slice('__SESSION_RESUME__:'.length)
        const saved = await loadSession(sessionId)
        if (saved) {
          agent.replaceMessages(saved.messages)
          session.syncFromAgent(saved.messages)
          console.log(renderInfo(`Resumed session ${DIM(saved.id)} (${saved.messages.length} messages)`))
        } else {
          console.log(renderError(`Session not found: ${sessionId}`))
        }
        return
      }

      if (typeof result === 'string' && result.startsWith('__TEAM_SWITCH__:')) {
        const preset = result.slice('__TEAM_SWITCH__:'.length)
        const teamCfg = getTeamPreset(preset)
        if (teamCfg) {
          activeTeamConfig = teamCfg
          const teamAgents = teamCfg.agents.map(a => a.name).join(', ')
          console.log(renderInfo(`Switched to team: ${PURPLE(teamCfg.name)} (${teamAgents})`))
        } else {
          console.log(renderError(`Unknown team: ${preset}. Use: review, fullstack, security`))
        }
        return
      }

      if (result === '__AGENTS_STATUS__') {
        if (!activeTeamConfig) {
          console.log(renderInfo(`Solo mode (agent: ${GREEN('cmdr')}). Use /team <preset> for multi-agent.`))
        } else {
          const status = orchestrator.getStatus()
          const lines = ['', `  ${PURPLE.bold(`Team: ${activeTeamConfig.name}`)}`, '']
          for (const agentCfg of activeTeamConfig.agents) {
            const agentStatus = status?.agents.find(a => a.name === agentCfg.name)
            const statusLabel = agentStatus ? DIM(agentStatus.status) : DIM('idle')
            lines.push(`  ${GREEN('•')} ${WHITE(agentCfg.name.padEnd(12))} ${statusLabel}`)
          }
          lines.push('')
          console.log(lines.join('\n'))
        }
        return
      }

      if (result === '__TASKS_STATUS__') {
        const status = orchestrator.getStatus()
        if (!status) {
          console.log(renderInfo('No active team or tasks.'))
        } else {
          const s = status.tasks
          if (s) {
            console.log(renderInfo(
              `Tasks: ${GREEN(`${s.completed} done`)} · ${YELLOW(`${s.in_progress} running`)} · ${DIM(`${s.pending} pending`)} · ${s.failed > 0 ? RED(`${s.failed} failed`) : DIM('0 failed')}`,
            ))
          }
        }
        return
      }

      if (result === '__COST__') {
        const summary = costTracker.getSummary()
        const elapsed = costTracker.formatElapsed()
        const lines = [
          '',
          `  ${PURPLE.bold('Token usage')}`,
          '',
          `  ${DIM('Model:')}          ${WHITE(summary.model)}`,
          `  ${DIM('Turns:')}          ${WHITE(String(summary.turns))}`,
          `  ${DIM('Input tokens:')}   ${WHITE(String(summary.totalInputTokens))}`,
          `  ${DIM('Output tokens:')}  ${WHITE(String(summary.totalOutputTokens))}`,
          `  ${DIM('Total tokens:')}   ${GREEN(String(summary.totalTokens))}`,
          `  ${DIM('Tool calls:')}     ${WHITE(String(summary.totalToolCalls))}`,
          `  ${DIM('Avg/turn:')}       ${WHITE(String(summary.avgTokensPerTurn))}`,
          `  ${DIM('Session time:')}   ${WHITE(elapsed)}`,
          '',
        ]
        console.log(lines.join('\n'))
        return
      }

      if (result === '__UNDO__') {
        if (undoManager.count === 0) {
          console.log(renderInfo('Nothing to undo.'))
        } else {
          const change = await undoManager.undoLast()
          if (change) {
            const action = change.originalContent === null ? 'deleted' : 'restored'
            const fname = change.path.split('/').pop() ?? change.path
            console.log(renderInfo(`Undid ${change.type} on ${GREEN(fname)} (${action})`))
          }
        }
        return
      }

      if (typeof result === 'string' && result.startsWith('__PLUGIN__:')) {
        const sub = result.slice('__PLUGIN__:'.length).trim()
        if (sub === 'list' || !sub) {
          const plugins = pluginManager.list()
          if (plugins.length === 0) {
            console.log(renderInfo('No plugins loaded. Add plugins to ~/.cmdr/config.toml'))
          } else {
            const lines = ['', `  ${PURPLE.bold('Loaded plugins')}`, '']
            for (const p of plugins) {
              const hooks = p.hooks ? Object.keys(p.hooks).length : 0
              const tools = p.tools?.length ?? 0
              console.log(`  ${GREEN('•')} ${WHITE(p.name)} v${p.version} ${DIM(`(${hooks} hooks, ${tools} tools)`)}`)
            }
            lines.push('')
            console.log(lines.join('\n'))
          }
        }
        return
      }

      if (typeof result === 'string' && result.startsWith('__MCP__:')) {
        const sub = result.slice('__MCP__:'.length).trim().split(/\s+/)
        const action = sub[0]

        if (action === 'list' || !action) {
          const conns = mcpClient.listConnections()
          if (conns.length === 0) {
            console.log(renderInfo('No MCP servers connected. Add to ~/.cmdr/config.toml or use /mcp connect <name> <url>'))
          } else {
            const lines = ['', `  ${PURPLE.bold('MCP servers')}`, '']
            for (const c of conns) {
              const status = c.connected ? GREEN('connected') : RED('disconnected')
              lines.push(`  ${GREEN('•')} ${WHITE(c.name)} ${DIM(c.url)} ${status} ${DIM(`(${c.tools} tools)`)}`)
            }
            lines.push('')
            console.log(lines.join('\n'))
          }
        } else if (action === 'connect') {
          const name = sub[1]
          const url = sub[2]
          if (!name || !url) {
            console.log(renderInfo('Usage: /mcp connect <name> <url>'))
          } else {
            try {
              const tools = await mcpClient.connect({ name, url })
              mcpClient.registerTools(toolRegistry)
              console.log(renderInfo(`Connected to ${name}: ${tools.length} tools discovered`))
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              console.log(renderError(msg))
            }
          }
        } else if (action === 'disconnect') {
          const name = sub[1]
          if (name && mcpClient.disconnect(name)) {
            console.log(renderInfo(`Disconnected from ${name}`))
          } else {
            console.log(renderError(`MCP server "${name}" not found`))
          }
        }
        return
      }

      if (result) console.log(result)
      return
    }

    // Regular message — team mode or solo mode
    if (activeTeamConfig) {
      await handleTeamMessage(input, orchestrator, activeTeamConfig, currentModel, verbose)
    } else {
      await handleUserMessage(input, agent, session, currentModel, permissionManager, verbose, adapter, costTracker, undoManager, () => {
        autoSaver.schedule(doSave)
      })
    }
  }

  rl.on('line', (line) => {
    pasteBuffer.push(line)
    if (pasteTimer) clearTimeout(pasteTimer)
    pasteTimer = setTimeout(flushPasteBuffer, PASTE_THRESHOLD_MS)
  })

  rl.on('close', async () => {
    autoSaver.cancel()
    if (!closed) {
      session.syncFromAgent(agent.getHistory())
      if (session.messages.length > 0) {
        try {
          const sid = await saveSession(session.getState(), currentModel)
          console.log(`\n  ${DIM('Session saved:')} ${DIM(sid)}`)
        } catch {
          // best effort
        }
      }
      console.log(`\n  ${PURPLE('Goodbye.')} ${DIM('Session ended.')}\n`)
    }
    if (processing) {
      closed = true
    } else {
      process.exit(0)
    }
  })
}

// ---------------------------------------------------------------------------
// Approval prompt — asks the user to approve a tool call
// ---------------------------------------------------------------------------

function promptApproval(
  toolName: string,
  input: Record<string, unknown>,
  riskLevel: ToolRiskLevel,
): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const riskColor = riskLevel === 'dangerous' ? RED : YELLOW
    const riskLabel = riskColor(riskLevel.toUpperCase())

    // Show the tool call details
    console.log('')
    console.log(`  ${YELLOW('⚠')}  ${WHITE('Tool approval required')} ${DIM('[')}${riskLabel}${DIM(']')}`)
    console.log(`  ${DIM('Tool:')}  ${CYAN(toolName)}`)

    // Show a summary of key arguments
    for (const [key, val] of Object.entries(input)) {
      const display = typeof val === 'string'
        ? val.length > 120 ? val.slice(0, 120) + DIM('...') : val
        : JSON.stringify(val).slice(0, 120)
      console.log(`  ${DIM(key + ':')}  ${WHITE(display)}`)
    }

    console.log('')
    console.log(`  ${GREEN('y')}${DIM('es')}  ${DIM('/')}  ${RED('n')}${DIM('o')}  ${DIM('/')}  ${PURPLE('a')}${DIM('lways allow this tool')}`)

    // Create a one-shot readline for the approval prompt
    const approvalRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    approvalRl.question(`  ${YELLOW('?')} `, (answer) => {
      approvalRl.close()
      const trimmed = answer.trim().toLowerCase()
      if (trimmed === 'y' || trimmed === 'yes' || trimmed === '') {
        resolve('allow')
      } else if (trimmed === 'a' || trimmed === 'always') {
        resolve('allow-always')
      } else {
        resolve('deny')
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Tool result summary — collapsed single-line display
// ---------------------------------------------------------------------------

function summarizeToolResult(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
  isError?: boolean,
): string {
  const lineCount = content.split('\n').length
  const prefix = isError ? ERROR_SYMBOL : SUCCESS_SYMBOL
  let summary: string

  switch (toolName) {
    case 'file_read': {
      const file = (input.path as string) ?? 'unknown'
      const fname = file.split('/').pop() ?? file
      summary = `${fname} (${lineCount} lines)`
      break
    }
    case 'glob': {
      const pattern = (input.pattern as string) ?? '*'
      const matches = content === '(no matches)' ? 0 : lineCount
      summary = `${pattern} (${matches} matches)`
      break
    }
    case 'bash': {
      const cmd = (input.command as string) ?? ''
      const truncCmd = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd
      // Extract exit code from result if present
      const exitMatch = content.match(/\[exit code: (\d+)\]/)
      const exitCode = exitMatch ? exitMatch[1] : '0'
      summary = `\`${truncCmd}\` exit=${exitCode} (${lineCount} lines)`
      break
    }
    case 'grep': {
      const pattern = (input.pattern as string) ?? ''
      const matches = content === '(no matches)' ? 0 : lineCount
      summary = `/${pattern}/ (${matches} matches)`
      break
    }
    case 'think': {
      const thought = (input.thought as string) ?? ''
      const preview = thought.length > 60 ? thought.slice(0, 57) + '...' : thought
      summary = preview
      break
    }
    default: {
      const bytes = Buffer.byteLength(content, 'utf-8')
      summary = `${bytes > 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' B'}`
      break
    }
  }

  return `  ${prefix} ${DIM(toolName)}  ${DIM(summary)}`
}

// ---------------------------------------------------------------------------
// Message handler — streaming output with tool execution display
// ---------------------------------------------------------------------------

async function handleUserMessage(
  message: string,
  agent: Agent,
  session: SessionManager,
  model: string,
  permissionManager: PermissionManager,
  verbose: boolean,
  adapter: LLMAdapter,
  costTracker?: CostTracker,
  undoManager?: UndoManager,
  onAfterResponse?: () => void,
): Promise<void> {
  console.log('') // spacing

  startThinking()

  let fullOutput = ''
  let firstText = true
  let currentTool = ''
  let currentToolInput: Record<string, unknown> = {}
  let toolCallCount = 0

  // Build callbacks with the approval gate
  const callbacks: RunCallbacks = {
    onToolApproval: (toolName, input, riskLevel) =>
      promptApproval(toolName, input, riskLevel),
  }

  try {
    for await (const event of agent.stream(message, callbacks)) {
      switch (event.type) {
        case 'text': {
          if (firstText) {
            stopSpinner()
            process.stdout.write(`\n  ${PURPLE('│')} `)
            firstText = false
          }
          const chunk = event.data as string
          fullOutput += chunk

          // Stream raw text token-by-token (no markdown on partial chunks)
          // Handle newlines by adding the prefix
          const formatted = chunk.replace(/\n/g, `\n  ${PURPLE('│')} `)
          process.stdout.write(formatted)
          break
        }

        case 'tool_use': {
          stopSpinner()
          if (!firstText) {
            // Terminate previous text stream line
            process.stdout.write('\n')
            firstText = true
          }
          const block = event.data as ToolUseBlock
          currentTool = block.name
          currentToolInput = block.input
          toolCallCount++

          // Record file state for undo before write/edit tools
          if (undoManager && (block.name === 'file_write' || block.name === 'file_edit')) {
            const filePath = (block.input.path ?? block.input.file_path) as string | undefined
            if (filePath) {
              await undoManager.recordBefore(filePath, block.name === 'file_write' ? 'write' : 'edit')
            }
          }

          console.log(renderToolExec(block.name, block.input))
          startToolExec(block.name)
          break
        }

        case 'tool_result': {
          const block = event.data as ToolResultBlock
          if (block.is_error) {
            spinnerFail(currentTool)
          } else {
            spinnerSuccess(currentTool)
          }

          if (verbose) {
            // Full output in verbose mode
            const truncated = block.content.length > 2000
              ? block.content.slice(0, 2000) + DIM('\n... (truncated)')
              : block.content
            const prefix = block.is_error ? ERROR_SYMBOL : SUCCESS_SYMBOL
            console.log(`  ${prefix} ${DIM(currentTool + ':')} ${block.is_error ? RED(truncated) : DIM(truncated)}`)
          } else {
            console.log(summarizeToolResult(currentTool, currentToolInput, block.content, block.is_error))
          }

          currentTool = ''
          currentToolInput = {}
          startThinking()
          firstText = true
          break
        }

        case 'done': {
          stopSpinner()
          break
        }

        case 'error': {
          stopSpinner()
          const err = event.data as Error
          console.error(renderError(err.message))
          break
        }
      }
    }
  } catch (err) {
    stopSpinner()
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not found') || msg.includes('404') || (msg.includes('model') && msg.includes('pull'))) {
      console.error(renderError(
        `Model '${model}' not found. Run ${GREEN('/models')} to see available models or ${GREEN('/model <name>')} to switch.`,
      ))
    } else {
      console.error(renderError(msg))
    }
  }

  // Ensure we end the text block with a newline
  if (!firstText) {
    process.stdout.write('\n')
  }

  // Add spacing after response
  if (fullOutput) {
    console.log('')
  }

  // Show turn summary with whimsical verb
  const state = agent.getState()
  const tokens = state.tokenUsage
  const summary = getCompletionSummary()
  const tokenInfo = tokens.input_tokens > 0 || tokens.output_tokens > 0
    ? `  ${DIM('·')}  ${DIM(`${tokens.input_tokens} in / ${tokens.output_tokens} out`)}`
    : ''
  console.log(`  ${DIM(summary)}${tokenInfo}`)

  // Record cost data
  costTracker?.record(model, tokens.input_tokens, tokens.output_tokens, toolCallCount)

  // Sync agent messages into session for compaction tracking
  session.syncFromAgent(agent.getHistory())

  // Auto-compact if context is getting full
  if (session.shouldCompact()) {
    try {
      const stats = await session.compact(adapter, model)
      agent.replaceMessages(session.messages)
      console.log(`  ${DIM(`◇ compacted: ${stats.before} messages → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`)
    } catch {
      // best effort — don't break the REPL
    }
  }

  // Trigger debounced auto-save
  onAfterResponse?.()

  console.log(GREEN_DIM('─'.repeat(60)))
  console.log('')
}

// ---------------------------------------------------------------------------
// Team message handler — runs goal through the orchestrator
// ---------------------------------------------------------------------------

async function handleTeamMessage(
  goal: string,
  orchestrator: Orchestrator,
  teamConfig: TeamConfig,
  model: string,
  verbose: boolean,
): Promise<void> {
  console.log('')
  console.log(`  ${PURPLE('◈')} Running team ${PURPLE.bold(teamConfig.name)} with ${teamConfig.agents.length} agents...`)
  console.log('')

  startThinking()

  try {
    const result = await orchestrator.runTeam(teamConfig, goal)
    stopSpinner()

    // Display results from each agent
    for (const [agentName, agentResult] of result.agentResults) {
      const status = agentResult.success ? GREEN('✓') : RED('✗')
      console.log(`  ${status} ${CYAN(agentName)}`)

      if (agentResult.output) {
        const lines = agentResult.output.split('\n')
        const displayLines = verbose ? lines : lines.slice(0, 20)
        for (const line of displayLines) {
          console.log(`  ${PURPLE('│')} ${line}`)
        }
        if (!verbose && lines.length > 20) {
          console.log(`  ${PURPLE('│')} ${DIM(`... ${lines.length - 20} more lines (use --verbose)`)}`)
        }
        console.log('')
      }

      // Tool call summary
      if (agentResult.toolCalls.length > 0) {
        const tools = agentResult.toolCalls.map(t => t.toolName)
        const unique = [...new Set(tools)]
        console.log(`  ${DIM(`  tools: ${unique.join(', ')} (${tools.length} calls)`)}`)
      }
    }

    // Summary
    const usage = result.totalTokenUsage
    const summary = getCompletionSummary()
    const tokenInfo = `${usage.input_tokens} in / ${usage.output_tokens} out`
    console.log(`  ${DIM(summary)}  ${DIM('·')}  ${DIM(tokenInfo)}`)
    console.log(`  ${result.success ? GREEN('Team completed successfully') : RED('Team had failures')}`)
  } catch (err) {
    stopSpinner()
    const msg = err instanceof Error ? err.message : String(err)
    console.error(renderError(msg))
  }

  console.log(GREEN_DIM('─'.repeat(60)))
  console.log('')
}
