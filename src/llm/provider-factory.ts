/**
 * Provider factory — creates the appropriate LLM adapter based on configuration.
 *
 * Supports:
 *   - ollama: Local inference via Ollama (default)
 *   - openai: OpenAI API (also works with Groq, Together, OpenRouter)
 *   - anthropic: Anthropic Claude API
 *   - qwen: Qwen API (OpenAI-compatible)
 *
 * API keys are read from environment variables:
 *   - OPENAI_API_KEY (or CMDR_OPENAI_API_KEY)
 *   - ANTHROPIC_API_KEY (or CMDR_ANTHROPIC_API_KEY)
 *   - QWEN_API_KEY / DASHSCOPE_API_KEY (or CMDR_QWEN_API_KEY)
 *
 * Custom base URLs:
 *   - OPENAI_BASE_URL (e.g. https://openrouter.ai/api/v1)
 *   - ANTHROPIC_BASE_URL
 *   - QWEN_BASE_URL / DASHSCOPE_BASE_URL
 */

import type { LLMAdapter } from '../core/types.js'
import { OllamaAdapter } from './ollama.js'
import { OpenAIAdapter } from './openai.js'
import { AnthropicAdapter } from './anthropic.js'

export type ProviderName = 'ollama' | 'openai' | 'anthropic' | 'qwen'

export interface ProviderOptions {
  provider: ProviderName
  ollamaUrl?: string
  apiKey?: string
  baseUrl?: string
}

/**
 * Create an LLM adapter for the given provider.
 * Throws if required configuration (e.g. API key) is missing.
 */
export function createAdapter(options: ProviderOptions): LLMAdapter {
  switch (options.provider) {
    case 'ollama':
      return new OllamaAdapter(options.ollamaUrl ?? 'http://localhost:11434')

    case 'openai': {
      const apiKey = options.apiKey
        ?? process.env.CMDR_OPENAI_API_KEY
        ?? process.env.OPENAI_API_KEY
      if (!apiKey) {
        throw new Error(
          'OpenAI API key required. Set OPENAI_API_KEY or CMDR_OPENAI_API_KEY environment variable.',
        )
      }
      return new OpenAIAdapter({
        apiKey,
        baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL,
        name: 'openai',
      })
    }

    case 'anthropic': {
      const apiKey = options.apiKey
        ?? process.env.CMDR_ANTHROPIC_API_KEY
        ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        throw new Error(
          'Anthropic API key required. Set ANTHROPIC_API_KEY or CMDR_ANTHROPIC_API_KEY environment variable.',
        )
      }
      return new AnthropicAdapter({
        apiKey,
        baseUrl: options.baseUrl ?? process.env.ANTHROPIC_BASE_URL,
      })
    }

    case 'qwen': {
      const apiKey = options.apiKey
        ?? process.env.CMDR_QWEN_API_KEY
        ?? process.env.QWEN_API_KEY
        ?? process.env.DASHSCOPE_API_KEY
      if (!apiKey) {
        throw new Error(
          'Qwen API key required. Set QWEN_API_KEY, DASHSCOPE_API_KEY, or CMDR_QWEN_API_KEY environment variable.',
        )
      }
      return new OpenAIAdapter({
        apiKey,
        baseUrl:
          options.baseUrl
          ?? process.env.QWEN_BASE_URL
          ?? process.env.DASHSCOPE_BASE_URL
          ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        name: 'qwen',
      })
    }

    default:
      throw new Error(`Unknown provider: ${options.provider}`)
  }
}

/**
 * Detect provider from model name pattern.
 * Returns undefined if can't determine — falls back to config default.
 */
export function detectProviderFromModel(model: string): ProviderName | undefined {
  // Claude models → Anthropic
  if (/^claude-/i.test(model)) return 'anthropic'
  // GPT/o1/o3 models → OpenAI
  if (/^(gpt-|o1|o3|chatgpt)/i.test(model)) return 'openai'
  // Cloud Qwen models (qwen-max, qwen-plus, qwen3-*) → Qwen API
  if (/^qwen/i.test(model) && !model.includes(':')) return 'qwen'
  // Models with colons are typically Ollama tags (e.g. qwen2.5-coder:14b)
  if (model.includes(':')) return 'ollama'

  return undefined
}
