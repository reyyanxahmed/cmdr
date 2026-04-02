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
  { name: 'qwen2.5:7b', contextLength: 32768, supportsTools: true, parameterSize: '7B', recommended: 'lightweight' },
  { name: 'qwen2.5:14b', contextLength: 32768, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'qwen2.5:32b', contextLength: 32768, supportsTools: true, parameterSize: '32B', recommended: 'heavy' },
  { name: 'llama3.1:8b', contextLength: 131072, supportsTools: true, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'llama3.1:70b', contextLength: 131072, supportsTools: true, parameterSize: '70B', recommended: 'heavy' },
  { name: 'llama3.2:3b', contextLength: 131072, supportsTools: true, parameterSize: '3B', recommended: 'lightweight' },
  { name: 'mistral-nemo:12b', contextLength: 128000, supportsTools: true, parameterSize: '12B', recommended: 'midrange' },
  { name: 'deepseek-coder-v2:16b', contextLength: 65536, supportsTools: false, parameterSize: '16B', recommended: 'midrange' },
  { name: 'codellama:34b', contextLength: 16384, supportsTools: false, parameterSize: '34B', recommended: 'heavy' },
]

export function getModelInfo(name: string): ModelInfo | undefined {
  return KNOWN_MODELS.find(m => m.name === name || name.startsWith(m.name.split(':')[0]))
}

export function getDefaultContextLength(model: string): number {
  const info = getModelInfo(model)
  return info?.contextLength ?? 8192
}

export function getRecommendedModel(tier: 'lightweight' | 'midrange' | 'heavy'): string {
  const model = KNOWN_MODELS.find(m => m.recommended === tier && m.name.includes('coder'))
  return model?.name ?? 'qwen2.5-coder:14b'
}
