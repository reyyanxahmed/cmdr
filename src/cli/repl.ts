/**
 * Interactive REPL — the primary cmdr interface.
 *
 * Streaming output, tool execution display, markdown rendering,
 * AMOLED black + green/purple aesthetic.
 */

import * as readline from 'readline'
import type { LLMMessage, ToolUseBlock, ToolResultBlock, StreamEvent } from '../core/types.js'
import { Agent } from '../core/agent.js'
import { OllamaAdapter } from '../llm/ollama.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltInTools } from '../tools/built-in/index.js'
import { SOLO_CODER } from '../core/presets.js'
import { SessionManager } from '../session/session-manager.js'
import { discoverProject } from '../session/project-context.js'
import { buildSystemPrompt } from '../session/prompt-builder.js'
import { renderMarkdown } from './renderer.js'
import { startThinking, startToolExec, stopSpinner, spinnerSuccess, spinnerFail } from './spinner.js'
import {
  renderWelcome, renderToolExec, renderToolResult, renderError,
  PROMPT_SYMBOL, SEPARATOR, GREEN, PURPLE, DIM, WHITE, CYAN,
  renderInfo, GREEN_DIM,
} from './theme.js'
import {
  isSlashCommand, parseSlashCommand, getCommand,
} from './commands.js'

export interface ReplOptions {
  model: string
  ollamaUrl: string
  initialPrompt?: string
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const cwd = process.cwd()

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

  // Create agent
  let currentModel = options.model
  const agent = new Agent(
    { ...SOLO_CODER, model: currentModel, systemPrompt },
    adapter,
    toolRegistry,
    cwd,
  )

  // --- Welcome ---
  console.log(renderWelcome(currentModel, projectInfo))

  // --- Handle initial prompt if provided ---
  if (options.initialPrompt) {
    await handleUserMessage(options.initialPrompt, agent, session, currentModel)
    return
  }

  // --- Interactive REPL ---
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT_SYMBOL,
    terminal: true,
  })

  // Custom prompt display
  rl.prompt()

  // Async queue — ensures commands are processed sequentially
  const lineQueue: string[] = []
  let processing = false
  let closed = false

  async function processQueue(): Promise<void> {
    if (processing) return
    processing = true

    while (lineQueue.length > 0) {
      const input = lineQueue.shift()!.trim()
      if (!input) continue
      await processLine(input)
      if (closed) return
    }

    processing = false
    if (closed) {
      process.exit(0)
    } else {
      rl.prompt()
    }
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
        },
        ollamaUrl: options.ollamaUrl,
        adapter,
      })

      if (result === '__QUIT__') {
        console.log(`\n  ${PURPLE('Goodbye.')} ${DIM('Session ended.')}\n`)
        closed = true
        rl.close()
        process.exit(0)
        return
      }

      if (result === '__COMPACT__') {
        session.compact()
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
    await handleUserMessage(input, agent, session, currentModel)
  }

  rl.on('line', (line) => {
    lineQueue.push(line)
    processQueue()
  })

  rl.on('close', () => {
    if (!closed) {
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
// Message handler — streaming output with tool execution display
// ---------------------------------------------------------------------------

async function handleUserMessage(
  message: string,
  agent: Agent,
  session: SessionManager,
  model: string,
): Promise<void> {
  console.log('') // spacing

  // Auto compact if needed
  if (session.shouldCompact()) {
    session.compact()
    console.log(renderInfo(`${DIM('Auto-compacted conversation history.')}`))
  }

  startThinking()

  let fullOutput = ''
  let firstText = true
  let currentTool = ''

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
          console.log(renderToolResult(currentTool, block.content, block.is_error))
          currentTool = ''
          startThinking('continuing...')
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

  // Show token info
  const state = agent.getState()
  const tokens = state.tokenUsage
  if (tokens.input_tokens > 0 || tokens.output_tokens > 0) {
    console.log(`  ${DIM(`tokens: ${tokens.input_tokens} in / ${tokens.output_tokens} out`)}`)
  }

  console.log(GREEN_DIM('─'.repeat(60)))
  console.log('')
}
