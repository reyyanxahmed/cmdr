# cmdr

> Open-source multi-agent coding tool for your terminal. Powered by local LLMs via Ollama.

```
   ██████╗███╗   ███╗██████╗ ██████╗ 
  ██╔════╝████╗ ████║██╔══██╗██╔══██╗
  ██║     ██╔████╔██║██║  ██║██████╔╝
  ██║     ██║╚██╔╝██║██║  ██║██╔══██╗
  ╚██████╗██║ ╚═╝ ██║██████╔╝██║  ██║
   ╚═════╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝
```

## Features

- **Local-first**: Ollama is the primary backend. No API keys required.
- **Multi-agent ready**: Specialized agents (planner, coder, reviewer, executor) for complex tasks.
- **Terminal-native**: Interactive REPL with streaming output, markdown rendering, and AMOLED black + green/purple aesthetic.
- **Full tool suite**: bash, file_read, file_write, file_edit, grep, glob, git_diff, git_log, think.
- **Model-agnostic**: Works with any Ollama model. Supports qwen2.5-coder, llama3.1, mistral, and more.

## Quick Start

```bash
# Install Ollama (if not already)
curl -fsSL https://ollama.com/install.sh | sh

# Pull a coding model
ollama pull qwen2.5-coder:14b

# Install cmdr
npm install -g cmdr-agent

# Start coding
cd your-project
cmdr
```

## Usage

```bash
# Interactive REPL
cmdr

# Single prompt
cmdr "add input validation to the POST /users endpoint"

# With a specific model
cmdr -m qwen2.5-coder:32b

# Custom Ollama URL
cmdr -u http://remote-server:11434
```

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/model <name>` | Switch Ollama model |
| `/models` | List available models |
| `/status` | Show session info |
| `/compact` | Manually trigger history compaction |
| `/diff` | Show git diff of changes |
| `/quit` | Exit cmdr |

## Built-in Tools

| Tool | Description |
|---|---|
| `bash` | Execute shell commands with timeout and error handling |
| `file_read` | Read file contents with offset/limit support |
| `file_write` | Create or overwrite files (auto-creates directories) |
| `file_edit` | Surgical string replacement in files |
| `grep` | Regex search (uses ripgrep when available) |
| `glob` | Find files by pattern |
| `git_diff` | Show working tree or staged changes |
| `git_log` | Recent commit history |
| `think` | Extended reasoning scratchpad (no side effects) |

## Configuration

cmdr respects these environment variables:

- `CMDR_MODEL` — Default model (default: `qwen2.5-coder:14b`)
- `CMDR_OLLAMA_URL` — Ollama server URL (default: `http://localhost:11434`)

## Architecture

cmdr is built on a clean, layered architecture:

- **CLI Layer**: REPL, markdown rendering, spinner states, slash commands
- **Core Layer**: Agent, AgentRunner (conversation loop), presets
- **LLM Layer**: OllamaAdapter (primary), model registry, token counting
- **Tool Layer**: ToolRegistry, ToolExecutor, 9 built-in tools
- **Session Layer**: SessionManager, ProjectContext discovery, PromptBuilder

## License

MIT — Reyyan Ahmed
