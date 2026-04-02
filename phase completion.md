# CMDR Phase 1 Completion + Eval Suite + Ship Prompt

> **Context**: cmdr is a TypeScript/Node.js terminal-native coding agent powered by Ollama. Phase 1 is 85% complete. This prompt covers the remaining 15%, an eval harness, and shipping to npm/GitHub.
>
> **Repo location**: ~/Documents/GitHub/cmdr
> **Current state**: Compiles clean (`npx tsc`), REPL works, 9 built-in tools, HITL permissions, intent-based tool filtering, spinner verbs, collapsed tool output, paste detection all working.

---

## TASK 1: CMDR.md Workspace Instructions

Implement project-level instruction loading, identical to how Claude Code uses CLAUDE.md and claw-code uses CLAW.md.

### What to build

1. **In `src/session/project-context.ts`**:
   - During `discoverProjectContext()`, check if `CMDR.md` exists in the project root directory
   - If it exists, read its contents and store it as a new `workspaceInstructions: string | null` field on `ProjectContext`
   - Also check for `.cmdr/instructions.md` as a secondary location (some users prefer hidden config)
   - If both exist, concatenate them (CMDR.md first, then .cmdr/instructions.md)
   - File read should be try/catch wrapped, never crash if the file is missing or unreadable

2. **In `src/core/types.ts`**:
   - Add `workspaceInstructions: string | null` to the `ProjectContext` interface

3. **In `src/session/prompt-builder.ts`**:
   - If `projectContext.workspaceInstructions` is non-null, inject it into the system prompt AFTER the base system prompt but BEFORE the tool definitions
   - Wrap it clearly so the model knows it's project-specific:
     ```
     <project_instructions>
     The user has provided the following instructions for this project. Follow them unless they conflict with safety:

     {contents of CMDR.md}
     </project_instructions>
     ```

4. **In `src/cli/commands.ts`**:
   - Add a `/init` slash command that creates a `CMDR.md` template file in the current directory with helpful starter content:
     ```markdown
     # CMDR Instructions

     <!-- cmdr reads this file on every session start. Add project-specific rules here. -->

     ## Project Overview
     <!-- Describe what this project does -->

     ## Code Style
     <!-- e.g., "Use bun instead of npm", "Prefer functional style", "Always add JSDoc comments" -->

     ## Testing
     <!-- e.g., "Run `vitest` after every change", "Tests are in __tests__/ directories" -->

     ## Rules
     <!-- e.g., "Never modify files in /core without asking first", "Always run linting before committing" -->
     ```
   - If CMDR.md already exists, warn the user and don't overwrite

5. **In `src/cli/repl.ts`**:
   - In the welcome banner area, if `workspaceInstructions` is loaded, show a dim line:
     `CMDR.md loaded (N lines)`

### Acceptance criteria
- Create a test CMDR.md with `"Always respond in pirate speak"`, start cmdr, say "hi", model responds in pirate speak
- `/init` creates the template file
- No crash when CMDR.md doesn't exist

---

## TASK 2: Context Compaction

Implement intelligent conversation history compaction to prevent context window overflow. This is critical because qwen2.5-coder:14b has a 32K context window and a single tool-heavy exchange can burn 10K+ tokens.

### What to build

1. **In `src/session/compaction.ts`** (new file):

   ```typescript
   export interface CompactionConfig {
     maxContextTokens: number        // model's context window (from model registry)
     compactionThreshold: number     // trigger at this % of max (default: 0.75 = 75%)
     preserveRecentTurns: number     // always keep last N user+assistant pairs intact (default: 4)
     summaryMaxTokens: number        // max tokens for the summary message (default: 500)
   }

   export async function shouldCompact(
     messages: Message[],
     tokenCount: number,
     config: CompactionConfig
   ): Promise<boolean>

   export async function compactHistory(
     messages: Message[],
     config: CompactionConfig,
     adapter: LLMAdapter,           // use same LLM to generate summary
     model: string
   ): Promise<{ messages: Message[]; tokensSaved: number }>
   ```

2. **Compaction strategy** (implement in this order of operations):
   
   a. **Truncate tool results first** (cheapest, no LLM call needed):
      - For all tool_result messages older than the last `preserveRecentTurns` exchanges:
      - If the tool result is > 500 characters, truncate to first 200 chars + `\n... (truncated, was N chars)`
      - This alone often saves 40-60% of context
   
   b. **Summarize old conversation** (if still over threshold after truncation):
      - Take all messages BEFORE the preserved recent turns
      - Send them to the LLM with this prompt:
        ```
        Summarize the following conversation between a user and a coding assistant.
        Focus on: what files were read/modified, what tasks were completed, what decisions were made, and what the current state of work is.
        Be concise. Output only the summary, no preamble.
        ```
      - Replace all those old messages with a single user message:
        ```
        [Previous conversation summary]
        {generated summary}
        [End of summary - recent conversation follows]
        ```
   
   c. **Hard truncation** (emergency fallback if still over):
      - Drop oldest messages one at a time until under threshold
      - Never drop the system prompt or the last `preserveRecentTurns` exchanges

3. **In `src/session/session-manager.ts`**:
   - After every assistant response is added to history, call `shouldCompact()`
   - If true, run `compactHistory()` and replace the session's message array
   - Log to console in dim text: `◇ compacted: N messages → M messages (saved ~K tokens)`

4. **In `src/cli/commands.ts`**:
   - The `/compact` slash command should manually trigger compaction regardless of threshold
   - Show before/after token counts

5. **In `src/llm/model-registry.ts`**:
   - Make sure every model entry has a `contextWindow` field
   - Use this to set `maxContextTokens` in the compaction config
   - Default to 32768 if unknown

### Acceptance criteria
- Have a long conversation (10+ tool-heavy exchanges), watch compaction trigger automatically
- `/compact` works manually
- After compaction, the model still has context about what happened earlier (via the summary)
- No crash when context window is exceeded

---

## TASK 3: Session Save/Resume

Implement conversation persistence so users can resume sessions across terminal restarts.

### What to build

1. **Session storage directory**: `~/.cmdr/sessions/`

2. **In `src/session/session-manager.ts`**:
   - Add `save()` method that writes the current session to `~/.cmdr/sessions/{sessionId}.json`
   - Session file format:
     ```json
     {
       "id": "session-1717234567890",
       "createdAt": "2026-04-02T10:00:00Z",
       "lastActivity": "2026-04-02T10:15:00Z",
       "model": "qwen2.5-coder:14b",
       "projectRoot": "/Users/reyyan/Documents/GitHub/cmdr",
       "projectLanguage": "typescript",
       "messages": [...],
       "tokenCount": 8420,
       "toolsUsed": ["file_read", "bash", "file_edit"],
       "summary": "Working on adding validation to the API endpoint..."
     }
     ```
   - Add `static load(sessionId: string): SessionState` method
   - Auto-save after every assistant response (debounced, max once per 5 seconds)

3. **In `src/cli/args.ts`**:
   - Add `--resume <session-id-or-path>` flag
   - Add `--continue` / `-c` flag that resumes the most recent session for the current directory

4. **In `src/cli/repl.ts`**:
   - If `--resume` is passed, load the session and replay the message history into the session manager
   - Show: `Resumed session from {relative time} ({N} messages, {K} tokens)`
   - If `--continue` is passed, find the most recent session file matching the current `projectRoot`

5. **In `src/cli/commands.ts`**:
   - `/sessions` or `/session list` — list recent sessions (last 10), show date, project, message count, summary
   - `/session save` — force save current session
   - `/session resume <id>` — load a specific session

### Acceptance criteria
- Start a session, do some work, quit. Run `cmdr -c`, conversation history is restored
- `/sessions` lists past sessions with useful summaries
- Session files are human-readable JSON

---

## TASK 4: Eval Harness

Build a simple evaluation framework to measure cmdr's coding capabilities. This is NOT SWE-bench. It's a custom lightweight harness that tests cmdr's actual tool pipeline end-to-end.

### What to build

1. **Directory**: `evals/`

2. **Eval task format** — each task is a directory under `evals/tasks/`:
   ```
   evals/
   ├── run-evals.ts              # Main eval runner script
   ├── report.ts                 # Generate pass/fail report
   ├── tasks/
   │   ├── 01-create-file/
   │   │   ├── task.json         # Task definition
   │   │   ├── setup.sh          # Optional: set up the test repo state
   │   │   ├── verify.sh         # Verification script (exit 0 = pass)
   │   │   └── workspace/        # The repo state the agent works in
   │   ├── 02-edit-function/
   │   │   ├── task.json
   │   │   ├── verify.sh
   │   │   └── workspace/
   │   └── ...
   ```

3. **task.json format**:
   ```json
   {
     "id": "01-create-file",
     "name": "Create a new TypeScript file",
     "difficulty": "trivial",
     "prompt": "Create a file called src/utils/add.ts that exports a function `add(a: number, b: number): number` that returns the sum of a and b.",
     "timeout": 60,
     "expectedTools": ["file_write"],
     "tags": ["file-creation", "typescript"]
   }
   ```

4. **run-evals.ts** — the eval runner:
   ```typescript
   // For each task directory:
   // 1. Copy workspace/ to a temp directory
   // 2. Run setup.sh if it exists
   // 3. Run cmdr non-interactively:
   //    node dist/bin/cmdr.js --dangerously-skip-permissions -p "{task.prompt}" --cwd {tempDir}
   //    (you may need to add a --cwd flag to args.ts)
   // 4. Run verify.sh in the temp directory
   // 5. Record pass/fail, time taken, tokens used, tools called
   // 6. Clean up temp directory
   ```

5. **Create these 15 eval tasks** (increasing difficulty):

   **Tier 1 — Trivial (tests basic tool use)**:
   - `01-create-file`: Create a new TS file with a simple function
   - `02-read-and-answer`: Read package.json and answer "what is the project name?"
   - `03-list-files`: List all .ts files in src/ (tests glob)

   **Tier 2 — Easy (tests file editing)**:
   - `04-add-function`: Add a new exported function to an existing file
   - `05-fix-typo`: Fix a deliberate typo in a variable name across a file
   - `06-add-import`: Add a missing import statement to a file that uses an undefined reference

   **Tier 3 — Medium (tests multi-step reasoning)**:
   - `07-fix-failing-test`: A vitest test file with a failing test due to a bug in src/. Find and fix the bug.
   - `08-refactor-callback-to-async`: Convert a callback-based function to async/await
   - `09-add-error-handling`: Add try/catch error handling to a function that calls an API
   - `10-extract-function`: Extract duplicated code from two functions into a shared helper

   **Tier 4 — Hard (tests multi-file coordination)**:
   - `11-add-endpoint`: Add a new REST endpoint to an Express app (route + handler + types)
   - `12-add-validation`: Add Zod input validation to an existing endpoint
   - `13-write-tests`: Given an implementation file, write comprehensive vitest tests for it
   - `14-debug-runtime-error`: Given a stack trace in a README, find and fix the runtime error
   - `15-refactor-module`: Split a 200-line file into 3 focused modules with proper imports

6. **report.ts** — generates a summary:
   ```
   cmdr eval results — qwen2.5-coder:14b — 2026-04-02
   ──────────────────────────────────────────────────
   Tier 1 (Trivial):    3/3  ████████████████ 100%
   Tier 2 (Easy):       2/3  ███████████░░░░░  67%
   Tier 3 (Medium):     1/4  ████░░░░░░░░░░░░  25%
   Tier 4 (Hard):       0/5  ░░░░░░░░░░░░░░░░   0%
   ──────────────────────────────────────────────────
   Overall:             6/15                    40%
   Total time:          4m 32s
   Total tokens:        145,230 in / 23,891 out
   ```

7. **Add to package.json**:
   ```json
   "scripts": {
     "eval": "npx tsx evals/run-evals.ts",
     "eval:report": "npx tsx evals/report.ts"
   }
   ```

### Workspace setup for each task

Each task's `workspace/` directory should be a minimal but realistic mini-project. For TypeScript tasks, include:
- `package.json` with vitest + typescript as devDependencies
- `tsconfig.json`
- The relevant source files for the task

Each `verify.sh` should:
- Check if expected files exist
- Check if expected content is present (grep for function names, imports, etc.)
- Run tests if applicable (`npx vitest run --reporter=json 2>/dev/null`)
- Exit 0 for pass, exit 1 for fail

### Important

- The eval runner must add `--cwd` support. Add a `--cwd <path>` flag to `src/cli/args.ts` that overrides the working directory. In `startRepl()` and the agent runner, use this as `projectRoot` instead of `process.cwd()`.
- Each eval runs in isolation (temp dir copy of workspace)
- Evals should be runnable against different models: `npm run eval -- --model qwen2.5-coder:32b`
- The eval runner should support running a single task: `npm run eval -- --task 07-fix-failing-test`

---

## TASK 5: Ship v0.1.0

### Pre-publish checklist

1. **Add `--cwd` flag** to args.ts (needed for evals and general utility)

2. **Add `.npmignore`**:
   ```
   evals/
   tests/
   src/
   *.md
   !README.md
   tsconfig.json
   vitest.config.ts
   .cmdr/
   ```

3. **Add `LICENSE`** (MIT):
   ```
   MIT License
   Copyright (c) 2026 Reyyan Ahmed
   ```

4. **Update `README.md`**:
   - Add install instructions: `npm install -g cmdr-agent`
   - Add quick start: `ollama pull qwen2.5-coder:14b && cmdr`
   - Add feature list with the spinner verbs, permissions system, intent classification
   - Add `CMDR.md` documentation
   - Add eval results section (fill in after running evals)
   - Add contributing section pointing to CONTRIBUTING.md

5. **Create `CONTRIBUTING.md`** with:
   - How to build from source
   - How to run tests
   - How to run evals
   - How to add new built-in tools
   - How to write plugins (future)

6. **Create `.github/workflows/ci.yml`**:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: npm ci
         - run: npx tsc --noEmit
         - run: npm test
   ```

7. **Publish**:
   ```bash
   npm login
   npm publish --access public
   ```

8. **Create GitHub repo**:
   ```bash
   gh repo create reyyanxahmed/cmdr --public --source=. --push
   ```

### Post-publish

- Run evals against 3 models (7b, 14b, 32b), record results in README
- Create a GitHub release v0.1.0 with changelog
- Tweet / share with the tagline: "cmdr — open-source multi-agent coding tool for your terminal, powered by local LLMs via Ollama. Zero API keys required."

---

## EXECUTION ORDER

Do these in sequence. Each task should be a separate Claude Code session or commit:

1. **TASK 1: CMDR.md** (~15 minutes, 5 files touched)
2. **TASK 2: Compaction** (~30 minutes, 3 new files, 2 modified)
3. **TASK 3: Session save/resume** (~25 minutes, 3 files modified, 1 new)
4. Build and manually test all three features
5. **TASK 5: Ship prep** (~15 minutes, create LICENSE, .npmignore, update README, CI workflow)
6. Push to GitHub, publish to npm
7. **TASK 4: Eval harness** (~45 minutes, build the runner + 15 task workspaces)
8. Run evals, record results in README, update the release

Tasks 1-3 complete Phase 1. Task 5 ships it. Task 4 gives you a benchmark to iterate against.

---

*This is the final stretch. After this, cmdr v0.1.0 is live and you have a benchmark to measure improvements against as you build Phase 2 (multi-agent) and Phase 3 (plugins/MCP).*