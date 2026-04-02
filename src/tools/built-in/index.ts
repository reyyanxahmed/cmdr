/**
 * Built-in tool collection — register all tools at once.
 */

import type { ToolDefinition } from '../../core/types.js'
import { ToolRegistry } from '../registry.js'
import { bashTool } from './bash.js'
import { fileReadTool } from './file-read.js'
import { fileWriteTool } from './file-write.js'
import { fileEditTool } from './file-edit.js'
import { grepTool } from './grep.js'
import { globTool } from './glob.js'
import { gitDiffTool } from './git-diff.js'
import { gitLogTool } from './git-log.js'
import { gitCommitTool, gitBranchTool } from './git-commit.js'
import { thinkTool } from './think.js'
import { webFetchTool } from './web-fetch.js'
import { askUserTool } from './ask-user.js'

export {
  bashTool, fileReadTool, fileWriteTool, fileEditTool,
  grepTool, globTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool,
  thinkTool, webFetchTool, askUserTool,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BUILT_IN_TOOLS: ToolDefinition<any>[] = [
  bashTool, fileReadTool, fileWriteTool, fileEditTool,
  grepTool, globTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool,
  thinkTool, webFetchTool, askUserTool,
]

export function registerBuiltInTools(registry: ToolRegistry): void {
  for (const tool of BUILT_IN_TOOLS) {
    if (!registry.has(tool.name)) {
      registry.register(tool)
    }
  }
}
