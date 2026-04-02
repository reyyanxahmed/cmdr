/**
 * Eval report viewer — reads JSON reports and prints a summary table.
 *
 * Usage: npx tsx evals/report.ts [report-file.json]
 *        npx tsx evals/report.ts --latest
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const RESULTS_DIR = resolve(import.meta.dirname ?? '.', 'results')

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

function findLatestReport(): string | null {
  if (!existsSync(RESULTS_DIR)) return null
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('eval-') && f.endsWith('.json'))
    .sort()
  return files.length > 0 ? join(RESULTS_DIR, files[files.length - 1]) : null
}

function loadReport(path: string): EvalReport {
  return JSON.parse(readFileSync(path, 'utf-8')) as EvalReport
}

function printReport(report: EvalReport): void {
  console.log(`\n  cmdr eval report`)
  console.log(`  Model:     ${report.model}`)
  console.log(`  Timestamp: ${report.timestamp}\n`)

  // Table header
  const nameWidth = Math.max(30, ...report.results.map(r => r.name.length + 2))
  console.log(`  ${'Task'.padEnd(nameWidth)} ${'Tier'.padEnd(8)} ${'Status'.padEnd(8)} ${'Time'.padEnd(8)} Error`)
  console.log(`  ${'─'.repeat(nameWidth)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(40)}`)

  for (const r of report.results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL'
    const time = `${(r.durationMs / 1000).toFixed(1)}s`
    const errorStr = r.error ? r.error.slice(0, 60) : ''
    console.log(`  ${r.name.padEnd(nameWidth)} ${r.tier.padEnd(8)} ${status.padEnd(8)} ${time.padEnd(8)} ${errorStr}`)
  }

  console.log(`\n  ── Summary ──`)
  console.log(`  Total:  ${report.summary.total}`)
  console.log(`  Passed: ${report.summary.passed} (${Math.round(report.summary.passed / report.summary.total * 100)}%)`)
  console.log(`  Failed: ${report.summary.failed}`)

  for (const [tier, stats] of Object.entries(report.summary.byTier)) {
    const pct = Math.round(stats.passed / stats.total * 100)
    console.log(`    ${tier}: ${stats.passed}/${stats.total} (${pct}%)`)
  }
  console.log('')
}

// --- Main ---
const arg = process.argv[2]
let reportPath: string | null = null

if (arg && arg !== '--latest') {
  reportPath = resolve(arg)
} else {
  reportPath = findLatestReport()
}

if (!reportPath || !existsSync(reportPath)) {
  console.log('  No eval reports found. Run: npm run eval')
  process.exit(0)
}

printReport(loadReport(reportPath))
