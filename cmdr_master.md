# CMDR: Master Build Prompt

> **Purpose**: This document is a comprehensive architect-level prompt for Claude Opus 4 to design and implement **cmdr**, an open-source, Ollama-native, multi-agent terminal coding tool. It synthesizes the best patterns from two reference repositories into a single cohesive product.

---

## 1. PROJECT IDENTITY

**Name**: cmdr (pronounced "commander")  
**Tagline**: Open-source multi-agent coding tool for your terminal. Powered by local LLMs via Ollama.  
**License**: MIT  
**Language**: TypeScript (Node.js >= 20)  
**Package Manager**: npm  
**Binary Name**: `cmdr`  
**Author**: Reyyan Ahmed (github.com/reyyanxahmed)

### Design Philosophy
- **Local-first**: Ollama is the primary and default backend. No API keys required to start.
- **Multi-agent by default**: Every task can be decomposed across specialized agents (planner, coder, reviewer, executor).
- **Terminal-native**: Interactive REPL with rich markdown rendering, spinner states, and streaming output.
- **Extensible**: Plugin system, custom tools, MCP server support, and slash commands.
- **Model-agnostic escape hatch**: While Ollama is primary, the LLM adapter layer supports OpenAI-compatible endpoints, Anthropic, and any HTTP-based inference server.

---

## 2. REFERENCE REPOSITORIES: WHAT TO TAKE FROM EACH

### 2A. From `ultraworkers/claw-code` (Python + Rust agent harness)

Extract these **architectural patterns** (not code, design patterns only):

| Pattern | What it does | How cmdr uses it |
|---|---|---|
| **Session state + compaction** | Maintains conversation history with intelligent truncation when context gets long | cmdr's `SessionManager` compacts old turns, keeps tool results summarized, stays within model context window |
| **Prompt construction pipeline** | Assembles system prompt + context + tools + user message through a composable pipeline | cmdr's `PromptBuilder` chains: system prompt -> project context -> active file context -> tool definitions -> conversation history -> user message |
| **Tool manifest system** | Declarative tool definitions with schema, execution, and permission model | cmdr's `ToolRegistry` with typed definitions, sandboxed execution, and permission tiers (read/write/execute/network) |
| **Slash commands** | `/help`, `/model`, `/clear`, `/compact`, `/cost` etc. for in-REPL control | cmdr implements slash commands as first-class REPL features |
| **Plugin/hook pipeline** | Plugins can intercept and modify behavior at defined lifecycle points | cmdr's plugin system with hooks: `beforePrompt`, `afterResponse`, `beforeToolExec`, `afterToolExec`, `onError` |
| **MCP orchestration** | Connects to Model Context Protocol servers for external tool integration | cmdr acts as an MCP client, can connect to any MCP server for expanded tool access |
| **Interactive REPL** | Terminal-based read-eval-print loop with markdown rendering and project bootstrapping | cmdr's primary interface, with ink or raw readline + marked for rendering |
| **Project context discovery** | Reads .git, package.json, Cargo.toml, pyproject.toml etc. to understand the project | cmdr auto-discovers project type, language, structure on startup |

### 2B. From `JackChen-me/open-multi-agent` (TypeScript multi-agent framework)

Extract these **concrete implementations** and adapt them:

| Component | What it does | How cmdr adapts it |
|---|---|---|
| **OpenMultiAgent orchestrator** | Top-level coordinator that decomposes goals into tasks and assigns agents | cmdr's `Orchestrator` class, but with Ollama as default backend |
| **AgentConfig + Agent class** | Typed agent definitions with name, model, systemPrompt, tools, maxTurns | Direct adoption, extended with `provider: 'ollama'` default |
| **AgentRunner conversation loop** | The core model -> tool_use -> tool_result -> model turn loop | Direct adoption, this is the heart of cmdr |
| **Team + MessageBus + SharedMemory** | Multi-agent collaboration primitives | Direct adoption for multi-agent coding workflows |
| **TaskQueue with dependency graph** | Topological task scheduling, auto-unblock, cascade failure | Direct adoption for complex multi-step coding tasks |
| **LLMAdapter abstraction** | Provider-agnostic interface (AnthropicAdapter, OpenAIAdapter) | Extended with `OllamaAdapter` as primary, using Ollama's OpenAI-compatible endpoint |
| **ToolRegistry + ToolExecutor** | Typed tool definitions with Zod schemas, registry pattern | Direct adoption, extended with more coding tools |
| **defineTool() pattern** | Clean tool definition API with Zod input schemas | Direct adoption |
| **Built-in tools** (bash, file_read, file_write, file_edit, grep) | Core filesystem and shell tools | Direct adoption as cmdr's base tool suite |
| **Streaming via AsyncGenerator** | `stream()` method yielding `StreamEvent` objects | Direct adoption for real-time terminal output |
| **4 scheduling strategies** | round-robin, least-busy, capability-match, dependency-first | Direct adoption, default to capability-match for coding |
| **Parallel execution with Semaphore** | Configurable maxConcurrency for independent tasks | Direct adoption |

---

## 3. ARCHITECTURE

### 3.1 High-Level Architecture

```
cmdr CLI binary (interactive REPL)
    |
    v
┌─────────────────────────────────────────────────────────────────────┐
│  Orchestrator                                                       │
│                                                                     │
│  runAgent()  |  runTeam()  |  runTasks()  |  getStatus()            │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐        │
│  │ SessionMgr   │  │ PromptBuilder│  │ ProjectContext      │        │
│  │ - history    │  │ - system     │  │ - language          │        │
│  │ - compaction │  │ - context    │  │ - framework         │        │
│  │ - token count│  │ - tools      │  │ - structure         │        │
│  └──────────────┘  │ - history    │  │ - git state         │        │
│                    └──────────────┘  └────────────────────┘        │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
            ┌──────────v──────────┐
            │  Team               │
            │  - agents[]         │
            │  - MessageBus       │
            │  - TaskQueue        │
            │  - SharedMemory     │
            └──────────┬──────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
┌────────v──────────┐     ┌───────────v───────────┐
│  AgentPool        │     │  TaskQueue             │
│  - Semaphore      │     │  - dependency DAG      │
│  - runParallel()  │     │  - topological sort    │
└────────┬──────────┘     │  - cascade failure     │
         │                └───────────────────────┘
┌────────v──────────┐
│  Agent            │
│  - run()          │     ┌──────────────────────────────┐
│  - stream()       │────>│  LLMAdapter                  │
│  - prompt()       │     │  - OllamaAdapter (default)   │
└────────┬──────────┘     │  - OpenAICompatAdapter       │
         │                │  - AnthropicAdapter           │
         │                └──────────────────────────────┘
┌────────v──────────┐
│  AgentRunner      │     ┌──────────────────────────────┐
│  - conversation   │────>│  ToolRegistry                │
│    loop           │     │  - bash, file_read,          │
│  - tool dispatch  │     │    file_write, file_edit,    │
│  - turn control   │     │    grep, glob, git_diff,     │
│  - error recovery │     │    git_log, web_fetch,       │
└───────────────────┘     │    think, ask_user           │
                          │  - MCP tools (dynamic)       │
                          │  - Plugin tools (dynamic)    │
                          └──────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Plugin System                                                      │
│                                                                     │
│  Hooks: beforePrompt | afterResponse | beforeToolExec |             │
│         afterToolExec | onError | onSessionStart | onSessionEnd     │
│                                                                     │
│  MCP Client: connects to external MCP servers for tool expansion    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Directory Structure

```
cmdr/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── cmdr.ts                    # CLI entry point, shebang, arg parsing
├── src/
│   ├── index.ts                   # Public API exports
│   │
│   ├── cli/
│   │   ├── repl.ts                # Interactive REPL loop (readline + streaming output)
│   │   ├── renderer.ts            # Markdown rendering for terminal (marked + chalk)
│   │   ├── spinner.ts             # Loading/thinking indicators
│   │   ├── commands.ts            # Slash command registry and handlers
│   │   └── args.ts                # CLI argument parsing (--model, --team, --ollama-url, etc.)
│   │
│   ├── core/
│   │   ├── orchestrator.ts        # Top-level Orchestrator (from open-multi-agent's OpenMultiAgent)
│   │   ├── agent.ts               # Agent class with run(), stream(), prompt()
│   │   ├── agent-runner.ts        # Conversation loop: model -> tool_use -> tool_result -> model
│   │   ├── agent-config.ts        # AgentConfig type definitions
│   │   ├── team.ts                # Team: agents + message bus + task queue + shared memory
│   │   ├── agent-pool.ts          # Parallel agent execution with semaphore
│   │   ├── presets.ts             # Pre-built agent configs (planner, coder, reviewer, executor)
│   │   └── types.ts               # Shared type definitions
│   │
│   ├── llm/
│   │   ├── adapter.ts             # LLMAdapter interface
│   │   ├── ollama.ts              # OllamaAdapter: primary backend via /api/chat
│   │   ├── openai-compat.ts       # OpenAI-compatible adapter (also works with Ollama's /v1/ endpoint)
│   │   ├── anthropic.ts           # AnthropicAdapter for cloud fallback
│   │   ├── model-registry.ts      # Known models, their context windows, tool-use capability flags
│   │   └── token-counter.ts       # Approximate token counting for context management
│   │
│   ├── session/
│   │   ├── session-manager.ts     # Conversation history, compaction, context budget
│   │   ├── prompt-builder.ts      # Composable prompt construction pipeline
│   │   ├── project-context.ts     # Auto-discover project language, framework, structure
│   │   └── compaction.ts          # Intelligent history summarization when context is full
│   │
│   ├── tools/
│   │   ├── registry.ts            # ToolRegistry: register, lookup, list tools
│   │   ├── executor.ts            # ToolExecutor: dispatch tool calls, handle errors
│   │   ├── define-tool.ts         # defineTool() helper with Zod schema
│   │   ├── permissions.ts         # Permission tiers: read, write, execute, network
│   │   ├── built-in/
│   │   │   ├── bash.ts            # Shell command execution (timeout, cwd, streaming)
│   │   │   ├── file-read.ts       # Read file contents (offset, limit for large files)
│   │   │   ├── file-write.ts      # Write/create files (auto-mkdir)
│   │   │   ├── file-edit.ts       # Edit by exact string replacement
│   │   │   ├── grep.ts            # Regex search (ripgrep when available, Node.js fallback)
│   │   │   ├── glob.ts            # File pattern matching for discovery
│   │   │   ├── git-diff.ts        # Show git diff of working tree or staged changes
│   │   │   ├── git-log.ts         # Recent git history
│   │   │   ├── think.ts           # Extended thinking scratchpad (no side effects)
│   │   │   └── ask-user.ts        # Prompt the user for input/confirmation mid-task
│   │   └── index.ts               # registerBuiltInTools() export
│   │
│   ├── communication/
│   │   ├── message-bus.ts         # Inter-agent message passing
│   │   ├── shared-memory.ts       # Shared key-value store across agents in a team
│   │   └── task-queue.ts          # Task DAG with dependency resolution, topological sort
│   │
│   ├── scheduling/
│   │   ├── strategies.ts          # round-robin, least-busy, capability-match, dependency-first
│   │   └── semaphore.ts           # Concurrency limiter for parallel agent execution
│   │
│   ├── plugins/
│   │   ├── plugin-manager.ts      # Load, register, lifecycle management
│   │   ├── plugin-types.ts        # Plugin interface, hook definitions
│   │   └── mcp-client.ts          # MCP client: connect to external MCP servers
│   │
│   └── config/
│       ├── config-loader.ts       # Load from ~/.cmdr/config.toml, .cmdr.toml, env vars
│       ├── defaults.ts            # Default configuration values
│       └── schema.ts              # Configuration schema with Zod validation
│
├── presets/
│   ├── solo-coder.ts              # Single-agent preset for quick tasks
│   ├── code-review-team.ts        # Coder + Reviewer duo
│   ├── full-stack-team.ts         # Planner + Frontend + Backend + Reviewer
│   └── security-audit-team.ts     # Scanner + Analyzer + Reporter
│
├── tests/
│   ├── unit/
│   │   ├── agent-runner.test.ts
│   │   ├── task-queue.test.ts
│   │   ├── tool-registry.test.ts
│   │   ├── session-manager.test.ts
│   │   ├── prompt-builder.test.ts
│   │   ├── ollama-adapter.test.ts
│   │   └── compaction.test.ts
│   └── integration/
│       ├── single-agent.test.ts
│       ├── multi-agent-team.test.ts
│       └── mcp-client.test.ts
│
└── docs/
    ├── ARCHITECTURE.md
    ├── TOOLS.md
    ├── PLUGINS.md
    ├── CONFIGURATION.md
    └── CONTRIBUTING.md
```

### 3.3 Core Data Types

```typescript
// ─── LLM Adapter ─────────────────────────────────────────────

interface LLMAdapter {
  complete(params: CompletionParams): Promise<CompletionResult>
  stream(params: CompletionParams): AsyncGenerator<StreamEvent>
  countTokens(text: string): number
  modelInfo(): ModelInfo
}

interface CompletionParams {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
}

interface CompletionResult {
  content: ContentBlock[]        // text blocks and tool_use blocks
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

type StreamEvent =
  | { type: 'text'; data: string }
  | { type: 'tool_use_start'; toolName: string; toolId: string }
  | { type: 'tool_use_delta'; data: string }
  | { type: 'tool_result'; toolId: string; result: string }
  | { type: 'turn_complete'; stopReason: string }
  | { type: 'error'; error: Error }

// ─── Agent ───────────────────────────────────────────────────

interface AgentConfig {
  name: string
  model?: string                  // defaults to config.defaultModel
  provider?: 'ollama' | 'openai' | 'anthropic'  // defaults to 'ollama'
  systemPrompt?: string
  tools?: string[]                // tool names from registry
  maxTurns?: number               // max conversation turns before stopping
  temperature?: number
}

// ─── Team ────────────────────────────────────────────────────

interface TeamConfig {
  name: string
  agents: AgentConfig[]
  sharedMemory?: boolean
  maxConcurrency?: number
  schedulingStrategy?: 'round-robin' | 'least-busy' | 'capability-match' | 'dependency-first'
}

// ─── Task ────────────────────────────────────────────────────

interface TaskDefinition {
  title: string
  description: string
  assignee?: string               // agent name
  dependsOn?: string[]            // task titles this depends on
  priority?: number
}

interface TaskResult {
  title: string
  assignee: string
  status: 'completed' | 'failed' | 'skipped'
  output: string
  tokenUsage: TokenUsage
  duration: number
}

// ─── Tools ───────────────────────────────────────────────────

interface ToolDefinition {
  name: string
  description: string
  inputSchema: ZodSchema
  permission: 'read' | 'write' | 'execute' | 'network'
  execute: (input: any, context: ToolContext) => Promise<ToolResult>
}

interface ToolResult {
  data: string
  isError: boolean
}

interface ToolContext {
  cwd: string
  env: Record<string, string>
  agent: string                   // which agent invoked this
  sessionId: string
}

// ─── Session ─────────────────────────────────────────────────

interface SessionState {
  id: string
  messages: Message[]
  tokenCount: number
  maxContextTokens: number
  projectContext: ProjectContext
  createdAt: Date
  lastActivity: Date
}

interface ProjectContext {
  rootDir: string
  language: string                // 'typescript', 'python', 'rust', etc.
  framework?: string              // 'next.js', 'express', 'django', etc.
  packageManager?: string         // 'npm', 'pip', 'cargo', etc.
  gitBranch?: string
  relevantFiles: string[]         // files the agent has read/written
}

// ─── Plugin ──────────────────────────────────────────────────

interface CmdrPlugin {
  name: string
  version: string
  hooks?: {
    beforePrompt?: (params: CompletionParams) => CompletionParams | Promise<CompletionParams>
    afterResponse?: (result: CompletionResult) => CompletionResult | Promise<CompletionResult>
    beforeToolExec?: (tool: string, input: any) => any | Promise<any>
    afterToolExec?: (tool: string, result: ToolResult) => ToolResult | Promise<ToolResult>
    onError?: (error: Error) => void | Promise<void>
    onSessionStart?: (session: SessionState) => void | Promise<void>
    onSessionEnd?: (session: SessionState) => void | Promise<void>
  }
  tools?: ToolDefinition[]         // plugins can register additional tools
  commands?: SlashCommand[]        // plugins can register slash commands
}

// ─── Config ──────────────────────────────────────────────────

interface CmdrConfig {
  ollamaUrl: string               // default: 'http://localhost:11434'
  defaultModel: string            // default: 'qwen2.5-coder:14b'
  defaultProvider: 'ollama' | 'openai' | 'anthropic'
  maxConcurrency: number          // default: 2
  contextBudget: number           // max tokens before compaction triggers
  autoCompact: boolean            // default: true
  permissions: {
    allowBash: boolean            // default: true with confirmation
    allowFileWrite: boolean       // default: true
    allowNetwork: boolean         // default: false
    sandboxDir?: string           // restrict file ops to this directory
  }
  mcp: {
    servers: McpServerConfig[]    // external MCP servers to connect to
  }
  plugins: string[]               // plugin package names or paths
}
```

---

## 4. OLLAMA INTEGRATION (CRITICAL PATH)

### 4.1 OllamaAdapter Implementation

The OllamaAdapter is the most important adapter. It must handle:

1. **Native Ollama API** (`/api/chat`) for models that support tool calling natively
2. **OpenAI-compatible endpoint** (`/v1/chat/completions`) as fallback
3. **Tool-use translation**: Ollama's tool calling format matches OpenAI's, so translate cmdr's internal tool definitions to OpenAI function-calling schema
4. **Streaming**: Use Ollama's streaming response (ndjson lines) for real-time output
5. **Model capability detection**: Query `/api/show` to check if a model supports tools, get context length, etc.
6. **Connection health**: Check Ollama is running on startup, provide helpful error if not

```typescript
// Key implementation details for OllamaAdapter:

class OllamaAdapter implements LLMAdapter {
  private baseUrl: string  // default http://localhost:11434

  async complete(params: CompletionParams): Promise<CompletionResult> {
    // Use /api/chat with:
    // - messages mapped to Ollama format (role, content, tool_calls)
    // - tools mapped to OpenAI function-calling schema
    // - stream: false for non-streaming
    // Handle tool_calls in response, map back to cmdr ContentBlock format
  }

  async *stream(params: CompletionParams): AsyncGenerator<StreamEvent> {
    // Use /api/chat with stream: true
    // Parse ndjson lines as they arrive
    // Yield StreamEvent objects for text deltas, tool calls, etc.
  }

  async listModels(): Promise<string[]> {
    // GET /api/tags
  }

  async modelCapabilities(model: string): Promise<ModelInfo> {
    // POST /api/show with model name
    // Extract: context_length, supports_tools, parameter_size, quantization
  }
}
```

### 4.2 Recommended Default Models (by hardware tier)

```
# Lightweight (8GB VRAM / 16GB RAM)
defaultModel: "qwen2.5-coder:7b"

# Mid-range (12-16GB VRAM / 32GB RAM) -- RECOMMENDED DEFAULT
defaultModel: "qwen2.5-coder:14b"

# Heavy (24GB+ VRAM / 64GB+ RAM)
defaultModel: "qwen2.5-coder:32b"

# Apple Silicon optimized alternatives
defaultModel: "deepseek-coder-v2:16b"  # or codellama:34b
```

### 4.3 Tool Calling with Ollama

Not all Ollama models support native tool calling. The adapter must handle this:

1. **If model supports tools natively** (qwen2.5, llama3.1+, mistral-nemo, etc.): Use Ollama's built-in tool_call response format
2. **If model does NOT support tools**: Fall back to prompt-based tool invocation where tool definitions are injected into the system prompt as XML/JSON schema, and the model's text output is parsed for tool invocations using a regex/structured parser

```typescript
// Fallback tool-calling via prompt injection:
const TOOL_PROMPT_SUFFIX = `
You have access to the following tools. To use a tool, respond with a JSON block:

\`\`\`tool_call
{"name": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

Available tools:
${tools.map(t => `- ${t.name}: ${t.description}\n  Input: ${JSON.stringify(t.inputSchema)}`).join('\n')}

Always use tools when you need to interact with the filesystem or run commands.
After receiving a tool result, continue your analysis.
`
```

---

## 5. AGENT PRESETS FOR CODING

### 5.1 Solo Coder (default, single agent)

Used for simple tasks. This is what runs when the user just types a message.

```typescript
const soloCoder: AgentConfig = {
  name: 'coder',
  systemPrompt: `You are cmdr, an expert coding assistant running in the user's terminal.
You have direct access to their filesystem and can run shell commands.

RULES:
- Read files before editing them. Never guess at file contents.
- Use file_edit for surgical changes, file_write only for new files or full rewrites.
- Run the code after writing it to verify it works.
- If a command fails, analyze the error and fix it. Do not give up.
- Explain what you are doing briefly, then act. Bias toward action over explanation.
- When asked to implement something, write real, production-quality code.
- Use grep/glob to explore unfamiliar codebases before making changes.
- Respect the project's existing patterns, style, and conventions.`,
  tools: ['bash', 'file_read', 'file_write', 'file_edit', 'grep', 'glob',
          'git_diff', 'git_log', 'think', 'ask_user'],
  maxTurns: 30,
}
```

### 5.2 Code Review Team

```typescript
const codeReviewTeam: TeamConfig = {
  name: 'review-team',
  agents: [
    {
      name: 'coder',
      systemPrompt: 'You implement features and fix bugs. Write clean, tested code.',
      tools: ['bash', 'file_read', 'file_write', 'file_edit', 'grep', 'glob'],
      maxTurns: 20,
    },
    {
      name: 'reviewer',
      systemPrompt: `You review code for correctness, security, performance, and style.
Be specific: cite line numbers, suggest concrete fixes. Check for:
- Logic errors and edge cases
- Security vulnerabilities (injection, auth, data exposure)
- Performance issues (N+1 queries, unnecessary allocations)
- Missing error handling
- Test coverage gaps`,
      tools: ['file_read', 'grep', 'glob', 'git_diff'],
      maxTurns: 10,
    },
  ],
  sharedMemory: true,
  schedulingStrategy: 'dependency-first',
}
```

### 5.3 Full Stack Team

```typescript
const fullStackTeam: TeamConfig = {
  name: 'fullstack-team',
  agents: [
    {
      name: 'planner',
      systemPrompt: `You are an architect. Break down the user's request into concrete tasks.
Output a structured task list with dependencies. Assign tasks to: frontend, backend, or reviewer.
Think about: API contracts, data models, component structure, error handling.`,
      tools: ['file_read', 'grep', 'glob', 'think'],
      maxTurns: 5,
    },
    {
      name: 'backend',
      systemPrompt: 'You implement server-side code, APIs, database queries, and business logic.',
      tools: ['bash', 'file_read', 'file_write', 'file_edit', 'grep'],
      maxTurns: 20,
    },
    {
      name: 'frontend',
      systemPrompt: 'You implement UI components, client-side logic, styling, and user interactions.',
      tools: ['bash', 'file_read', 'file_write', 'file_edit', 'grep'],
      maxTurns: 20,
    },
    {
      name: 'reviewer',
      systemPrompt: 'You review all code produced by other agents. Run tests. Report issues.',
      tools: ['bash', 'file_read', 'grep', 'glob', 'git_diff'],
      maxTurns: 10,
    },
  ],
  sharedMemory: true,
  maxConcurrency: 2,
  schedulingStrategy: 'dependency-first',
}
```

---

## 6. IMPLEMENTATION PLAN (PHASED)

### Phase 1: Foundation (MVP, ship this first)

Build the minimum viable single-agent coding tool:

1. **bin/cmdr.ts**: CLI entry point with arg parsing
2. **OllamaAdapter**: /api/chat integration with streaming + tool calling
3. **ToolRegistry + ToolExecutor**: with 5 core tools (bash, file_read, file_write, file_edit, grep)
4. **AgentRunner**: The conversation loop (model -> tool_use -> tool_result -> model)
5. **Agent**: Single agent with run() and stream()
6. **REPL**: Interactive readline loop with markdown rendering
7. **SessionManager**: Basic conversation history with token counting
8. **ProjectContext**: Auto-discover project type on startup
9. **Slash commands**: /help, /clear, /model, /quit

**Exit criteria**: User can `npx cmdr` in a project, ask it to make changes, and it reads files, writes code, runs commands, and iterates.

### Phase 2: Multi-Agent

Add the orchestration layer:

1. **Team, MessageBus, SharedMemory, TaskQueue**
2. **Orchestrator**: runTeam(), runTasks() with goal decomposition
3. **AgentPool**: Parallel execution with semaphore
4. **Scheduling strategies**: capability-match as default
5. **Agent presets**: solo-coder, code-review-team, full-stack-team
6. **Slash commands**: /team, /agents, /status, /tasks

**Exit criteria**: User can `cmdr --team review` and get a coder + reviewer working together.

### Phase 3: Extensibility

Add the plugin and MCP layer:

1. **PluginManager**: Load plugins from npm packages or local paths
2. **Hook pipeline**: All lifecycle hooks working
3. **MCP client**: Connect to external MCP servers
4. **Config system**: ~/.cmdr/config.toml, .cmdr.toml, env vars
5. **Additional tools**: glob, git_diff, git_log, web_fetch, think, ask_user
6. **Prompt compaction**: Intelligent history summarization

**Exit criteria**: Users can write plugins, connect MCP servers, and customize behavior.

### Phase 4: Polish

1. **Token cost tracking**: /cost command showing usage stats
2. **Session persistence**: Save/resume conversations
3. **Undo**: Revert file changes made by the agent
4. **Git integration**: Auto-commit agent changes, branch management
5. **Multi-model teams**: Different Ollama models for different agents
6. **Telemetry**: Optional anonymous usage stats

---

## 7. KEY IMPLEMENTATION DETAILS

### 7.1 The Conversation Loop (AgentRunner)

This is the most critical piece. Port directly from open-multi-agent's pattern:

```typescript
class AgentRunner {
  async run(agent: Agent, task: string): Promise<AgentResult> {
    const messages: Message[] = [{ role: 'user', content: task }]
    let turns = 0

    while (turns < agent.config.maxTurns) {
      // 1. Build completion params
      const params = this.promptBuilder.build({
        systemPrompt: agent.config.systemPrompt,
        messages,
        tools: this.registry.getToolDefs(agent.config.tools),
        projectContext: this.session.projectContext,
      })

      // 2. Call LLM
      const result = await this.adapter.complete(params)

      // 3. Process response
      const textBlocks = result.content.filter(b => b.type === 'text')
      const toolUseBlocks = result.content.filter(b => b.type === 'tool_use')

      // 4. Add assistant message to history
      messages.push({ role: 'assistant', content: result.content })

      // 5. If no tool calls, we are done
      if (result.stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
        return { output: textBlocks.map(b => b.text).join(''), messages, turns }
      }

      // 6. Execute tools and add results
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const toolResult = await this.executor.execute(block.name, block.input, {
            cwd: this.session.projectContext.rootDir,
            agent: agent.config.name,
            sessionId: this.session.id,
          })
          return { type: 'tool_result', tool_use_id: block.id, content: toolResult.data }
        })
      )

      messages.push({ role: 'user', content: toolResults })
      turns++
    }

    return { output: 'Max turns reached.', messages, turns }
  }
}
```

### 7.2 Prompt Compaction

When conversation history approaches the model's context limit:

```typescript
class CompactionEngine {
  async compact(messages: Message[], budget: number): Promise<Message[]> {
    // Strategy:
    // 1. Keep the system prompt (never compact)
    // 2. Keep the last N user/assistant exchanges intact (recent context)
    // 3. Summarize older exchanges into a single "conversation summary" message
    // 4. For tool results: keep only the last line or first 200 chars, remove full output
    // 5. Use the same LLM to generate the summary if possible, else use a heuristic
    //
    // The summary message is injected as: { role: 'user', content: '[Previous context summary]: ...' }
  }
}
```

### 7.3 Project Context Discovery

```typescript
class ProjectContextDiscovery {
  async discover(rootDir: string): Promise<ProjectContext> {
    // Check for:
    // - package.json -> Node.js/TypeScript (check for tsconfig.json)
    // - Cargo.toml -> Rust
    // - pyproject.toml / requirements.txt / setup.py -> Python
    // - go.mod -> Go
    // - pom.xml / build.gradle -> Java
    // - .git -> extract branch, recent commits
    // - README.md -> extract project description
    // - Dockerfile / docker-compose.yml -> containerized
    //
    // Return structured ProjectContext
  }
}
```

---

## 8. SLASH COMMANDS

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/compact` | Manually trigger history compaction |
| `/model [name]` | Switch active model (e.g., `/model qwen2.5-coder:32b`) |
| `/models` | List available Ollama models |
| `/team [preset]` | Switch to a team preset (e.g., `/team review`) |
| `/agents` | Show active agents and their status |
| `/tasks` | Show task queue and status |
| `/status` | Show session info: tokens used, turns, model, etc. |
| `/cost` | Show token usage breakdown |
| `/undo` | Revert the last file change made by the agent |
| `/diff` | Show git diff of changes made this session |
| `/config [key] [value]` | View or set configuration |
| `/plugin [add\|remove\|list]` | Manage plugins |
| `/mcp [connect\|disconnect\|list]` | Manage MCP server connections |
| `/quit` or `/exit` | Exit cmdr |

---

## 9. BUILD AND PUBLISH

```json
// package.json
{
  "name": "cmdr-agent",
  "version": "0.1.0",
  "description": "Open-source multi-agent coding tool for your terminal. Powered by Ollama.",
  "type": "module",
  "bin": { "cmdr": "./dist/bin/cmdr.js" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "start": "node dist/bin/cmdr.js",
    "prepublishOnly": "npm run build"
  },
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "zod": "^3.23.0",
    "chalk": "^5.3.0",
    "marked": "^14.0.0",
    "marked-terminal": "^7.0.0",
    "ora": "^8.0.0",
    "toml": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  },
  "keywords": ["ai", "agent", "coding", "ollama", "multi-agent", "terminal", "cli", "local-llm"]
}
```

---

## 10. INSTRUCTIONS FOR OPUS

You are building cmdr from scratch. Here is your execution order:

1. **Start with Phase 1 only.** Do not build multi-agent features until Phase 1 is complete and tested.

2. **The OllamaAdapter is the critical path.** Get it working first with streaming, then add tool calling. Test with `ollama run qwen2.5-coder:14b` as your reference model.

3. **The AgentRunner conversation loop is the second critical path.** This is the model -> tool_use -> tool_result -> model loop that makes everything work. Port the pattern from open-multi-agent's architecture.

4. **Built-in tools must be robust.** The bash tool needs timeout handling, stderr capture, and streaming output. file_edit must handle exact string matching carefully. grep should try ripgrep first, then fall back to Node.js.

5. **The REPL must feel good.** Streaming output is essential. Show the model's text as it arrives. Show tool executions with a spinner. Render markdown with syntax highlighting.

6. **Test everything.** Write unit tests for the tool registry, agent runner, session manager, and Ollama adapter. Use vitest.

7. **No external LLM dependencies in the core path.** The Anthropic and OpenAI adapters are optional. cmdr must work with zero API keys if Ollama is running.

8. **Use only the project structure and types defined in this document.** Do not invent new abstractions unless they are clearly necessary.

9. **Every file should be < 300 lines.** If it is longer, split it.

10. **Ship incrementally.** Phase 1 is the MVP. Get it working, then iterate.

---

## 11. WHAT NOT TO DO

- Do NOT copy any proprietary code from any source. All code must be original.
- Do NOT require API keys for the default experience. Ollama is the default.
- Do NOT build a web UI. cmdr is terminal-native.
- Do NOT use LangChain, LlamaIndex, or any heavy framework. Keep dependencies minimal.
- Do NOT over-engineer the plugin system in Phase 1. Ship it in Phase 3.
- Do NOT support Python or Rust runtimes. cmdr is TypeScript/Node.js only.
- Do NOT add telemetry without explicit opt-in.

---

## 12. SUCCESS CRITERIA

cmdr v0.1.0 is successful when a developer can:

```bash
# Install
npm install -g cmdr-agent

# Run in any project directory
cd my-project
cmdr

# And have a conversation like:
> Add input validation to the POST /users endpoint with proper error messages

# And cmdr will:
# 1. Read the existing route file
# 2. Understand the project structure
# 3. Write validation code
# 4. Run the tests
# 5. Fix any failures
# 6. Show the diff
```

All powered by a local Ollama model with zero cloud dependencies.

---

*This document is the single source of truth for the cmdr project. Build exactly this.*