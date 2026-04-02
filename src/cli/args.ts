/**
 * CLI argument parsing.
 */

export interface CliArgs {
  model?: string
  ollamaUrl?: string
  help?: boolean
  version?: boolean
  prompt?: string
  dangerouslySkipPermissions?: boolean
  resume?: string
  continue?: boolean
  verbose?: boolean
  cwd?: string
  team?: string
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
      case '--team':
      case '-t':
        args.team = argv[++i]
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

  Options:
    -m, --model <name>       Set the Ollama model (auto-detects if omitted)
    -u, --ollama-url <url>   Ollama server URL (default: http://localhost:11434)
    -p, --prompt <text>      Run a single prompt and exit
    -r, --resume <id>        Resume a previous session
    -c, --continue           Resume most recent session for this directory
    -t, --team <preset>      Run in team mode (review, fullstack, security)
    --cwd <path>             Set working directory
    --verbose                Print full tool output (default: collapsed)
    -h, --help               Show this help
    -v, --version            Show version
    --dangerously-skip-permissions  Auto-approve all tool calls (yolo mode)

  Examples:
    cmdr                           Start interactive REPL
    cmdr "fix the failing tests"   Run a single prompt
    cmdr -m llama3.1:8b            Start with a specific model
`)
}
