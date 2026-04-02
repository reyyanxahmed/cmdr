/**
 * cmdr — public API exports.
 *
 * Import from 'cmdr-agent' for programmatic usage.
 */

// Core
export { Agent } from './core/agent.js'
export { AgentRunner } from './core/agent-runner.js'
export { SOLO_CODER, getPreset } from './core/presets.js'
export type {
  AgentConfig, AgentState, AgentRunResult,
  LLMAdapter, LLMMessage, LLMResponse, LLMChatOptions,
  StreamEvent, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock,
  TokenUsage, ToolCallRecord,
  ToolDefinition, ToolResult, ToolUseContext,
  SessionState, ProjectContext,
  CmdrPlugin, SlashCommand,
  CmdrConfig,
} from './core/types.js'

// Tools
export { defineTool, ToolRegistry, zodToJsonSchema } from './tools/registry.js'
export { ToolExecutor } from './tools/executor.js'
export { registerBuiltInTools, BUILT_IN_TOOLS } from './tools/built-in/index.js'

// LLM
export { OllamaAdapter } from './llm/ollama.js'
export { getModelInfo, getDefaultContextLength, getRecommendedModel } from './llm/model-registry.js'
export { countTokens, countMessageTokens } from './llm/token-counter.js'

// Session
export { SessionManager } from './session/session-manager.js'
export { discoverProject } from './session/project-context.js'
export { buildSystemPrompt } from './session/prompt-builder.js'
export { compactHistory, shouldCompact, DEFAULT_COMPACTION_CONFIG } from './session/compaction.js'
export type { CompactionConfig } from './session/compaction.js'
export { saveSession, loadSession, listSessions, findRecentSession, DebouncedSaver } from './session/session-persistence.js'
export type { SavedSession } from './session/session-persistence.js'

// CLI
export { startRepl } from './cli/repl.js'
