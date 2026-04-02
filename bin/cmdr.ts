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

const VERSION = '0.1.0'

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

  const model = args.model ?? process.env.CMDR_MODEL ?? 'qwen2.5-coder:14b'
  const ollamaUrl = args.ollamaUrl ?? process.env.CMDR_OLLAMA_URL ?? 'http://localhost:11434'

  try {
    await startRepl({
      model,
      ollamaUrl,
      initialPrompt: args.prompt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(renderError(msg))
    process.exit(1)
  }
}

main()
