# Usage

[← Back to README](../README.md)

---

## CLI Flags

| Flag | Description |
|------|-------------|
| `-m, --model <name>` | Set the Ollama model |
| `-u, --ollama-url <url>` | Ollama server URL |
| `-p, --prompt <text>` | Run a single prompt and exit |
| `-r, --resume <id>` | Resume a previous session |
| `-c, --continue` | Resume most recent session for this directory |
| `-t, --team <preset>` | Run with a multi-agent team (`review`, `fullstack`, `security`) |
| `--cwd <path>` | Set working directory |
| `--verbose` | Print full tool output |
| `--dangerously-skip-permissions` | Auto-approve all tool calls |
| `--max-turns <n>` | Limit agent tool-call turns |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch model |
| `/models` | List available Ollama models |
| `/status` | Show session info |
| `/context` | Show context window usage |
| `/compact` | Manually trigger compaction |
| `/cost` | Show token usage breakdown |
| `/undo` | Revert the last file change made by the agent |
| `/diff` | Show git diff |
| `/team [preset]` | Switch to a multi-agent team |
| `/agents` | Show active agents and status |
| `/tasks` | Show task queue status |
| `/config` | View configuration |
| `/plugin list` | List loaded plugins |
| `/mcp list` | List MCP server connections |
| `/session save` | Save current session |
| `/session resume <id>` | Resume a session |
| `/sessions` | List saved sessions |
| `/permissions [mode]` | View/set permission mode |
| `/init` | Create CMDR.md template |
| `/clear` | Clear conversation |
| `/quit` | Exit |

## Built-in Tools

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
| `git_commit` | Stage and commit files |
| `git_branch` | Create, switch, or list branches |
| `web_fetch` | Fetch a URL (SSRF-protected) |
| `ask_user` | Ask the user a question |
| `think` | Extended reasoning scratchpad (no side effects) |

---

**Next:** [Multi-Agent Teams →](multi-agent.md)
