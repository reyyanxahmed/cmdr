# Architecture

[← Back to README](../README.md)

---

## Project Structure

```
bin/cmdr.ts          CLI entry point
src/
  cli/               REPL, commands, args, spinner, theme, renderer
  core/              Agent, AgentRunner, Orchestrator, Team, presets, permissions
  communication/     MessageBus, SharedMemory, TaskQueue
  scheduling/        Semaphore, agent selection strategies
  config/            Config loader, schema, telemetry
  llm/               OllamaAdapter, model registry, token counter
  plugins/           PluginManager, McpClient
  session/           SessionManager, compaction, persistence, cost tracker, undo
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

### Watch mode

```bash
npm run dev
```

### Tests

```bash
npm test
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md).

---

[← Back to README](../README.md)
