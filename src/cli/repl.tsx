/**
 * Interactive REPL — the primary cmdr interface.
 *
 * Uses Ink (React for CLI) for robust terminal management,
 * matching the approach of Claude Code and Gemini CLI.
 *
 * Streaming output, tool execution display, markdown rendering,
 * AMOLED black + green/purple aesthetic.
 */

import React from 'react'
import { render } from 'ink'
import type { LLMAdapter, ToolUseBlock, ToolResultBlock, ApprovalDecision, ToolRiskLevel } from '../core/types.js'
import { Agent } from '../core/agent.js'
import { OllamaAdapter } from '../llm/ollama.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltInTools } from '../tools/built-in/index.js'
import { SOLO_CODER, getTeamPreset } from '../core/presets.js'
import { Orchestrator } from '../core/orchestrator.js'
import type { TeamConfig } from '../core/types.js'
import { SessionManager } from '../session/session-manager.js'
import { discoverProject } from '../session/project-context.js'
import { buildSystemPrompt } from '../session/prompt-builder.js'
import { getDefaultContextLength, resolveContextLength } from '../llm/model-registry.js'
import {
  renderWelcome, renderError,
  GREEN, PURPLE, DIM, WHITE,
  renderInfo, YELLOW, RED,
} from './theme.js'
import { PermissionManager } from '../core/permissions.js'
import { saveSession, loadSession, findRecentSession, DebouncedSaver } from '../session/session-persistence.js'
import { PluginManager } from '../plugins/plugin-manager.js'
import { McpClient } from '../plugins/mcp-client.js'
import { loadConfig } from '../config/config-loader.js'
import { CostTracker } from '../session/cost-tracker.js'
import { UndoManager } from '../session/undo-manager.js'
import { startThinking, stopSpinner, spinnerSuccess, spinnerFail, getCompletionSummary, startToolExec } from './spinner.js'
import type { RunCallbacks } from '../core/agent-runner.js'
import App from './ink/App.js'

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

  // Session — resolve model's actual context length
  const modelContextLength = await resolveContextLength(options.model, options.ollamaUrl)
  const session = new SessionManager(projectContext, modelContextLength)

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
  const currentModel = options.model
  const agent = new Agent(
    { ...SOLO_CODER, model: currentModel, systemPrompt },
    adapter,
    toolRegistry,
    cwd,
    permissionManager,
  )

  // --- Welcome banner (prints to normal terminal before Ink takes over) ---
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

  // --- Handle one-shot prompt (non-interactive) ---
  if (options.initialPrompt) {
    await handleOneShot(options.initialPrompt, agent, session, currentModel, permissionManager, verbose, adapter, costTracker, undoManager)
    await doSave()
    return
  }

  // --- Interactive REPL via Ink ---
  const app = render(
    React.createElement(App, {
      agent,
      session,
      model: currentModel,
      permissionManager,
      adapter,
      orchestrator,
      activeTeamConfig,
      costTracker,
      undoManager,
      pluginManager,
      mcpClient,
      toolRegistry,
      ollamaUrl: options.ollamaUrl,
      verbose,
      doSave,
      autoSaver,
    }),
    {
      exitOnCtrlC: false,   // We handle Ctrl+C ourselves
      patchConsole: false,  // Ban console logs from being intercepted during banner
    },
  )

  await app.waitUntilExit()
}

// ---------------------------------------------------------------------------
// One-shot handler (non-interactive --prompt mode)
// ---------------------------------------------------------------------------

async function handleOneShot(
  message: string,
  agent: Agent,
  session: SessionManager,
  model: string,
  permissionManager: PermissionManager,
  verbose: boolean,
  adapter: LLMAdapter,
  costTracker: CostTracker,
  undoManager: UndoManager,
): Promise<void> {
  console.log('')
  startThinking()

  let fullOutput = ''
  let firstText = true
  let currentTool = ''
  let currentToolInput: Record<string, unknown> = {}
  let toolCallCount = 0

  try {
    for await (const event of agent.stream(message)) {
      switch (event.type) {
        case 'text': {
          if (firstText) {
            stopSpinner()
            process.stdout.write(`\n  ${PURPLE('│')} `)
            firstText = false
          }
          const chunk = event.data as string
          fullOutput += chunk
          const formatted = chunk.replace(/\n/g, `\n  ${PURPLE('│')} `)
          process.stdout.write(formatted)
          break
        }
        case 'tool_use': {
          stopSpinner()
          if (!firstText) {
            process.stdout.write('\n')
            firstText = true
          }
          const block = event.data as ToolUseBlock
          currentTool = block.name
          currentToolInput = block.input
          toolCallCount++

          if (block.name === 'file_write' || block.name === 'file_edit') {
            const filePath = (block.input.path ?? block.input.file_path) as string | undefined
            if (filePath) await undoManager.recordBefore(filePath, block.name === 'file_write' ? 'write' : 'edit')
          }

          const toolSummary = Object.entries(block.input)
            .map(([k, v]) => {
              const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
              return `${DIM(k + ':')} ${WHITE(val)}`
            })
            .join(' ')
          console.log(`  ${GREEN('⚡')} ${GREEN.bold(block.name)} ${toolSummary}`)
          startToolExec(block.name)
          break
        }
        case 'tool_result': {
          const block = event.data as ToolResultBlock
          if (block.is_error) spinnerFail(currentTool)
          else spinnerSuccess(currentTool)
          currentTool = ''
          currentToolInput = {}
          startThinking()
          firstText = true
          break
        }
        case 'done': stopSpinner(); break
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
    console.error(renderError(msg))
  }

  if (!firstText) process.stdout.write('\n')
  if (fullOutput) console.log('')

  const state = agent.getState()
  const tokens = state.tokenUsage
  const summary = getCompletionSummary()
  const tokenInfo = tokens.input_tokens > 0 || tokens.output_tokens > 0
    ? `  ${DIM('·')}  ${DIM(`${tokens.input_tokens} in / ${tokens.output_tokens} out`)}`
    : ''
  console.log(`  ${DIM(summary)}${tokenInfo}`)

  costTracker.record(model, tokens.input_tokens, tokens.output_tokens, toolCallCount)
  session.syncFromAgent(agent.getHistory())
}
