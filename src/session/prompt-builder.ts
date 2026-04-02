/**
 * PromptBuilder — composable prompt construction pipeline.
 */

import type { ProjectContext } from '../core/types.js'

export interface PromptBuildOptions {
  basePrompt: string
  projectContext: ProjectContext
  model: string
}

export function buildSystemPrompt(options: PromptBuildOptions): string {
  const parts: string[] = [options.basePrompt]

  // Inject project context
  const ctx = options.projectContext
  const contextParts: string[] = []

  if (ctx.language !== 'unknown') {
    contextParts.push(`Language: ${ctx.language}`)
  }
  if (ctx.framework) {
    contextParts.push(`Framework: ${ctx.framework}`)
  }
  if (ctx.packageManager) {
    contextParts.push(`Package manager: ${ctx.packageManager}`)
  }
  if (ctx.gitBranch) {
    contextParts.push(`Git branch: ${ctx.gitBranch}`)
  }

  if (contextParts.length > 0) {
    parts.push(`\n\nProject context:\n${contextParts.join('\n')}\nRoot: ${ctx.rootDir}`)
  }

  return parts.join('')
}
