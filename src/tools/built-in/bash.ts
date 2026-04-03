/**
 * Built-in bash tool — execute shell commands.
 */

import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'
import { sanitizeBashCommand } from './bash-security.js'

const DEFAULT_TIMEOUT_MS = 30_000

export const bashTool = defineTool({
  name: 'bash',
  description:
    'Execute a bash command and return stdout/stderr. ' +
    'Use for file operations, running scripts, installing packages, etc. ' +
    'The command runs in a non-interactive shell (bash -c).',

  inputSchema: z.object({
    command: z.string().describe('The bash command to execute.'),
    timeout: z.number().optional().describe(`Timeout in ms. Defaults to ${DEFAULT_TIMEOUT_MS}.`),
    cwd: z.string().optional().describe('Working directory for the command.'),
  }),

  execute: async (input, context) => {
    // Security check
    const check = sanitizeBashCommand(input.command)
    if (!check.safe) {
      return { data: `Command blocked: ${check.reason}`, isError: true }
    }

    const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT_MS
    const cwd = input.cwd ?? context.cwd ?? process.cwd()

    const { stdout, stderr, exitCode } = await runCommand(check.sanitized, cwd, timeoutMs, context.abortSignal)

    const parts: string[] = []
    if (stdout) parts.push(stdout)
    if (stderr) parts.push(`[stderr]\n${stderr}`)
    if (exitCode !== 0) parts.push(`[exit code: ${exitCode}]`)

    return {
      data: parts.join('\n') || '(no output)',
      isError: exitCode !== 0,
    }
  },
})

interface RunResult { stdout: string; stderr: string; exitCode: number }

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const child = spawn('bash', ['-c', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ stdout: '', stderr: err.message, exitCode: 1 })
    })
  })
}
