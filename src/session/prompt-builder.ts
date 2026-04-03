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

  // Inject CMDR.md workspace instructions
  if (ctx.cmdrInstructions) {
    parts.push(`\n\n<project_instructions>\nThe user has provided the following instructions for this project. Follow them unless they conflict with safety:\n\n${ctx.cmdrInstructions}\n</project_instructions>`)
  }

  // Inject active skills
  if (ctx.activeSkills && ctx.activeSkills.length > 0) {
    for (const skill of ctx.activeSkills) {
      const scriptNote = skill.scripts.length > 0
        ? `\n\nHelper scripts available at:\n${skill.scripts.map(s => `  - ${s}`).join('\n')}`
        : ''
      parts.push(`\n\n<skill name="${skill.name}">\n${skill.instructions}${scriptNote}\n</skill>`)
    }
  }

  return parts.join('')
}
