# Configuration

[← Back to README](../README.md)

---

## Config Files

| Scope | Path |
|-------|------|
| User | `~/.cmdr/config.toml` |
| Project | `.cmdr.toml` |

```toml
defaultModel = "qwen3-coder:latest"
ollamaUrl = "http://localhost:11434"

[spinner]
speed = 150

[telemetry]
enabled = false   # opt-in local-only usage stats
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CMDR_MODEL` | `qwen2.5-coder:14b` | Default model |
| `CMDR_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |

## Permission Modes

| Mode | Behavior |
|------|----------|
| **normal** (default) | Read-only tools auto-approved; write/bash require confirmation |
| **yolo** | All tools auto-approved (`--dangerously-skip-permissions`) |
| **strict** | All tools require approval (`/permissions strict`) |

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

---

**Next:** [Benchmarks →](benchmarks.md)
