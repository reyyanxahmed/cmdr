/**
 * CLI argument parsing.
 */

import type { EffortLevel } from '../core/types.js'

export interface CliArgs {
  model?: string
  ollamaUrl?: string
  provider?: string
  help?: boolean
  version?: boolean
  prompt?: string
  dangerouslySkipPermissions?: boolean
  resume?: string
  continue?: boolean
  verbose?: boolean
  cwd?: string
  team?: string
  maxTurns?: number
  outputFormat?: 'text' | 'json' | 'stream-json'
  effort?: EffortLevel
  fast?: boolean
  image?: string
  // serve subcommand
  serve?: boolean
  port?: number
  host?: string
  // buddy
  noBuddy?: boolean
  // daemon subcommand
  daemon?: string  // 'start' | 'status' | 'stop'
  watch?: string[]
  onChange?: string
  // browser
  browser?: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]

    switch (arg) {
      case '--model':
      case '-m':
        args.model = argv[++i]
        break
      case '--ollama-url':
      case '-u':
        args.ollamaUrl = argv[++i]
        break
      case '--provider':
        args.provider = argv[++i]
        break
      case '--help':
      case '-h':
        args.help = true
        break
      case '--version':
      case '-v':
        args.version = true
        break
      case '--prompt':
      case '-p':
        args.prompt = argv[++i]
        break
      case '--dangerously-skip-permissions':
        args.dangerouslySkipPermissions = true
        break
      case '--resume':
      case '-r':
        args.resume = argv[++i]
        break
      case '--continue':
      case '-c':
        args.continue = true
        break
      case '--cwd':
        args.cwd = argv[++i]
        break
      case '--verbose':
        args.verbose = true
        break
      case '--max-turns':
        args.maxTurns = parseInt(argv[++i], 10)
        break
      case '--team':
      case '-t':
        args.team = argv[++i]
        break
      case '--output-format':
        args.outputFormat = argv[++i] as 'text' | 'json' | 'stream-json'
        break
      case '--effort':
      case '-e':
        args.effort = argv[++i] as EffortLevel
        break
      case '--fast':
        args.fast = true
        break
      case '--image':
      case '-i':
        args.image = argv[++i]
        break
      case 'serve':
        args.serve = true
        break
      case 'daemon':
        args.daemon = argv[++i] // start|status|stop
        break
      case '--watch':
        if (!args.watch) args.watch = []
        args.watch.push(argv[++i])
        break
      case '--on-change':
        args.onChange = argv[++i]
        break
      case '--port':
        args.port = parseInt(argv[++i], 10)
        break
      case '--host':
        args.host = argv[++i]
        break
      case '--no-buddy':
        args.noBuddy = true
        break
      case '--browser':
        args.browser = true
        break
      default:
        // If no flag prefix, treat as inline prompt
        if (!arg.startsWith('-') && !args.prompt) {
          args.prompt = argv.slice(i).join(' ')
          i = argv.length
        }
        break
    }

    i++
  }

  return args
}

export function printHelp(): void {
  console.log(`
  cmdr — local-first multi-agent coding tool

  Usage:
    cmdr [options] [prompt]
    cmdr serve [options]

  Options:
    -m, --model <name>       Set the model (auto-detects if omitted)
    --provider <name>        Provider: ollama, openai, anthropic, qwen
    -u, --ollama-url <url>   Ollama server URL (default: http://localhost:11434)
    -p, --prompt <text>      Run a single prompt and exit
    -r, --resume <id>        Resume a previous session
    -c, --continue           Resume most recent session for this directory
    -t, --team <preset>      Run in team mode (review, fullstack, security)
    --cwd <path>             Set working directory
    --verbose                Print full tool output (default: collapsed)
    --max-turns <n>          Maximum agent turns before stopping
    --output-format <fmt>    Output format: text (default), json, stream-json
    -e, --effort <level>     Effort level: low, medium (default), high, max
    --fast                   Alias for --effort low
    -i, --image <path>       Attach an image to the prompt (vision models)
    --no-buddy               Disable buddy companion on startup
    --browser                Enable browser automation tools (requires playwright-core)
    -h, --help               Show this help
    -v, --version            Show version
    --dangerously-skip-permissions  Auto-approve all tool calls (yolo mode)

  Serve options:
    --port <n>               HTTP server port (default: 4141)
    --host <addr>            HTTP server host (default: 127.0.0.1)

  Daemon options:
    --watch <path>           Directory to watch (repeatable)
    --on-change <cmd>        Command to run on file change

  Examples:
    cmdr                           Start interactive REPL
    cmdr "fix the failing tests"   Run a single prompt
    cmdr -m llama3.1:8b            Start with a specific model
    cmdr serve --port 8080         Start HTTP/SSE server
    cmdr daemon start --watch src/ --on-change "npm run lint"
`)
}
