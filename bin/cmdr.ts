#!/usr/bin/env node

/**
 * cmdr — CLI entry point.
 *
 * Open-source multi-agent coding tool for your terminal.
 * Powered by local LLMs via Ollama.
 */

import { parseArgs, printHelp } from '../src/cli/args.js'
import { startRepl } from '../src/cli/repl.js'
import { GREEN, PURPLE, DIM, renderError, WHITE, CYAN } from '../src/cli/theme.js'
import { OllamaAdapter } from '../src/llm/ollama.js'
import * as readline from 'readline'

const VERSION = '1.1.0'

/** Prompt user to pick a model from the list. */
function promptModelSelection(models: string[]): Promise<string> {
  return new Promise((resolve) => {
    console.log('')
    console.log(`  ${PURPLE.bold('Available models')}`)
    console.log('')
    for (let i = 0; i < models.length; i++) {
      const label = models[i].toLowerCase().includes('coder')
        ? `${WHITE(models[i])} ${DIM('(recommended)')}`
        : WHITE(models[i])
      console.log(`  ${GREEN(`${i + 1}.`)} ${label}`)
    }
    console.log('')

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    rl.question(`  ${CYAN('Select model')} ${DIM(`[1-${models.length}]`)}: `, (answer) => {
      rl.close()
      const idx = parseInt(answer.trim(), 10) - 1
      if (idx >= 0 && idx < models.length) {
        resolve(models[idx])
      } else {
        // Default to first model on invalid input
        console.log(`  ${DIM('Invalid selection, using:')} ${GREEN(models[0])}`)
        resolve(models[0])
      }
    })
  })
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
      model = await promptModelSelection(models)
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
      version: VERSION,
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
