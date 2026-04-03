# CMDR: Model Compatibility + Eval Hardening + Score Improvement

> **For**: Claude Opus 4 via Claude Code
> **Repo**: ~/Documents/GitHub/cmdr
> **Priority**: Fix model adapters first, then harden evals, then improve scores
> **Context**: cmdr scores 30/50 (Grade B) with qwen3-coder but 18/50 (Grade D) with gemma4:26b due to adapter bugs, not model capability. Three models need proper support: qwen3-coder, gemma4:26b, deepseek-coder-v2:16b.

---

## PROBLEM 1: Gemma4 Thinking Mode Eats Output

### Root Cause

Gemma4 uses a thinking/reasoning mode by default. When it "thinks," output goes into
`<|channel>thought\n...<channel|>` tokens that Ollama strips from the response content.
The model generates 100+ eval tokens but returns empty content strings. This happens
inconsistently: simple prompts sometimes bypass thinking, complex prompts always trigger it.

### Evidence

```
# With tools in system prompt:
Content: ''  (empty)
Eval count: 104  (tokens were generated but invisible)

# Without tools:
Content: 'Here is a Python script...' (works fine, 322 tokens)
```

### Fix (in `src/llm/ollama.ts`)

**Approach A (preferred): Disable thinking mode for gemma4 in API calls.**

In both `chat()` and `stream()` methods, when the model family is `gemma4`, add `think: false`
to the request options. Gemma4 supports this flag to disable the reasoning channel:

```typescript
// In buildRequestBody() or equivalent:
const options: Record<string, any> = {
  num_ctx: contextLength,
  temperature: temperature ?? 0.7,
};

// Disable thinking for gemma4 -- it eats tool-call output
if (this.modelFamily(model) === 'gemma4') {
  options.think = false;
}
```

If `think: false` doesn't work via the options object, try adding it as a top-level
request parameter alongside `model`, `messages`, `stream`:

```typescript
const body: any = {
  model,
  messages: convertedMessages,
  stream: true,
  options,
};

if (this.modelFamily(model) === 'gemma4') {
  body.think = false;
}
```

**Approach B (fallback): Prepend `/no_think` to the system prompt.**

Gemma4 documentation says thinking can be disabled by removing the `<|think|>` token
from the system prompt, or by starting the system prompt with a no-think directive.
If API-level `think: false` doesn't work:

```typescript
if (this.modelFamily(model) === 'gemma4' && messages[0]?.role === 'system') {
  messages[0].content = '/no_think\n' + messages[0].content;
}
```

**Approach C (nuclear): Parse thinking tokens from streamed output.**

If neither A nor B works, intercept the raw stream and strip `<|channel>thought\n...<channel|>`
blocks, extracting only the content after the thinking block:

```typescript
// In the stream processing loop:
let insideThinking = false;
for await (const chunk of rawStream) {
  const content = chunk.message?.content ?? '';
  if (content.includes('<|channel>thought')) {
    insideThinking = true;
    continue;
  }
  if (content.includes('<channel|>')) {
    insideThinking = false;
    continue;
  }
  if (!insideThinking) {
    // This is actual visible content, process it
  }
}
```

**Try A first, then B, then C. Test each with:**
```bash
curl -s http://localhost:11434/api/chat -d '{
  "model": "gemma4:26b",
  "messages": [
    {"role": "system", "content": "You are a coding assistant. Use the file_write tool."},
    {"role": "user", "content": "Create hello.py that prints Hello World"}
  ],
  "stream": false,
  "think": false
}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(repr(d['message']['content'][:500]))"
```

If content is non-empty, that approach works.

---

## PROBLEM 2: Universal Tool-Call Adapter

### Current State

The OllamaAdapter has two paths:
1. **Native tools**: Send tool definitions in the `tools` field, model returns `tool_calls` in response
2. **Prompt injection**: Inject tool descriptions into system prompt, parse model's text output

The problem: different models use different formats even when "native tools" are enabled:
- **qwen3-coder**: Ignores native tools, outputs `<function=name><parameter=key>value</parameter></function>` XML in text
- **gemma4**: Native tools return empty content (thinking mode bug above)
- **deepseek-coder-v2**: May use native tools OR its own format
- **dolphin3**: Unknown behavior

### Fix: Three-Stage Tool Resolution

Rewrite the tool-call handling in `src/llm/ollama.ts` to use a waterfall strategy:

```typescript
// After getting the response (both chat and stream):

// Stage 1: Check for native tool_calls in the response
const nativeToolCalls = response.message?.tool_calls;
if (nativeToolCalls && nativeToolCalls.length > 0) {
  return processNativeToolCalls(nativeToolCalls);
}

// Stage 2: Check for XML-format tool calls in text
// Handles: <function=name><parameter=key>value</parameter></function>
const xmlToolCalls = parseXmlToolCalls(textContent);
if (xmlToolCalls.length > 0) {
  return xmlToolCalls;
}

// Stage 3: Check for JSON tool_call blocks in text
// Handles: ```tool_call\n{"name":"...", "arguments":{...}}\n```
const jsonToolCalls = parseJsonToolCalls(textContent);
if (jsonToolCalls.length > 0) {
  return jsonToolCalls;
}

// Stage 4: No tool calls found, return text as-is
```

This waterfall runs for ALL models regardless of the `TOOL_CAPABLE_FAMILIES` list.
The native path is tried first (cheapest), then text parsing as fallback.

### Additional: Model Family Detection

Create a proper `modelFamily()` method and a per-family configuration:

```typescript
interface ModelFamilyConfig {
  supportsNativeTools: boolean;     // Try native tool_calls first
  needsPromptInjection: boolean;    // Also inject tools into system prompt
  thinkingMode: 'auto' | 'disabled' | 'strip';  // How to handle thinking
  xmlToolFormat: boolean;           // Parses <function=...> XML
  jsonToolFormat: boolean;          // Parses ```tool_call JSON
  maxContextOverride?: number;      // Override context length
}

const MODEL_FAMILY_CONFIGS: Record<string, ModelFamilyConfig> = {
  'qwen3': {
    supportsNativeTools: true,      // Send tools in API
    needsPromptInjection: false,    // Don't also inject in prompt
    thinkingMode: 'auto',
    xmlToolFormat: true,            // Parses <function=...> as fallback
    jsonToolFormat: true,
    // qwen3-coder often ignores native tools and uses XML
  },
  'gemma4': {
    supportsNativeTools: false,     // Native tools return empty (Ollama bug)
    needsPromptInjection: true,     // Must inject tools in system prompt
    thinkingMode: 'disabled',       // Disable thinking (eats output)
    xmlToolFormat: false,
    jsonToolFormat: true,           // Responds with ```tool_call JSON
  },
  'deepseek': {
    supportsNativeTools: true,
    needsPromptInjection: false,
    thinkingMode: 'auto',
    xmlToolFormat: false,
    jsonToolFormat: true,
  },
  'llama3': {
    supportsNativeTools: true,
    needsPromptInjection: false,
    thinkingMode: 'auto',
    xmlToolFormat: false,
    jsonToolFormat: true,
  },
  'minimax': {
    supportsNativeTools: true,
    needsPromptInjection: false,
    thinkingMode: 'auto',
    xmlToolFormat: false,
    jsonToolFormat: true,
  },
  'default': {
    supportsNativeTools: false,
    needsPromptInjection: true,
    thinkingMode: 'auto',
    xmlToolFormat: true,
    jsonToolFormat: true,
  },
};
```

Use this config table everywhere instead of the `TOOL_CAPABLE_FAMILIES` array and
scattered if-statements. Every model-specific behavior should be driven by this table.

---

## PROBLEM 3: Verify Script Brittleness

### Current State

Many verify.sh scripts check for exact strings like `class LinkedList` or
`function EventEmitter`. If the model solves the task correctly but uses a
different naming convention or structure, the verify fails.

### Fix: Make Verify Scripts Behavioral, Not Textual

For each of the 20 currently-failing tasks (22-50), audit and rewrite the verify.sh
to test BEHAVIOR rather than exact text:

**Pattern 1: Run the code and check output (preferred)**
```bash
#!/bin/bash
set -e
cd "$1"

# Instead of: grep -q "class LinkedList" linked-list.js
# Do: Run a test that exercises the linked list
node -e "
  const LL = require('./linked-list.js');
  // Or: import if ESM
  const ll = new (LL.LinkedList || LL.default || LL)();
  ll.append(1); ll.append(2); ll.append(3);
  const arr = ll.toArray ? ll.toArray() : [];
  if (arr.length !== 3) process.exit(1);
  if (arr[0] !== 1 || arr[2] !== 3) process.exit(1);
  console.log('PASS');
"
```

**Pattern 2: Check for ANY file with expected functionality**
```bash
#!/bin/bash
set -e
cd "$1"

# Instead of: [[ -f linked-list.js ]]
# Do: Find any JS file that exports something linked-list-like
FOUND=$(find . -name "*.js" -o -name "*.mjs" -o -name "*.ts" | head -20)
[[ -n "$FOUND" ]] || { echo "No source files created"; exit 1; }

# Check if ANY file contains linked list functionality
grep -rl "append\|insert\|push\|add" *.js *.mjs *.ts 2>/dev/null || \
  { echo "No linked list methods found"; exit 1; }
```

**Pattern 3: For multi-file tasks, check structure not content**
```bash
#!/bin/bash
set -e
cd "$1"

# Check that files were split (at least 2 new files created)
NEW_FILES=$(find . -name "*.js" -newer .git/HEAD | wc -l)
[[ $NEW_FILES -ge 2 ]] || { echo "Expected 2+ new files, got $NEW_FILES"; exit 1; }

# Check that original monolith was modified or removed
[[ ! -s monolith.js ]] || {
  LINES=$(wc -l < monolith.js)
  [[ $LINES -lt 100 ]] || { echo "Monolith still has $LINES lines"; exit 1; }
}
```

### Specific Tasks to Fix

Audit and rewrite verify.sh for these tasks (all currently failing on both models):

| Task | Current Check | Should Check |
|---|---|---|
| 22-linked-list | Exact class name | Run a test script that exercises append/remove/find |
| 23-event-emitter | Exact class name | Run a test: on/emit/off work correctly |
| 25-express-middleware | Exact file structure | Check middleware functions exist, exported |
| 30-state-machine | Exact class/function names | Run transitions, verify valid/invalid throw |
| 31-binary-search-tree | Exact class name | Run insert/search/traverse test |
| 32-rest-api-crud | Exact endpoint paths | Start server, curl endpoints, check responses |
| 33-fix-race-condition | Grep for mutex/lock | Run concurrent test, verify no duplicates |
| 34-plugin-system | Exact interface names | Load a test plugin, verify hooks fire |
| 35-deep-clone | Exact function name | Run clone test with nested objects, verify independence |
| 37-dependency-graph | Exact function name | Run topological sort test with known graph |
| 38-template-engine | Exact render function | Run template with variables, verify output |
| 39-test-framework | Exact test runner name | Run the framework on sample tests |
| 40-multi-file-refactor | Exact file names | Check original was split, imports work |
| 42-observable-pattern | Exact class name | Run subscribe/emit test |
| 44-http-router | Exact function name | Run routing test with paths |
| 46-worker-thread-pool | Exact class name | Run pool with tasks, verify concurrency |
| 47-schema-validator | Exact function name | Run validation tests |
| 48-reactive-store | Exact class name | Run store subscribe/update test |
| 49-code-formatter | Exact output format | Check output has consistent indentation |
| 50-mini-bundler | Exact output format | Run bundler, verify output is single file |

For each task, the verify.sh should:
1. First try to `require()` or `import()` the created file(s)
2. Exercise the core functionality with 2-3 test cases
3. Only fall back to grep/string checks if the code can't be executed

---

## PROBLEM 4: System Prompt Improvements for Higher Scores

### Multi-File Tasks (0/4 currently)

The solo coder preset needs explicit multi-file instructions. Add to `src/core/presets.ts`:

```
MULTI-FILE WORKFLOW:
When a task involves multiple files:
1. First, use glob to discover the project structure
2. Read ALL relevant files before making any changes
3. Plan your changes: list which files need modification and in what order
4. Make changes in dependency order (shared utilities first, then consumers)
5. After all changes, verify imports resolve correctly
6. If splitting a file, ensure the original file's exports are preserved or re-exported
```

### Tool-Use Efficiency

Add to the system prompt:
```
TOOL-USE RULES:
- When asked to CREATE a file: use file_write directly. Do not read first.
- When asked to MODIFY a file: read it first with file_read, then use file_edit.
- When asked to FIX a bug: read the file, identify the issue, fix with file_edit, then run tests with bash.
- When asked to RENAME or REFACTOR: read the file, write the new version with file_write, verify with bash.
- Prefer file_edit over file_write for modifications (preserves unrelated code).
- After writing code, always verify it works: run it with bash or check syntax.
- Do NOT read files that aren't relevant to the task.
- Do NOT explore the project structure unless the task requires understanding the codebase.
```

### Response Format

Add:
```
OUTPUT RULES:
- Be concise. Explain what you're doing in 1 sentence, then use tools.
- Do not repeat file contents in your text response after writing them.
- Do not ask clarifying questions in one-shot mode. Just do the task.
- If a task is ambiguous, make reasonable assumptions and proceed.
```

---

## PROBLEM 5: Timeout Handling

### Current Issue

3 tasks timeout at 180s on both models. The eval runner uses `spawnSync` with a fixed timeout.

### Fix

1. **Scale timeout by tier**: basic=60s, intermediate=90s, advanced=120s, hard=180s, expert=300s, extreme=300s
2. **In the eval runner** (`evals/lib/runner.ts`), read the task's tier and set timeout accordingly:

```typescript
function getTimeoutForTier(tier: string): number {
  const timeouts: Record<string, number> = {
    basic: 60_000,
    intermediate: 90_000,
    advanced: 120_000,
    hard: 180_000,
    expert: 300_000,
    extreme: 300_000,
  };
  return timeouts[tier] ?? 120_000;
}
```

3. **Add a `maxTurns` limit per tier** as well: basic=5, intermediate=10, advanced=15, hard=20, expert=30, extreme=30.
   Pass this to cmdr via a new `--max-turns N` CLI flag. This prevents the model from
   getting stuck in infinite tool-call loops.

---

## PROBLEM 6: Model Registry Completeness

Update `src/llm/model-registry.ts` KNOWN_MODELS to include all models you support:

```typescript
const KNOWN_MODELS: Record<string, ModelInfo> = {
  'qwen3-coder':       { contextWindow: 65536,   supportsTools: true },
  'qwen2.5-coder':     { contextWindow: 32768,   supportsTools: true },
  'gemma4':            { contextWindow: 262144,  supportsTools: false }, // prompt-injection only
  'gemma4:e4b':        { contextWindow: 131072,  supportsTools: false },
  'gemma4:e2b':        { contextWindow: 131072,  supportsTools: false },
  'gemma4:31b':        { contextWindow: 262144,  supportsTools: false },
  'deepseek-coder-v2': { contextWindow: 131072,  supportsTools: true },
  'deepseek-coder':    { contextWindow: 16384,   supportsTools: true },
  'llama3.1':          { contextWindow: 131072,  supportsTools: true },
  'llama3.2':          { contextWindow: 131072,  supportsTools: true },
  'mistral':           { contextWindow: 32768,   supportsTools: true },
  'mistral-nemo':      { contextWindow: 131072,  supportsTools: true },
  'codellama':         { contextWindow: 16384,   supportsTools: false },
  'dolphin3':          { contextWindow: 16384,   supportsTools: false },
  'minimax-m2.5':      { contextWindow: 1048576, supportsTools: true },
  'phi-3':             { contextWindow: 131072,  supportsTools: true },
  'command-r':         { contextWindow: 131072,  supportsTools: true },
};
```

Note: `supportsTools` here means "Ollama native tool calling works reliably."
Gemma4 is marked `false` because native tools return empty (Ollama compatibility issue).
The adapter will use prompt-injection for gemma4 instead.

---

## EXECUTION ORDER

1. **Fix gemma4 thinking mode** (Problem 1): Try `think: false` in API call, test with curl, verify non-empty content
2. **Implement MODEL_FAMILY_CONFIGS** (Problem 2): Replace scattered if-statements with config table
3. **Implement three-stage tool resolution waterfall** (Problem 2): Native -> XML -> JSON fallback
4. **Update model registry** (Problem 6): All models with correct context windows and tool support flags
5. **Test basic tier** on all 3 models: qwen3-coder, gemma4:26b, deepseek-coder-v2:16b. All should hit 3/3.
6. **Fix system prompt** (Problem 4): Multi-file workflow, tool-use rules, output rules
7. **Rewrite verify.sh scripts** (Problem 3): All 20 failing tasks, behavioral checks
8. **Add tier-based timeouts + maxTurns** (Problem 5): Scale by difficulty
9. **Full benchmark run** on all 3 models with fixed harness
10. **Version bump to v1.3.0**, push, let CI publish

### Expected Impact

| Fix | Expected Score Improvement |
|---|---|
| Gemma4 thinking fix | +10-15 tasks for gemma4 (basic+intermediate should go 10/10) |
| Three-stage tool waterfall | +2-3 tasks across all models (catches edge cases) |
| Verify script hardening | +5-8 tasks across all models (false negatives eliminated) |
| System prompt improvements | +3-5 tasks (multi-file, architecture categories) |
| Tier-based timeouts | +2-3 tasks (currently timing out at 180s) |
| **Total estimated** | **qwen3-coder: 38-42/50 (Grade A), gemma4: 30-35/50 (Grade B)** |

---

## VALIDATION CHECKLIST

After all fixes, these must pass:

```bash
# 1. Gemma4 basic tier: 3/3
npx tsx evals/run-evals.ts --model gemma4:26b --tier basic

# 2. Gemma4 intermediate tier: 7/7
npx tsx evals/run-evals.ts --model gemma4:26b --tier intermediate

# 3. qwen3-coder full run: score improvement over 103/197
npx tsx evals/run-evals.ts --model qwen3-coder:latest --json

# 4. deepseek-coder-v2 basic: 3/3
npx tsx evals/run-evals.ts --model deepseek-coder-v2:16b --tier basic

# 5. Manual test: model switching works for all 3 models
cmdr  # select each model, say "hi", verify response, /model switch, verify again

# 6. Manual test: context window reported correctly
cmdr -m gemma4:26b  # /context should show 262K, not 8K or 32K
cmdr -m minimax-m2.5:cloud  # /context should show ~1M
```

After validation, publish:
```bash
# CI handles this automatically on push
git add -A && git commit -m "feat: universal model adapter + eval hardening v1.3.0" && git push origin main
```

---

*Time estimate: 2-3 hours of Claude Code time across 2 sessions.
The gemma4 thinking fix and verify script rewrites are the highest-impact items.
Fix those two and both models should score Grade B or above.*