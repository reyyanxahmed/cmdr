/**
 * Ink-based REPL application — replaces raw readline.
 *
 * Architecture:
 * - <Static> renders all past output (scrollback, never re-rendered)
 * - Dynamic section: active spinner OR input prompt
 * - State machine: idle | processing | waiting_approval | exiting
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Box, Text, Static, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { Agent } from '../../core/agent.js'
import type { SessionManager } from '../../session/session-manager.js'
import type { PermissionManager } from '../../core/permissions.js'
import type { LLMAdapter, ToolUseBlock, ToolResultBlock, ApprovalDecision, ToolRiskLevel, TeamConfig } from '../../core/types.js'
import type { Orchestrator } from '../../core/orchestrator.js'
import type { RunCallbacks } from '../../core/agent-runner.js'
import { getDefaultContextLength } from '../../llm/model-registry.js'
import { isSlashCommand, parseSlashCommand, getCommand } from '../commands.js'
import {
  saveSession, loadSession, listSessions, findRecentSession, DebouncedSaver,
} from '../../session/session-persistence.js'
import { getTeamPreset } from '../../core/presets.js'
import type { CostTracker } from '../../session/cost-tracker.js'
import type { UndoManager } from '../../session/undo-manager.js'
import type { PluginManager } from '../../plugins/plugin-manager.js'
import type { McpClient } from '../../plugins/mcp-client.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { AgentRegistry } from '../../agents/registry.js'

// We use chalk directly for coloring since Ink <Text> color props are limited
import chalk from 'chalk'

const GREEN = chalk.hex('#00FF41')
const GREEN_DIM = chalk.hex('#00BB30')
const PURPLE = chalk.hex('#BF40FF')
const CYAN = chalk.hex('#00FFFF')
const DIM = chalk.hex('#555555')
const WHITE = chalk.hex('#E0E0E0')
const YELLOW = chalk.hex('#FFD700')
const RED = chalk.hex('#FF3333')
const SUCCESS_SYM = GREEN('✓')
const ERROR_SYM = RED('✗')
const TOOL_SYM = CYAN('⚡')
const SEPARATOR = GREEN_DIM('─'.repeat(60))

// ---------------------------------------------------------------------------
// Verb pool for spinner
// ---------------------------------------------------------------------------

const VERBS = [
  'Computing', 'Architecting', 'Bootstrapping', 'Compiling', 'Debugging',
  'Refactoring', 'Profiling', 'Indexing', 'Optimizing', 'Parsing',
  'Noodling', 'Percolating', 'Combobulating', 'Bamboozling', 'Cogitating',
  'Ruminating', 'Pondering', 'Brainstorming', 'Concocting', 'Devising',
  'Simmering', 'Marinating', 'Fermenting', 'Whisking', 'Reducing',
  'Moonwalking', 'Pirouetting', 'Sashaying', 'Waltzing', 'Commanding',
  'Strategizing', 'Maneuvering', 'Rallying', 'Scouting', 'Dispatching',
  'Crystallizing', 'Metamorphosing', 'Germinating', 'Blooming', 'Coalescing',
  'Weaving', 'Sculpting', 'Tinkering', 'Trailblazing', 'Questing',
]

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]
}

function toPastTense(verb: string): string {
  if (!verb.endsWith('ing')) return verb
  const stem = verb.slice(0, -3)
  const last = stem[stem.length - 1]
  if (last && 'bcdfghjklmnpqrstvwxyz'.includes(last.toLowerCase())) {
    return stem + 'ed'
  }
  return stem + 'ed'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReplState = 'idle' | 'processing' | 'waiting_approval' | 'exiting'

interface OutputLine {
  id: string
  text: string
}

interface ApprovalRequest {
  toolName: string
  input: Record<string, unknown>
  riskLevel: ToolRiskLevel
  resolve: (decision: ApprovalDecision) => void
}

export interface InkAppProps {
  agent: Agent
  session: SessionManager
  model: string
  permissionManager: PermissionManager
  adapter: LLMAdapter
  orchestrator: Orchestrator
  activeTeamConfig?: TeamConfig
  costTracker: CostTracker
  undoManager: UndoManager
  pluginManager: PluginManager
  mcpClient: McpClient
  toolRegistry: ToolRegistry
  agentRegistry: AgentRegistry
  ollamaUrl: string
  verbose: boolean
  doSave: () => Promise<void>
  autoSaver: DebouncedSaver
}

// ---------------------------------------------------------------------------
// Tool result summary
// ---------------------------------------------------------------------------

function summarizeToolResult(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
  isError?: boolean,
): string {
  const lineCount = content.split('\n').length
  const prefix = isError ? ERROR_SYM : SUCCESS_SYM
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
// Main App Component
// ---------------------------------------------------------------------------

let lineCounter = 0
function nextId(): string {
  return `line-${++lineCounter}`
}

export default function App(props: InkAppProps): React.ReactElement {
  const {
    agent, session, permissionManager, adapter,
    orchestrator, costTracker, undoManager,
    pluginManager, mcpClient, toolRegistry, agentRegistry, ollamaUrl, verbose,
    doSave, autoSaver,
  } = props

  const { exit } = useApp()

  const [state, setState] = useState<ReplState>('idle')
  const [inputValue, setInputValue] = useState('')
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [spinnerText, setSpinnerText] = useState('')
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [approvalInput, setApprovalInput] = useState('')
  const approvalQueueRef = useRef<ApprovalRequest[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const currentModelRef = useRef(props.model)
  const activeTeamRef = useRef(props.activeTeamConfig)
  const stateRef = useRef<ReplState>(state)
  const lastSigintRef = useRef(0)

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Append output to scrollback
  const appendOutput = useCallback((text: string) => {
    setOutputLines(prev => [...prev, { id: nextId(), text }])
  }, [])

  // Append multiple lines at once
  const appendLines = useCallback((lines: string[]) => {
    setOutputLines(prev => [
      ...prev,
      ...lines.map(text => ({ id: nextId(), text })),
    ])
  }, [])

  // ---------------------------------------------------------------------------
  // Spinner management
  // ---------------------------------------------------------------------------

  const spinnerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const verbRef = useRef(pickVerb())
  const spinnerStartRef = useRef(0)
  const spinnerFrameRef = useRef(0)
  const SPINNER_FRAMES = ['◇ ', '◈ ', '◆ ', '◈ ']

  const startSpinner = useCallback((mode: 'thinking' | 'tool', toolName?: string) => {
    stopSpinnerFn()
    spinnerStartRef.current = Date.now()
    verbRef.current = pickVerb()
    spinnerFrameRef.current = 0

    const update = () => {
      spinnerFrameRef.current = (spinnerFrameRef.current + 1) % SPINNER_FRAMES.length
      const frame = SPINNER_FRAMES[spinnerFrameRef.current]
      const elapsed = Math.round((Date.now() - spinnerStartRef.current) / 1000)

      if (mode === 'thinking') {
        // Rotate verb every ~3s
        if (elapsed > 0 && elapsed % 3 === 0) {
          verbRef.current = pickVerb()
        }
        setSpinnerText(`  ${PURPLE(frame)}${PURPLE(verbRef.current + '...')} ${DIM(`(${elapsed}s)`)}`)
      } else {
        setSpinnerText(`  ${CYAN('⚡')} ${CYAN(toolName ?? 'tool')} ${DIM('executing...')}`)
      }
    }

    update()
    spinnerRef.current = setInterval(update, 120)
  }, [])

  const stopSpinnerFn = useCallback(() => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
    }
    setSpinnerText('')
  }, [])

  const getCompletionSummary = useCallback(() => {
    const elapsed = Math.round((Date.now() - spinnerStartRef.current) / 1000)
    return `${toPastTense(verbRef.current)} for ${elapsed}s`
  }, [])

  // ---------------------------------------------------------------------------
  // Cleanup & Exit
  // ---------------------------------------------------------------------------

  const cleanupAndExit = useCallback(async () => {
    if (stateRef.current === 'exiting') return
    setState('exiting')
    stopSpinnerFn()

    autoSaver.cancel()
    session.syncFromAgent(agent.getHistory())
    if (session.messages.length > 0) {
      try {
        const sid = await saveSession(session.getState(), currentModelRef.current)
        appendOutput(`\n  ${DIM('Session saved:')} ${DIM(sid)}`)
      } catch {
        // best effort
      }
    }
    appendOutput(`\n  ${PURPLE('Goodbye.')} ${DIM('Session ended.')}\n`)

    // Give Ink a moment to render the final output
    setTimeout(() => {
      exit()
      process.exit(0)
    }, 100)
  }, [agent, session, autoSaver, stopSpinnerFn, appendOutput, exit])

  // Signal handlers
  useEffect(() => {
    const onSigterm = () => { cleanupAndExit() }
    process.on('SIGTERM', onSigterm)
    process.on('SIGHUP', onSigterm)
    return () => {
      process.off('SIGTERM', onSigterm)
      process.off('SIGHUP', onSigterm)
    }
  }, [cleanupAndExit])

  // ---------------------------------------------------------------------------
  // Handle user message (streaming)
  // ---------------------------------------------------------------------------

  const handleUserMessage = useCallback(async (message: string) => {
    appendOutput('')

    startSpinner('thinking')

    let fullOutput = ''
    let firstText = true
    let currentTool = ''
    let currentToolInput: Record<string, unknown> = {}
    let toolCallCount = 0

    const abortController = new AbortController()
    abortRef.current = abortController

    const callbacks: RunCallbacks = {
      onToolApproval: (toolName, input, riskLevel) => {
        return new Promise<ApprovalDecision>((resolve) => {
          stopSpinnerFn()
          const request: ApprovalRequest = { toolName, input, riskLevel, resolve }
          // If we're already showing an approval prompt, queue this one
          if (stateRef.current === 'waiting_approval') {
            approvalQueueRef.current.push(request)
          } else {
            setApproval(request)
            setState('waiting_approval')
          }
        })
      },
    }

    try {
      for await (const event of agent.stream(message, callbacks, abortController.signal)) {
        switch (event.type) {
          case 'text': {
            if (firstText) {
              stopSpinnerFn()
              firstText = false
            }
            const chunk = event.data as string
            fullOutput += chunk
            // Stream text by appending to the last output line
            // We'll accumulate and print at the end for cleaner output
            break
          }

          case 'tool_use': {
            stopSpinnerFn()
            if (!firstText) {
              // Flush accumulated text
              if (fullOutput) {
                const formatted = fullOutput.split('\n').map(l => `  ${PURPLE('│')} ${l}`).join('\n')
                appendOutput(formatted)
                fullOutput = ''
              }
              firstText = true
            }
            const block = event.data as ToolUseBlock
            currentTool = block.name
            currentToolInput = block.input
            toolCallCount++

            if (undoManager && (block.name === 'file_write' || block.name === 'file_edit')) {
              const filePath = (block.input.path ?? block.input.file_path) as string | undefined
              if (filePath) {
                await undoManager.recordBefore(filePath, block.name === 'file_write' ? 'write' : 'edit')
              }
            }

            // Render tool exec line
            const toolSummary = Object.entries(block.input)
              .map(([k, v]) => {
                const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
                return `${DIM(k + ':')} ${WHITE(val)}`
              })
              .join(' ')
            appendOutput(`  ${TOOL_SYM} ${CYAN.bold(block.name)} ${toolSummary}`)
            startSpinner('tool', block.name)
            break
          }

          case 'tool_result': {
            stopSpinnerFn()
            const block = event.data as ToolResultBlock

            if (verbose) {
              const truncated = block.content.length > 2000
                ? block.content.slice(0, 2000) + DIM('\n... (truncated)')
                : block.content
              const prefix = block.is_error ? ERROR_SYM : SUCCESS_SYM
              appendOutput(`  ${prefix} ${DIM(currentTool + ':')} ${block.is_error ? RED(truncated) : DIM(truncated)}`)
            } else {
              appendOutput(summarizeToolResult(currentTool, currentToolInput, block.content, block.is_error))
            }

            currentTool = ''
            currentToolInput = {}
            startSpinner('thinking')
            firstText = true
            break
          }

          case 'done': {
            stopSpinnerFn()
            break
          }

          case 'error': {
            stopSpinnerFn()
            const err = event.data as Error
            appendOutput(`\n  ${ERROR_SYM} ${RED.bold(err.message)}\n`)
            break
          }
        }
      }
    } catch (err) {
      stopSpinnerFn()
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not found') || msg.includes('404') || (msg.includes('model') && msg.includes('pull'))) {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(
          `Model '${currentModelRef.current}' not found. Run ${GREEN('/models')} to see available models or ${GREEN('/model <name>')} to switch.`,
        )}\n`)
      } else {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
      }
    }

    // Flush remaining text
    if (fullOutput) {
      const formatted = fullOutput.split('\n').map(l => `  ${PURPLE('│')} ${l}`).join('\n')
      appendOutput(formatted)
    }

    if (fullOutput || !firstText) {
      appendOutput('')
    }

    // Turn summary
    const agentState = agent.getState()
    const tokens = agentState.tokenUsage
    const summary = getCompletionSummary()
    const tokenInfo = tokens.input_tokens > 0 || tokens.output_tokens > 0
      ? `  ${DIM('·')}  ${DIM(`${tokens.input_tokens} in / ${tokens.output_tokens} out`)}`
      : ''
    appendOutput(`  ${DIM(summary)}${tokenInfo}`)

    costTracker.record(currentModelRef.current, tokens.input_tokens, tokens.output_tokens, toolCallCount)
    session.syncFromAgent(agent.getHistory())

    // Auto-compact if needed
    if (session.shouldCompact()) {
      try {
        const stats = await session.compact(adapter, currentModelRef.current)
        agent.replaceMessages(session.messages)
        appendOutput(`  ${DIM(`◇ compacted: ${stats.before} messages → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`)
      } catch {
        // best effort
      }
    }

    autoSaver.schedule(doSave)
    appendOutput(SEPARATOR)
    appendOutput('')
  }, [agent, session, adapter, costTracker, undoManager, verbose, autoSaver, doSave,
      appendOutput, startSpinner, stopSpinnerFn, getCompletionSummary])

  // ---------------------------------------------------------------------------
  // Handle team message
  // ---------------------------------------------------------------------------

  const handleTeamMessage = useCallback(async (goal: string, teamConfig: TeamConfig) => {
    appendOutput('')
    appendOutput(`  ${PURPLE('◈')} Running team ${PURPLE.bold(teamConfig.name)} with ${teamConfig.agents.length} agents...`)
    appendOutput('')
    startSpinner('thinking')

    try {
      const result = await orchestrator.runTeam(teamConfig, goal)
      stopSpinnerFn()

      for (const [agentName, agentResult] of result.agentResults) {
        const status = agentResult.success ? GREEN('✓') : RED('✗')
        appendOutput(`  ${status} ${CYAN(agentName)}`)

        if (agentResult.output) {
          const lines = agentResult.output.split('\n')
          const displayLines = verbose ? lines : lines.slice(0, 20)
          for (const line of displayLines) {
            appendOutput(`  ${PURPLE('│')} ${line}`)
          }
          if (!verbose && lines.length > 20) {
            appendOutput(`  ${PURPLE('│')} ${DIM(`... ${lines.length - 20} more lines (use --verbose)`)}`)
          }
          appendOutput('')
        }

        if (agentResult.toolCalls.length > 0) {
          const tools = agentResult.toolCalls.map(t => t.toolName)
          const unique = [...new Set(tools)]
          appendOutput(`  ${DIM(`  tools: ${unique.join(', ')} (${tools.length} calls)`)}`)
        }
      }

      const usage = result.totalTokenUsage
      const summary = getCompletionSummary()
      const tokenInfo = `${usage.input_tokens} in / ${usage.output_tokens} out`
      appendOutput(`  ${DIM(summary)}  ${DIM('·')}  ${DIM(tokenInfo)}`)
      appendOutput(`  ${result.success ? GREEN('Team completed successfully') : RED('Team had failures')}`)
    } catch (err) {
      stopSpinnerFn()
      const msg = err instanceof Error ? err.message : String(err)
      appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
    }

    appendOutput(SEPARATOR)
    appendOutput('')
  }, [orchestrator, verbose, appendOutput, startSpinner, stopSpinnerFn, getCompletionSummary])

  // ---------------------------------------------------------------------------
  // Process slash commands
  // ---------------------------------------------------------------------------

  const processCommand = useCallback(async (input: string): Promise<boolean> => {
    const { name, args } = parseSlashCommand(input)
    const cmd = getCommand(name)
    if (!cmd) {
      appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Unknown command: /${name}. Type /help for available commands.`)}\n`)
      return false
    }

    const result = await cmd.execute(args, {
      session: session.getState(),
      switchModel: (model: string) => {
        currentModelRef.current = model
        agent.setModel(model)
        session.updateContextLength(getDefaultContextLength(model))
      },
      clearHistory: () => {
        session.clear()
        agent.reset()
        permissionManager.resetSession()
      },
      ollamaUrl,
      adapter,
      model: currentModelRef.current,
      agentTokenUsage: agent.getState().tokenUsage,
      permissionManager,
    })

    if (result === '__QUIT__') {
      await cleanupAndExit()
      return true
    }

    if (result === '__COMPACT__') {
      session.syncFromAgent(agent.getHistory())
      const stats = await session.compact(adapter, currentModelRef.current)
      agent.replaceMessages(session.messages)
      appendOutput(`  ${DIM('ℹ')} ${WHITE(`${DIM(`◇ compacted: ${stats.before} messages → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`)}`)
      return false
    }

    if (result === '__DIFF__') {
      const gitTool = toolRegistry.get('git_diff')
      if (gitTool) {
        const diffResult = await gitTool.execute({ staged: false }, {
          agent: { name: 'cmdr', role: 'assistant', model: currentModelRef.current },
          cwd: process.cwd(),
        })
        appendOutput(`\n${WHITE(diffResult.data)}\n`)
      }
      return false
    }

    if (result === '__SESSION_SAVE__') {
      session.syncFromAgent(agent.getHistory())
      if (session.messages.length > 0) {
        const sid = await saveSession(session.getState(), currentModelRef.current)
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Session saved: ${DIM(sid)}`)}`)
      } else {
        appendOutput(`  ${DIM('ℹ')} ${WHITE('No messages to save.')}`)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__SESSION_RESUME__:')) {
      const sessionId = result.slice('__SESSION_RESUME__:'.length)
      const saved = await loadSession(sessionId)
      if (saved) {
        agent.replaceMessages(saved.messages)
        session.syncFromAgent(saved.messages)
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Resumed session ${DIM(saved.id)} (${saved.messages.length} messages)`)}`)
      } else {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Session not found: ${sessionId}`)}\n`)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__TEAM_SWITCH__:')) {
      const preset = result.slice('__TEAM_SWITCH__:'.length)
      const teamCfg = getTeamPreset(preset)
      if (teamCfg) {
        activeTeamRef.current = teamCfg
        const teamAgents = teamCfg.agents.map(a => a.name).join(', ')
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Switched to team: ${PURPLE(teamCfg.name)} (${teamAgents})`)}`)
      } else {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Unknown team: ${preset}. Use: review, fullstack, security`)}\n`)
      }
      return false
    }

    if (result === '__AGENTS_STATUS__') {
      const agents = agentRegistry.list()
      if (agents.length === 0) {
        appendOutput(`  ${DIM('No subagents loaded. Place .md files in .cmdr/agents/ or ~/.cmdr/agents/')}`)
      } else {
        const lines = ['', `  ${PURPLE.bold('Subagents')} ${DIM(`(${agents.length})`)}`, '']
        for (const ag of agents) {
          const sourceLabel = ag.source === 'bundled' ? DIM('[bundled]') : ag.source === 'user' ? DIM('[user]') : DIM('[project]')
          const toolCount = ag.tools.length
          lines.push(`  ${GREEN('•')} ${CYAN(ag.name.padEnd(16))} ${WHITE(ag.description.slice(0, 60))}`)
          lines.push(`    ${DIM(`${toolCount} tools · ${ag.maxTurns} turns · temp ${ag.temperature}`)} ${sourceLabel}`)
        }
        lines.push('')
        lines.push(`  ${DIM('Use @<name> <task> to delegate, or /agents info <name> for details.')}`)
        lines.push('')
        appendLines(lines)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__AGENT_INFO__:')) {
      const agentName = result.slice('__AGENT_INFO__:'.length)
      const ag = agentRegistry.get(agentName)
      if (!ag) {
        appendOutput(`  ${ERROR_SYM} ${RED(`Unknown agent: ${agentName}`)}`)
      } else {
        const lines = [
          '',
          `  ${PURPLE.bold(ag.name)} ${DIM(`[${ag.source}]`)}`,
          `  ${WHITE(ag.description)}`,
          '',
          `  ${DIM('Kind:')}        ${ag.kind}`,
          `  ${DIM('Model:')}       ${ag.model ?? 'inherit from parent'}`,
          `  ${DIM('Temperature:')} ${ag.temperature}`,
          `  ${DIM('Max turns:')}   ${ag.maxTurns}`,
          `  ${DIM('Tools:')}       ${ag.tools.join(', ') || 'none'}`,
          `  ${DIM('Source:')}      ${ag.filePath}`,
          '',
          `  ${DIM('System prompt:')}`,
          ...ag.systemPrompt.split('\n').slice(0, 10).map(l => `  ${DIM('│')} ${WHITE(l)}`),
          ag.systemPrompt.split('\n').length > 10 ? `  ${DIM(`  ... (${ag.systemPrompt.split('\n').length - 10} more lines)`)}` : '',
          '',
        ]
        appendLines(lines.filter(Boolean))
      }
      return false
    }

    if (result === '__TASKS_STATUS__') {
      const status = orchestrator.getStatus()
      if (!status) {
        appendOutput(`  ${DIM('ℹ')} ${WHITE('No active team or tasks.')}`)
      } else {
        const s = status.tasks
        if (s) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE(
            `Tasks: ${GREEN(`${s.completed} done`)} · ${YELLOW(`${s.in_progress} running`)} · ${DIM(`${s.pending} pending`)} · ${s.failed > 0 ? RED(`${s.failed} failed`) : DIM('0 failed')}`,
          )}`)
        }
      }
      return false
    }

    if (result === '__COST__') {
      const summary = costTracker.getSummary()
      const elapsed = costTracker.formatElapsed()
      appendLines([
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
      ])
      return false
    }

    if (result === '__UNDO__') {
      if (undoManager.count === 0) {
        appendOutput(`  ${DIM('ℹ')} ${WHITE('Nothing to undo.')}`)
      } else {
        const change = await undoManager.undoLast()
        if (change) {
          const action = change.originalContent === null ? 'deleted' : 'restored'
          const fname = change.path.split('/').pop() ?? change.path
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Undid ${change.type} on ${GREEN(fname)} (${action})`)}`)
        }
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__PLUGIN__:')) {
      const sub = result.slice('__PLUGIN__:'.length).trim()
      if (sub === 'list' || !sub) {
        const plugins = pluginManager.list()
        if (plugins.length === 0) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('No plugins loaded. Add plugins to ~/.cmdr/config.toml')}`)
        } else {
          appendLines(['', `  ${PURPLE.bold('Loaded plugins')}`, ''])
          for (const p of plugins) {
            const hooks = p.hooks ? Object.keys(p.hooks).length : 0
            const tools = p.tools?.length ?? 0
            appendOutput(`  ${GREEN('•')} ${WHITE(p.name)} v${p.version} ${DIM(`(${hooks} hooks, ${tools} tools)`)}`)
          }
          appendOutput('')
        }
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__MCP__:')) {
      const sub = result.slice('__MCP__:'.length).trim().split(/\s+/)
      const action = sub[0]

      if (action === 'list' || !action) {
        const conns = mcpClient.listConnections()
        if (conns.length === 0) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('No MCP servers connected. Add to ~/.cmdr/config.toml or use /mcp connect <name> <url>')}`)
        } else {
          appendLines(['', `  ${PURPLE.bold('MCP servers')}`, ''])
          for (const c of conns) {
            const status = c.connected ? GREEN('connected') : RED('disconnected')
            appendOutput(`  ${GREEN('•')} ${WHITE(c.name)} ${DIM(c.url)} ${status} ${DIM(`(${c.tools} tools)`)}`)
          }
          appendOutput('')
        }
      } else if (action === 'connect') {
        const name = sub[1]
        const url = sub[2]
        if (!name || !url) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('Usage: /mcp connect <name> <url>')}`)
        } else {
          try {
            const tools = await mcpClient.connect({ name, url })
            mcpClient.registerTools(toolRegistry)
            appendOutput(`  ${DIM('ℹ')} ${WHITE(`Connected to ${name}: ${tools.length} tools discovered`)}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
          }
        }
      } else if (action === 'disconnect') {
        const name = sub[1]
        if (name && mcpClient.disconnect(name)) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Disconnected from ${name}`)}`)
        } else {
          appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`MCP server "${name}" not found`)}\n`)
        }
      }
      return false
    }

    if (result) appendOutput(String(result))
    return false
  }, [agent, session, permissionManager, adapter, ollamaUrl, toolRegistry,
      orchestrator, costTracker, undoManager, pluginManager, mcpClient,
      cleanupAndExit, appendOutput, appendLines])

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async (value: string) => {
    const input = value.trim()
    setInputValue('')

    if (!input) return
    if (stateRef.current !== 'idle') return

    // Echo user input
    appendOutput(`${GREEN.bold('❯')} ${WHITE(input)}`)

    setState('processing')

    try {
      if (isSlashCommand(input)) {
        const shouldExit = await processCommand(input)
        if (shouldExit) return
      } else if (input.startsWith('@')) {
        // @agent syntax: @investigator explain the auth flow
        const spaceIdx = input.indexOf(' ')
        const agentName = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
        const agentTask = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1).trim()

        if (agentRegistry.has(agentName)) {
          if (!agentTask) {
            appendOutput(`  ${ERROR_SYM} ${RED('Usage:')} @${agentName} <task description>`)
          } else {
            const delegateMsg = `[System: The user has requested the "${agentName}" subagent. Please immediately call the "${agentName}" tool with the following task: ${agentTask}]`
            await handleUserMessage(delegateMsg)
          }
        } else {
          appendOutput(`  ${ERROR_SYM} ${RED(`Unknown agent: ${agentName}`)}. Use /agents to list available agents.`)
        }
      } else if (activeTeamRef.current) {
        await handleTeamMessage(input, activeTeamRef.current)
      } else {
        await handleUserMessage(input)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
    } finally {
      // stateRef.current may have changed during async processing (TS narrows incorrectly here)
      if ((stateRef.current as ReplState) !== 'exiting') {
        setState('idle')
      }
    }
  }, [appendOutput, processCommand, handleUserMessage, handleTeamMessage])

  // ---------------------------------------------------------------------------
  // Keyboard input handling (Ctrl+C, Ctrl+D)
  // ---------------------------------------------------------------------------

  useInput((input, key) => {
    // Ctrl+C handling
    if (key.ctrl && input === 'c') {
      const now = Date.now()
      if (now - lastSigintRef.current < 1000) {
        cleanupAndExit()
        return
      }
      lastSigintRef.current = now

      if (stateRef.current === 'processing' || stateRef.current === 'waiting_approval') {
        // Abort the current agent turn
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
        // Drain any pending approval queue
        for (const pending of approvalQueueRef.current) {
          pending.resolve('deny')
        }
        approvalQueueRef.current = []
        if (approval) {
          approval.resolve('deny')
          setApproval(null)
        }
        appendOutput(`\n  ${DIM('Interrupt — press Ctrl+C again to exit.')}`)
      } else if (stateRef.current === 'idle') {
        appendOutput(`  ${DIM('Press Ctrl+C again to exit.')}`)
      }
      return
    }

    // Ctrl+D — ignore (don't close)
    if (key.ctrl && input === 'd') {
      return
    }
  })

  // ---------------------------------------------------------------------------
  // Handle approval input
  // ---------------------------------------------------------------------------

  const handleApprovalSubmit = useCallback((value: string) => {
    if (!approval) return
    const trimmed = value.trim().toLowerCase()
    setApprovalInput('')

    let decision: ApprovalDecision
    if (trimmed === 'y' || trimmed === 'yes' || trimmed === '') {
      decision = 'allow'
    } else if (trimmed === 'a' || trimmed === 'always') {
      decision = 'allow-always'
    } else {
      decision = 'deny'
    }

    const resolve = approval.resolve
    setApproval(null)

    // Show next queued approval, or return to processing
    const next = approvalQueueRef.current.shift()
    if (next) {
      setApproval(next)
      // Stay in waiting_approval state
    } else {
      setState('processing')
    }

    resolve(decision)
  }, [approval])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Box flexDirection="column">
      {/* Scrollback — all past output */}
      <Static items={outputLines}>
        {(line) => (
          <Text key={line.id}>{line.text}</Text>
        )}
      </Static>

      {/* Active spinner (only during processing) */}
      {state === 'processing' && spinnerText && (
        <Text>{spinnerText}</Text>
      )}

      {/* Approval prompt */}
      {state === 'waiting_approval' && approval && (
        <Box flexDirection="column">
          <Text>{''}</Text>
          <Text>{`  ${YELLOW('⚠')}  ${WHITE('Tool approval required')} ${DIM('[')}${
            approval.riskLevel === 'dangerous' ? RED(approval.riskLevel.toUpperCase()) : YELLOW(approval.riskLevel.toUpperCase())
          }${DIM(']')}`}</Text>
          <Text>{`  ${DIM('Tool:')}  ${CYAN(approval.toolName)}`}</Text>
          {Object.entries(approval.input).map(([key, val]) => {
            const display = typeof val === 'string'
              ? val.length > 120 ? val.slice(0, 120) + DIM('...') : val
              : JSON.stringify(val).slice(0, 120)
            return <Text key={key}>{`  ${DIM(key + ':')}  ${WHITE(display)}`}</Text>
          })}
          <Text>{''}</Text>
          <Text>{`  ${GREEN('y')}${DIM('es')}  ${DIM('/')}  ${RED('n')}${DIM('o')}  ${DIM('/')}  ${PURPLE('a')}${DIM('lways allow this tool')}`}</Text>
          <Box>
            <Text>{`  ${YELLOW('?')} `}</Text>
            <TextInput
              value={approvalInput}
              onChange={setApprovalInput}
              onSubmit={handleApprovalSubmit}
            />
          </Box>
        </Box>
      )}

      {/* Input prompt (only when idle) */}
      {state === 'idle' && (
        <Box>
          <Text>{GREEN.bold('❯')} </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  )
}
