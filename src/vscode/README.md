# cmdr — Local AI Coding Assistant for VS Code

Local-first alternative to Copilot. Your models, your machine, your data.

Powered by [Ollama](https://ollama.ai) and [cmdr](https://github.com/reyyanxahmed/cmdr).

## Features

- **`@cmdr` Chat** — Chat participant in VS Code's built-in chat panel
- **Inline Completions** — AI code completions as you type (Ollama FIM)
- **Code Actions** — Fix errors, explain, refactor, write tests from the lightbulb menu
- **Code Review** — AI-powered review of your git changes
- **Command Palette** — Quick access to all cmdr actions

## Requirements

- [Ollama](https://ollama.ai) installed and running
- [cmdr](https://www.npmjs.com/package/cmdr-agent) installed globally: `npm install -g cmdr-agent`

## Getting Started

1. Install Ollama and pull a model: `ollama pull qwen3-coder:latest`
2. Install cmdr: `npm install -g cmdr-agent`
3. Install this extension
4. The extension auto-starts `cmdr serve` in the background

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cmdr.model` | `qwen3-coder` | Model for chat and code actions |
| `cmdr.completionModel` | `qwen2.5-coder:7b` | Model for inline completions |
| `cmdr.effort` | `medium` | Effort level (low/medium/high/max) |
| `cmdr.ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `cmdr.inlineCompletions` | `true` | Enable inline completions |
| `cmdr.autoStart` | `true` | Auto-start cmdr serve |
| `cmdr.port` | `4200` | Server port |

## Commands

- **cmdr: Open Chat** — Open the `@cmdr` chat
- **cmdr: Explain Selection** — Explain selected code
- **cmdr: Refactor Selection** — Refactor selected code
- **cmdr: Write Tests** — Generate tests for selected code
- **cmdr: Fix Error** — Fix diagnostics on current file
- **cmdr: Review Changes** — Review git changes
- **cmdr: Switch Model** — Change the active model

## License

MIT
