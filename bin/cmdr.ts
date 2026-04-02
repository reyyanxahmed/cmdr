#!/usr/bin/env node

/**
 * cmdr — CLI entry point.
 *
 * Open-source multi-agent coding tool for your terminal.
 * Powered by local LLMs via Ollama.
 */

import { parseArgs, printHelp } from '../src/cli/args.js'
import { startRepl } from '../src/cli/repl.js'
import { GREEN, PURPLE, DIM, renderError } from '../src/cli/theme.js'
import { OllamaAdapter } from '../src/llm/ollama.js'

const VERSION = '1.0.1'

/** Pick the best model from available Ollama models. Prefer "coder" variants, then larger sizes. */
function pickBestModel(models: string[]): string {
  const scored = models.map((name) => {
    let score = 0
    const lower = name.toLowerCase()
    if (lower.includes('coder')) score += 100
    // Prefer larger parameter sizes
    const sizeMatch = lower.match(/(\d+)[bB]/)
    if (sizeMatch) score += parseInt(sizeMatch[1], 10)
    return { name, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].name
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.version) {
    console.log(`${PURPLE.bold('cmdr')} ${GREEN(`v${VERSION}`)}`)
    process.exit(0)
  }

  const ollamaUrl = args.ollamaUrl ?? process.env.CMDR_OLLAMA_URL ?? 'http://localhost:11434'

  // Auto-detect model if not specified
  let model = args.model ?? process.env.CMDR_MODEL
  if (!model) {
    try {
      const adapter = new OllamaAdapter(ollamaUrl)
      const models = await adapter.listModels()
      if (models.length === 0) {
        console.error(renderError(
          'No models found in Ollama.\n' +
          '  Pull a model first: ollama pull qwen2.5-coder:14b',
        ))
        process.exit(1)
      }
      model = pickBestModel(models)
      console.log(`  ${DIM('Auto-detected model:')} ${GREEN(model)}`)
    } catch {
      console.error(renderError(
        `Cannot connect to Ollama at ${ollamaUrl}\n` +
        '  Make sure Ollama is running: ollama serve',
      ))
      process.exit(1)
    }
  }

  // Override working directory if --cwd is specified
  if (args.cwd) {
    const { resolve } = await import('path')
    const target = resolve(args.cwd)
    process.chdir(target)
  }

  try {
    await startRepl({
      model,
      ollamaUrl,
      initialPrompt: args.prompt,
      dangerouslySkipPermissions: args.dangerouslySkipPermissions,
      resume: args.resume,
      continue: args.continue,
      verbose: args.verbose,
      team: args.team,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(renderError(msg))
    process.exit(1)
  }
}

main()
