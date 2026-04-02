/**
 * Orchestrator — top-level coordinator for multi-agent workflows.
 *
 * Provides runAgent(), runTeam(), and runTasks() entry points.
 */

import type {
  AgentConfig, AgentRunResult, TeamConfig, TeamRunResult,
  Task, LLMAdapter, OrchestratorConfig, OrchestratorEvent, TokenUsage,
} from './types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { PermissionManager } from './permissions.js'
import { Agent } from './agent.js'
import { Team } from './team.js'
import { TaskQueue } from '../communication/task-queue.js'
import { Semaphore } from '../scheduling/semaphore.js'

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 }

export class Orchestrator {
  private readonly adapter: LLMAdapter
  private readonly toolRegistry: ToolRegistry
  private readonly config: OrchestratorConfig
  private readonly permissionManager?: PermissionManager
  private readonly cwd: string
  private activeTeam?: Team

  constructor(
    adapter: LLMAdapter,
    toolRegistry: ToolRegistry,
    config: OrchestratorConfig = {},
    cwd?: string,
    permissionManager?: PermissionManager,
  ) {
    this.adapter = adapter
    this.toolRegistry = toolRegistry
    this.config = config
    this.cwd = cwd ?? process.cwd()
    this.permissionManager = permissionManager
  }

  /** Run a single agent on a task. */
  async runAgent(agentConfig: AgentConfig, task: string): Promise<AgentRunResult> {
    const agent = new Agent(
      agentConfig,
      this.adapter,
      this.toolRegistry,
      this.cwd,
      this.permissionManager,
    )

    this.emit({ type: 'agent_start', agent: agentConfig.name })
    const result = await agent.run(task)
    this.emit({ type: 'agent_complete', agent: agentConfig.name, data: result })

    return result
  }

  /** Run a team on a goal. Returns aggregated results from all agents. */
  async runTeam(teamConfig: TeamConfig, goal: string): Promise<TeamRunResult> {
    const team = new Team(
      teamConfig,
      this.adapter,
      this.toolRegistry,
      this.cwd,
      this.permissionManager,
    )

    this.activeTeam = team
    team.setProgressHandler(event => this.emit(event))

    const result = await team.run(goal)
    this.activeTeam = undefined

    return result
  }

  /**
   * Run a set of tasks with dependency resolution and agent assignment.
   * Uses topological ordering and semaphore-controlled parallelism.
   */
  async runTasks(
    tasks: Task[],
    agentConfigs: readonly AgentConfig[],
  ): Promise<{ results: Map<string, AgentRunResult>; totalUsage: TokenUsage }> {
    const queue = new TaskQueue()
    queue.addAll(tasks)
    const semaphore = new Semaphore(this.config.maxConcurrency ?? 2)
    const results = new Map<string, AgentRunResult>()
    let totalUsage: TokenUsage = ZERO_USAGE

    // Create agents
    const agents = new Map<string, Agent>()
    for (const config of agentConfigs) {
      agents.set(config.name, new Agent(
        config, this.adapter, this.toolRegistry, this.cwd, this.permissionManager,
      ))
    }

    // Process tasks in topological order, running independent tasks in parallel
    while (!queue.isFinished()) {
      const ready = queue.getReady()
      if (ready.length === 0) {
        // Check for deadlock
        const summary = queue.summary()
        if (summary.in_progress === 0) break // true deadlock or all done
        // Wait for in-progress tasks
        await new Promise(r => setTimeout(r, 100))
        continue
      }

      const batch = ready.map(task => {
        const agentName = task.assignee ?? agentConfigs[0].name
        const agent = agents.get(agentName) ?? agents.values().next().value!
        queue.start(task.id)
        this.emit({ type: 'task_start', task: task.id, agent: agentName })

        return semaphore.run(async () => {
          try {
            this.emit({ type: 'agent_start', agent: agentName })
            const result = await agent.run(task.description)
            results.set(task.id, result)
            totalUsage = addUsage(totalUsage, result.tokenUsage)
            queue.complete(task.id, result.output.slice(0, 500))
            this.emit({ type: 'task_complete', task: task.id, agent: agentName })
            this.emit({ type: 'agent_complete', agent: agentName })
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            queue.fail(task.id, error)
            this.emit({ type: 'error', task: task.id, agent: agentName, data: error.message })
          }
        })
      })

      await Promise.all(batch)
    }

    return { results, totalUsage }
  }

  /** Get the active team (if any). */
  getActiveTeam(): Team | undefined {
    return this.activeTeam
  }

  /** Get status of the active team. */
  getStatus(): { agents: Array<{ name: string; status: string }>; tasks?: ReturnType<TaskQueue['summary']> } | null {
    if (!this.activeTeam) return null
    return this.activeTeam.getStatus()
  }

  private emit(event: OrchestratorEvent): void {
    this.config.onProgress?.(event)
  }
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  }
}
