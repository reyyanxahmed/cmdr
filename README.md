# cmdr

> Open-source, Ollama-native, multi-agent coding tool for your terminal.

```
   ██████╗███╗   ███╗██████╗ ██████╗ 
  ██╔════╝████╗ ████║██╔══██╗██╔══██╗
  ██║     ██╔████╔██║██║  ██║██████╔╝
  ██║     ██║╚██╔╝██║██║  ██║██╔══██╗
  ╚██████╗██║ ╚═╝ ██║██████╔╝██║  ██║
   ╚═════╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝
```

**cmdr** is a local-first AI coding assistant that runs entirely on your machine using [Ollama](https://ollama.ai). No API keys, no cloud, no data leaves your laptop.

## Features

- **Local-first** — powered by Ollama, all inference runs on your hardware
- **Multi-agent architecture** — extensible agent/runner pipeline with tool calling
- **Interactive REPL** — streaming output, markdown rendering, AMOLED-friendly theme
- **Built-in tools** — file read/write/edit, glob, grep, bash, git diff/log, think
- **HITL permissions** — approve, deny, or always-allow each tool call
- **Context compaction** — multi-stage strategy keeps conversations within context limits
- **Session persistence** — auto-save, resume, and `--continue` flag
- **Project awareness** — auto-detects language, framework, and reads `CMDR.md` instructions
- **Whimsical UX** — 150+ spinner verbs, past-tense summaries, collapsed tool output

## Quick Start

```bash
# Install Ollama (https://ollama.ai)
ollama pull qwen3-coder:latest

# Install cmdr
npm install -g cmdr-agent

# Start coding
cmdr
```

## Usage

```bash
cmdr                             # Interactive REPL
cmdr "fix the failing tests"     # Single prompt, then exit
cmdr -m llama3.1:8b              # Use a specific model
cmdr -c                          # Continue most recent session
cmdr --resume <session-id>       # Resume a specific session
cmdr --cwd /path/to/project      # Override working directory
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `-m, --model <name>` | Set the Ollama model |
| `-u, --ollama-url <url>` | Ollama server URL |
| `-p, --prompt <text>` | Run a single prompt and exit |
| `-r, --resume <id>` | Resume a previous session |
| `-c, --continue` | Resume most recent session for this directory |
| `--cwd <path>` | Set working directory |
| `--verbose` | Print full tool output |
| `--dangerously-skip-permissions` | Auto-approve all tool calls |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch model |
| `/models` | List available Ollama models |
| `/status` | Show session info |
| `/context` | Show context window usage |
| `/compact` | Manually trigger compaction |
| `/diff` | Show git diff |
| `/session save` | Save current session |
| `/session resume <id>` | Resume a session |
| `/sessions` | List saved sessions |
| `/permissions [mode]` | View/set permission mode |
| `/init` | Create CMDR.md template |
| `/clear` | Clear conversation |
| `/quit` | Exit |

### Built-in Tools

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands with timeout and error handling |
| `file_read` | Read file contents with offset/limit support |
| `file_write` | Create or overwrite files (auto-creates directories) |
| `file_edit` | Surgical string replacement in files |
| `grep` | Regex search (uses ripgrep when available) |
| `glob` | Find files by pattern |
| `git_diff` | Show working tree or staged changes |
| `git_log` | Recent commit history |
| `think` | Extended reasoning scratchpad (no side effects) |

## CMDR.md

Create a `CMDR.md` file in your project root to give cmdr project-specific instructions:

```markdown
# CMDR Instructions

## Project Overview
A TypeScript web app using Next.js and Prisma.

## Code Style
- Use bun instead of npm
- Prefer functional components with hooks
- Always add JSDoc comments

## Testing
Run `vitest` after every change.

## Rules
- Never modify files in /core without asking
- Always run linting before committing
```

You can also use `.cmdr/instructions.md` — both files are loaded and concatenated.

## Permission Modes

- **normal** (default) — read-only tools auto-approved, write/bash require confirmation
- **yolo** — all tools auto-approved (use `--dangerously-skip-permissions`)
- **strict** — all tools require approval (`/permissions strict`)

## Configuration

cmdr reads a config file at `~/.cmdr/config.toml`:

```toml
[spinner]
speed = 150
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CMDR_MODEL` | `qwen2.5-coder:14b` | Default model |
| `CMDR_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |

## Architecture

```
bin/cmdr.ts          CLI entry point
src/
  cli/               REPL, commands, args, spinner, theme, renderer
  core/              Agent, AgentRunner, types, presets, permissions
  llm/               OllamaAdapter, model registry, token counter
  session/           SessionManager, compaction, persistence, project context
  tools/             ToolRegistry, ToolExecutor, built-in tools
```

## Development

```bash
git clone https://github.com/reyyanxahmed/cmdr.git
cd cmdr
npm install
npm run build
node dist/bin/cmdr.js -m qwen3-coder:latest
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) — Reyyan Ahmed
