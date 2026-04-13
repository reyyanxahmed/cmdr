import { afterEach, describe, expect, it } from 'vitest'

import { createAdapter, detectProviderFromModel } from '../../src/llm/provider-factory.js'

const ENV_KEYS = [
  'CMDR_QWEN_API_KEY',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  'QWEN_BASE_URL',
  'DASHSCOPE_BASE_URL',
] as const

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
})

describe('provider-factory qwen support', () => {
  it('detects cloud qwen model names as qwen provider', () => {
    expect(detectProviderFromModel('qwen-max')).toBe('qwen')
    expect(detectProviderFromModel('qwen3-coder-plus')).toBe('qwen')
  })

  it('keeps tagged qwen ollama models as ollama provider', () => {
    expect(detectProviderFromModel('qwen2.5-coder:14b')).toBe('ollama')
  })

  it('creates qwen adapter from QWEN_API_KEY', () => {
    process.env.QWEN_API_KEY = 'qwen-test-key'

    const adapter = createAdapter({ provider: 'qwen' })

    expect(adapter.name).toBe('qwen')
  })

  it('creates qwen adapter from DASHSCOPE_API_KEY', () => {
    process.env.DASHSCOPE_API_KEY = 'dashscope-test-key'

    const adapter = createAdapter({ provider: 'qwen' })

    expect(adapter.name).toBe('qwen')
  })

  it('throws a helpful error when no qwen key is configured', () => {
    expect(() => createAdapter({ provider: 'qwen' })).toThrowError(
      /Qwen API key required/,
    )
  })
})
