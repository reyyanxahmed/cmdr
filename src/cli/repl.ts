/**
 * Interactive REPL — the primary cmdr interface.
 *
 * Streaming output, tool execution display, markdown rendering,
 * AMOLED black + green/purple aesthetic.
 */

import * as readline from 'readline'
import type { LLMMessage, ToolUseBlock, ToolResultBlock, StreamEvent, ApprovalDecision, ToolRiskLevel } from '../core/types.js'
import { Agent } from '../core/agent.js'
import { OllamaAdapter } from '../llm/ollama.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltInTools } from '../tools/built-in/index.js'
import { SOLO_CODER } from '../core/presets.js'
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
import { saveSession, loadSession, listSessions } from '../session/session-persistence.js'

export interface ReplOptions {
  model: string
  ollamaUrl: string
  initialPrompt?: string
  dangerouslySkipPermissions?: boolean
  resume?: string
  verbose?: boolean
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

  // Permission manager
  const permissionManager = new PermissionManager(
    options.dangerouslySkipPermissions ? 'yolo' : 'normal',
  )
  await permissionManager.loadSettings()
  // CLI flag overrides persisted mode
  if (options.dangerouslySkipPermissions) {
    permissionManager.setMode('yolo')
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
  console.log(renderWelcome(currentModel, projectInfo))
  console.log(`  ${DIM('Permissions:')} ${modeLabel}`)

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
  }

  console.log('')

  // --- Handle initial prompt if provided ---
  if (options.initialPrompt) {
    await handleUserMessage(options.initialPrompt, agent, session, currentModel, permissionManager, verbose)
    return
  }

  // --- Interactive REPL ---
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT_SYMBOL,
    terminal: true,
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
        session.syncFromAgent(agent.getHistory())
        if (session.messages.length > 0) {
          const sid = await saveSession(session.getState(), currentModel)
          console.log(`\n  ${DIM('Session saved:')} ${DIM(sid)}`)
        }
        console.log(`\n  ${PURPLE('Goodbye.')} ${DIM('Session ended.')}\n`)
        closed = true
        rl.close()
        process.exit(0)
        return
      }

      if (result === '__COMPACT__') {
        session.syncFromAgent(agent.getHistory())
        session.compact()
        agent.replaceMessages(session.messages)
        console.log(renderInfo('History compacted.'))
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

      if (result) console.log(result)
      return
    }

    // Regular message
    await handleUserMessage(input, agent, session, currentModel, permissionManager, verbose)
  }

  rl.on('line', (line) => {
    pasteBuffer.push(line)
    if (pasteTimer) clearTimeout(pasteTimer)
    pasteTimer = setTimeout(flushPasteBuffer, PASTE_THRESHOLD_MS)
  })

  rl.on('close', async () => {
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
): Promise<void> {
  console.log('') // spacing

  startThinking()

  let fullOutput = ''
  let firstText = true
  let currentTool = ''
  let currentToolInput: Record<string, unknown> = {}

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
    console.error(renderError(msg))
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

  // Sync agent messages into session for compaction tracking
  session.syncFromAgent(agent.getHistory())

  // Auto-compact if context is getting full
  if (session.shouldCompact()) {
    session.compact()
    agent.replaceMessages(session.messages)
    console.log(renderInfo(`${DIM('Auto-compacted conversation history.')}`))
  }

  console.log(GREEN_DIM('─'.repeat(60)))
  console.log('')
}
