/**
 * Eval runner — executes eval tasks and records results.
 *
 * Each task is a directory in evals/tasks/ containing:
 *   task.json   — { prompt, tier, description }
 *   verify.sh   — exits 0 if the task passed
 *   workspace/  — scratch directory copied fresh for each run
 *
 * Usage: npx tsx evals/run-evals.ts [--model <model>] [--filter <pattern>]
 */

import { execSync, execFileSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'fs'
import { join, resolve, basename } from 'path'

interface TaskDef {
  prompt: string
  tier: 'trivial' | 'easy' | 'medium' | 'hard'
  description: string
  timeout?: number
}

interface TaskResult {
  name: string
  tier: string
  passed: boolean
  durationMs: number
  error?: string
}

interface EvalReport {
  model: string
  timestamp: string
  results: TaskResult[]
  summary: {
    total: number
    passed: number
    failed: number
    byTier: Record<string, { total: number; passed: number }>
  }
}

// --- Parse CLI args ---
const args = process.argv.slice(2)
let model = 'qwen2.5-coder:14b'
let filter = ''
let ollamaUrl = 'http://localhost:11434'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' || args[i] === '-m') model = args[++i]
  if (args[i] === '--filter' || args[i] === '-f') filter = args[++i]
  if (args[i] === '--ollama-url' || args[i] === '-u') ollamaUrl = args[++i]
}

// --- Discover tasks ---
const EVALS_DIR = resolve(import.meta.dirname ?? '.', 'tasks')
const RESULTS_DIR = resolve(import.meta.dirname ?? '.', 'results')

function discoverTasks(): string[] {
  const dirs = readdirSync(EVALS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()

  if (filter) {
    const re = new RegExp(filter, 'i')
    return dirs.filter(d => re.test(d))
  }
  return dirs
}

// --- Run a single task ---
async function runTask(taskDir: string): Promise<TaskResult> {
  const name = basename(taskDir)
  const taskJsonPath = join(taskDir, 'task.json')
  const verifyPath = join(taskDir, 'verify.sh')

  if (!existsSync(taskJsonPath)) {
    return { name, tier: 'unknown', passed: false, durationMs: 0, error: 'Missing task.json' }
  }

  const task: TaskDef = JSON.parse(readFileSync(taskJsonPath, 'utf-8'))
  const timeoutMs = task.timeout ?? 60_000

  // Create a temp workspace
  const tmpDir = join(RESULTS_DIR, '.workspaces', name)
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })

  // Copy workspace/ contents if they exist
  const srcWorkspace = join(taskDir, 'workspace')
  if (existsSync(srcWorkspace)) {
    cpSync(srcWorkspace, tmpDir, { recursive: true })
  }

  const start = Date.now()
  let passed = false
  let error: string | undefined

  try {
    // Run cmdr with the task prompt in the temp workspace
    const cmdrBin = resolve(import.meta.dirname ?? '.', '..', 'dist', 'bin', 'cmdr.js')
    execFileSync('node', [cmdrBin, '--cwd', tmpDir, '-m', model, '-u', ollamaUrl, '-p', task.prompt], {
      timeout: timeoutMs,
      stdio: 'pipe',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    })

    // Run verify.sh
    if (existsSync(verifyPath)) {
      execFileSync('bash', [verifyPath], {
        cwd: tmpDir,
        timeout: 10_000,
        stdio: 'pipe',
      })
      passed = true
    } else {
      error = 'Missing verify.sh'
    }
  } catch (err: any) {
    error = err.message?.slice(0, 500) ?? String(err)
  }

  const durationMs = Date.now() - start

  // Clean up workspace
  try {
    rmSync(tmpDir, { recursive: true })
  } catch {
    // best effort
  }

  return { name, tier: task.tier, passed, durationMs, error }
}

// --- Main ---
async function main(): Promise<void> {
  console.log(`\n  cmdr eval runner`)
  console.log(`  Model: ${model}`)
  console.log(`  Ollama: ${ollamaUrl}\n`)

  mkdirSync(RESULTS_DIR, { recursive: true })
  mkdirSync(join(RESULTS_DIR, '.workspaces'), { recursive: true })

  const taskNames = discoverTasks()
  if (taskNames.length === 0) {
    console.log('  No tasks found.')
    return
  }

  console.log(`  Found ${taskNames.length} tasks\n`)

  const results: TaskResult[] = []

  for (const name of taskNames) {
    const taskDir = join(EVALS_DIR, name)
    process.stdout.write(`  ${name} ... `)

    const result = await runTask(taskDir)
    results.push(result)

    const status = result.passed ? '✓ PASS' : '✗ FAIL'
    const time = `(${(result.durationMs / 1000).toFixed(1)}s)`
    console.log(`${status} ${time}${result.error ? ` — ${result.error.slice(0, 80)}` : ''}`)
  }

  // Build summary
  const byTier: Record<string, { total: number; passed: number }> = {}
  for (const r of results) {
    if (!byTier[r.tier]) byTier[r.tier] = { total: 0, passed: 0 }
    byTier[r.tier].total++
    if (r.passed) byTier[r.tier].passed++
  }

  const report: EvalReport = {
    model,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      byTier,
    },
  }

  // Save report
  const reportFile = join(RESULTS_DIR, `eval-${model.replace(/[:/]/g, '-')}-${Date.now()}.json`)
  writeFileSync(reportFile, JSON.stringify(report, null, 2))

  console.log(`\n  ── Results ──`)
  console.log(`  Total:  ${report.summary.total}`)
  console.log(`  Passed: ${report.summary.passed}`)
  console.log(`  Failed: ${report.summary.failed}`)
  for (const [tier, stats] of Object.entries(byTier)) {
    console.log(`    ${tier}: ${stats.passed}/${stats.total}`)
  }
  console.log(`\n  Report: ${reportFile}\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
