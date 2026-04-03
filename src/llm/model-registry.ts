/**
 * Model registry — known models and their capabilities.
 */

export interface ModelInfo {
  name: string
  contextLength: number
  supportsTools: boolean
  parameterSize: string
  recommended: 'lightweight' | 'midrange' | 'heavy'
}

const KNOWN_MODELS: ModelInfo[] = [
  { name: 'qwen2.5-coder:7b', contextLength: 32768, supportsTools: true, parameterSize: '7B', recommended: 'lightweight' },
  { name: 'qwen2.5-coder:14b', contextLength: 32768, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'qwen2.5-coder:32b', contextLength: 32768, supportsTools: true, parameterSize: '32B', recommended: 'heavy' },
  { name: 'qwen3-coder:latest', contextLength: 65536, supportsTools: true, parameterSize: '30.5B', recommended: 'heavy' },
  { name: 'qwen2.5:7b', contextLength: 32768, supportsTools: true, parameterSize: '7B', recommended: 'lightweight' },
  { name: 'qwen2.5:14b', contextLength: 32768, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'qwen2.5:32b', contextLength: 32768, supportsTools: true, parameterSize: '32B', recommended: 'heavy' },
  { name: 'llama3.1:8b', contextLength: 131072, supportsTools: true, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'llama3.1:70b', contextLength: 131072, supportsTools: true, parameterSize: '70B', recommended: 'heavy' },
  { name: 'llama3.2:3b', contextLength: 131072, supportsTools: true, parameterSize: '3B', recommended: 'lightweight' },
  { name: 'mistral-nemo:12b', contextLength: 128000, supportsTools: true, parameterSize: '12B', recommended: 'midrange' },
  { name: 'gemma4:26b', contextLength: 262144, supportsTools: false, parameterSize: '25.8B', recommended: 'heavy' },
  { name: 'gemma4:e4b', contextLength: 131072, supportsTools: false, parameterSize: '4B', recommended: 'lightweight' },
  { name: 'gemma4:e2b', contextLength: 131072, supportsTools: false, parameterSize: '2B', recommended: 'lightweight' },
  { name: 'deepseek-coder-v2:16b', contextLength: 131072, supportsTools: true, parameterSize: '16B', recommended: 'midrange' },
  { name: 'deepseek-coder:6.7b', contextLength: 16384, supportsTools: true, parameterSize: '6.7B', recommended: 'lightweight' },
  { name: 'codellama:34b', contextLength: 16384, supportsTools: false, parameterSize: '34B', recommended: 'heavy' },
  { name: 'dolphin3:latest', contextLength: 131072, supportsTools: false, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'phi-3:latest', contextLength: 131072, supportsTools: true, parameterSize: '3.8B', recommended: 'lightweight' },
  { name: 'phi-4:latest', contextLength: 16384, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'command-r:latest', contextLength: 131072, supportsTools: true, parameterSize: '35B', recommended: 'heavy' },
  { name: 'minimax-m2.5:cloud', contextLength: 1048576, supportsTools: true, parameterSize: 'cloud', recommended: 'heavy' },
]

export function getModelInfo(name: string): ModelInfo | undefined {
  return KNOWN_MODELS.find(m => m.name === name || name.startsWith(m.name.split(':')[0]))
}

export function getDefaultContextLength(model: string): number {
  const info = getModelInfo(model)
  return info?.contextLength ?? 8192
}

/**
 * Query Ollama /api/show for the actual context length of a model.
 * Falls back to getDefaultContextLength if the query fails.
 */
export async function resolveContextLength(
  model: string,
  ollamaUrl = 'http://localhost:11434',
): Promise<number> {
  // If we know the model, trust our registry
  const info = getModelInfo(model)
  if (info) return info.contextLength

  // Query Ollama for unknown models
  try {
    const res = await fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    })
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>
      // Ollama returns model_info with context length keys like
      // "<arch>.context_length" or "context_length"
      const modelInfo = data.model_info as Record<string, unknown> | undefined
      if (modelInfo) {
        for (const [key, value] of Object.entries(modelInfo)) {
          if (key.endsWith('context_length') && typeof value === 'number') {
            return value
          }
        }
      }
      // Also check parameters string for num_ctx
      const params = data.parameters as string | undefined
      if (params) {
        const match = params.match(/num_ctx\s+(\d+)/)
        if (match) return parseInt(match[1], 10)
      }
    }
  } catch {
    // Network error — fall through
  }

  return 8192
}

export function getRecommendedModel(tier: 'lightweight' | 'midrange' | 'heavy'): string {
  const model = KNOWN_MODELS.find(m => m.recommended === tier && m.name.includes('coder'))
  return model?.name ?? 'qwen2.5-coder:14b'
}
