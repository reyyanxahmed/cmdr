# CMDR VS Code Extension: Full Chat Panel + Marketplace Release

> **For**: OpenAI Codex / Claude Code
> **Repo**: ~/Documents/GitHub/cmdr
> **Extension path**: src/vscode/
> **Current state**: v3.0.0 has basic extension scaffold (chat participant, inline completions, code actions, status bar). The chat participant uses VS Code's built-in Chat API which is limited.
> **Goal**: Build a FULL custom chat panel (webview sidebar) like GitHub Copilot Chat and Claude for VS Code, with rich UI, streaming, context awareness, diff previews, and slash commands. Package and publish to VS Code Marketplace.

---

## WHY A CUSTOM WEBVIEW PANEL

The current implementation uses VS Code's Chat API (`vscode.ChatRequestHandler`). This is limited:
- No control over the UI (VS Code renders it)
- No custom components (diff views, file trees, tool status indicators)
- No persistent chat history across sessions
- No rich interactive elements (buttons, dropdowns, approval flows)

GitHub Copilot and Claude for VS Code both use custom webview panels for their chat experience. We need the same. The webview communicates with the extension host via `postMessage`, which then talks to `cmdr serve` via HTTP/SSE.

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────┐
│                    VS Code                           │
│                                                      │
│  ┌──────────────┐     ┌───────────────────────────┐ │
│  │  Extension    │◄───►│  Webview (Chat Panel)     │ │
│  │  Host         │     │                           │ │
│  │              │     │  React + Tailwind CSS     │ │
│  │  - server    │     │  - Message bubbles        │ │
│  │    manager   │     │  - Code blocks            │ │
│  │  - context   │     │  - Diff previews          │ │
│  │    collector │     │  - Tool status cards      │ │
│  │  - inline    │     │  - Streaming text         │ │
│  │    completions│     │  - Slash command palette  │ │
│  │              │     │  - File mention picker    │ │
│  └──────┬───────┘     └───────────────────────────┘ │
│         │                                            │
└─────────┼────────────────────────────────────────────┘
          │ HTTP/SSE
          ▼
   ┌──────────────┐
   │  cmdr serve   │
   │  localhost:4200│
   │              │
   │  - Agent loop │
   │  - 33 tools   │
   │  - Memory     │
   │  - RAG        │
   └──────────────┘
```

---

## FILE STRUCTURE

```
src/vscode/
├── extension.ts              # Activation, register providers, start server
├── server-manager.ts         # Spawn/kill cmdr serve child process
├── inline-provider.ts        # Inline completions (FIM via Ollama) [EXISTS]
├── code-action.ts            # Quick fixes [EXISTS]
├── status-bar.ts             # Status bar item [EXISTS]
├── commands.ts               # Command palette entries
├── context-collector.ts      # Gather workspace context for prompts [NEW]
├── chat/
│   ├── panel-manager.ts      # Create/show/dispose webview panel [NEW]
│   ├── message-handler.ts    # Extension<->Webview message protocol [NEW]
│   └── stream-client.ts      # SSE client for cmdr serve [NEW]
├── webview/
│   ├── index.html            # Webview entry point [NEW]
│   ├── app.tsx               # React root component [NEW]
│   ├── components/
│   │   ├── ChatPanel.tsx     # Main chat container [NEW]
│   │   ├── MessageBubble.tsx # User/assistant message rendering [NEW]
│   │   ├── CodeBlock.tsx     # Syntax-highlighted code with actions [NEW]
│   │   ├── DiffView.tsx      # Inline diff preview with apply button [NEW]
│   │   ├── ToolCard.tsx      # Tool execution status card [NEW]
│   │   ├── InputArea.tsx     # Chat input with slash commands [NEW]
│   │   ├── SlashMenu.tsx     # Autocomplete menu for /commands [NEW]
│   │   ├── FilePicker.tsx    # @file mention autocomplete [NEW]
│   │   ├── ModelSelector.tsx # Model switching dropdown [NEW]
│   │   ├── EffortBadge.tsx   # Effort level indicator [NEW]
│   │   ├── WelcomeScreen.tsx # First-run welcome with setup guide [NEW]
│   │   └── Skeleton.tsx      # Loading skeleton animations [NEW]
│   ├── hooks/
│   │   ├── useMessages.ts    # Message state management [NEW]
│   │   ├── useStream.ts      # SSE streaming hook [NEW]
│   │   └── useVSCode.ts      # VS Code API bridge hook [NEW]
│   ├── utils/
│   │   ├── markdown.ts       # Markdown to React rendering [NEW]
│   │   ├── syntax.ts         # Syntax highlighting (Shiki) [NEW]
│   │   └── diff.ts           # Diff computation and formatting [NEW]
│   └── styles/
│       └── chat.css          # Styles using VS Code CSS variables [NEW]
├── package.json              # Extension manifest [UPDATE]
├── tsconfig.json             # Extension TS config [EXISTS]
├── webpack.config.js         # Bundle webview separately [NEW]
└── README.md                 # Marketplace README [NEW]
```

---

## PART 1: EXTENSION HOST (TypeScript, runs in Node.js)

### 1.1 Panel Manager

```typescript
// src/vscode/chat/panel-manager.ts

import * as vscode from 'vscode';

export class ChatPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private extensionUri: vscode.Uri,
    private messageHandler: MessageHandler,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'cmdr.chat',
      'cmdr Chat',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,  // Keep state when panel is hidden
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        ],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'icon.svg');

    // Load the webview HTML
    this.panel.webview.html = this.getHtml(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.messageHandler.handleWebviewMessage(msg, this.panel!.webview),
      null,
      this.disposables,
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach(d => d.dispose());
      this.disposables = [];
    });
  }

  // Send a message to the webview
  postMessage(message: any): void {
    this.panel?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'app.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} data:;
  ">
  <link href="${styleUri}" rel="stylesheet">
  <title>cmdr Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  return nonce;
}
```

### 1.2 Message Handler (Extension <-> Webview Protocol)

```typescript
// src/vscode/chat/message-handler.ts

// Messages FROM webview TO extension host
type WebviewMessage =
  | { type: 'send'; text: string; context?: ContextPayload }
  | { type: 'stop' }                    // Cancel current stream
  | { type: 'slash'; command: string; args: string }
  | { type: 'getContext' }              // Request current file/selection context
  | { type: 'getModels' }              // Request available models
  | { type: 'setModel'; model: string }
  | { type: 'setEffort'; effort: string }
  | { type: 'applyDiff'; filePath: string; diff: string }
  | { type: 'insertCode'; code: string }
  | { type: 'copyCode'; code: string }
  | { type: 'openFile'; filePath: string; line?: number }
  | { type: 'getHistory' }             // Load persisted chat history
  | { type: 'clearHistory' }
  | { type: 'exportChat'; format: 'markdown' | 'json' }

// Messages FROM extension host TO webview
type ExtensionMessage =
  | { type: 'streamStart'; id: string }
  | { type: 'streamText'; id: string; text: string }
  | { type: 'streamTool'; id: string; tool: string; status: 'start' | 'done' | 'error'; input?: any; output?: string; duration?: number }
  | { type: 'streamEnd'; id: string; tokens?: { input: number; output: number }; duration?: number }
  | { type: 'streamError'; id: string; error: string }
  | { type: 'context'; file?: string; selection?: string; language?: string; diagnostics?: string[] }
  | { type: 'models'; models: string[]; current: string }
  | { type: 'effort'; level: string }
  | { type: 'history'; messages: ChatMessage[] }
  | { type: 'diffApplied'; filePath: string; success: boolean }
  | { type: 'notification'; text: string; level: 'info' | 'warning' | 'error' }

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tools?: { name: string; status: string; duration?: number }[];
  context?: { file?: string; selection?: string };
}
```

The MessageHandler class:
- On `send`: collect context from ContextCollector, POST to cmdr serve /v1/stream, parse SSE events, forward each event to webview as `streamText`/`streamTool`/`streamEnd`
- On `stop`: abort the current fetch request
- On `applyDiff`: use VS Code workspace.applyEdit to apply the diff to the file
- On `insertCode`: insert at cursor position in active editor
- On `getModels`: fetch from cmdr serve /v1/models or from Ollama /api/tags directly
- On `getHistory`/`clearHistory`: read/write from extension global state

### 1.3 Context Collector

```typescript
// src/vscode/context-collector.ts

export class ContextCollector {
  // Gather relevant context for the current prompt
  collect(): ContextPayload {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return {};

    const document = editor.document;
    const selection = editor.selection;

    return {
      // Active file
      filePath: vscode.workspace.asRelativePath(document.uri),
      fileName: path.basename(document.fileName),
      language: document.languageId,
      fileContent: document.getText(),

      // Selection (if any)
      selectedText: selection.isEmpty ? undefined : document.getText(selection),
      selectionRange: selection.isEmpty ? undefined : {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
      },

      // Diagnostics (errors/warnings) in the active file
      diagnostics: vscode.languages.getDiagnostics(document.uri)
        .filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
        .map(d => ({
          message: d.message,
          severity: d.severity === 0 ? 'error' : 'warning',
          line: d.range.start.line + 1,
          source: d.source,
        })),

      // Workspace info
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      openFiles: vscode.window.visibleTextEditors
        .map(e => vscode.workspace.asRelativePath(e.document.uri)),

      // Git info (if available)
      gitBranch: await getGitBranch(),
    };
  }

  // Build a context string to prepend to the user's prompt
  buildContextPrompt(ctx: ContextPayload): string {
    const parts: string[] = [];

    if (ctx.filePath) {
      parts.push(`Active file: ${ctx.filePath} (${ctx.language})`);
    }

    if (ctx.selectedText) {
      parts.push(`Selected code (${ctx.filePath}:${ctx.selectionRange?.start.line}-${ctx.selectionRange?.end.line}):\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``);
    } else if (ctx.fileContent && ctx.fileContent.length < 10000) {
      parts.push(`File content:\n\`\`\`${ctx.language}\n${ctx.fileContent}\n\`\`\``);
    }

    if (ctx.diagnostics?.length) {
      parts.push(`Current errors/warnings:\n${ctx.diagnostics.map(d => `- ${d.severity} at line ${d.line}: ${d.message}`).join('\n')}`);
    }

    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
  }
}
```

### 1.4 Stream Client

```typescript
// src/vscode/chat/stream-client.ts

export class StreamClient {
  private controller: AbortController | null = null;

  async stream(
    prompt: string,
    options: { model?: string; effort?: string; images?: string[] },
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    this.controller = new AbortController();

    const response = await fetch(`http://localhost:${port}/v1/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options }),
      signal: this.controller.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { onEvent({ type: 'done' }); return; }
        try {
          const event = JSON.parse(data);
          onEvent(event);
        } catch {}
      }
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
```

---

## PART 2: WEBVIEW (React, runs in browser context inside VS Code)

### 2.1 Main Chat Panel Component

```tsx
// src/vscode/webview/components/ChatPanel.tsx

const ChatPanel: React.FC = () => {
  const { messages, addMessage, updateMessage, clearMessages } = useMessages();
  const { stream, stop, isStreaming } = useStream();
  const vscode = useVSCode();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState('qwen3-coder');
  const [effort, setEffort] = useState('medium');

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string) => {
    // Add user message
    const userMsg = addMessage({ role: 'user', content: text });

    // Request context from extension
    vscode.postMessage({ type: 'getContext' });

    // Start streaming
    const assistantMsg = addMessage({ role: 'assistant', content: '', tools: [] });
    vscode.postMessage({ type: 'send', text, context: currentContext });
  };

  // Listen for extension messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'streamText':
          updateMessage(msg.id, prev => ({ ...prev, content: prev.content + msg.text }));
          break;
        case 'streamTool':
          updateMessage(msg.id, prev => ({
            ...prev,
            tools: [...(prev.tools || []), { name: msg.tool, status: msg.status, duration: msg.duration }],
          }));
          break;
        case 'streamEnd':
          // Mark message as complete
          break;
        case 'streamError':
          updateMessage(msg.id, prev => ({ ...prev, content: prev.content + `\n\nError: ${msg.error}` }));
          break;
        case 'models':
          setModel(msg.current);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="chat-panel">
      {/* Header bar */}
      <div className="chat-header">
        <ModelSelector model={model} onChange={m => { setModel(m); vscode.postMessage({ type: 'setModel', model: m }); }} />
        <EffortBadge effort={effort} onChange={e => { setEffort(e); vscode.postMessage({ type: 'setEffort', effort: e }); }} />
      </div>

      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 && <WelcomeScreen />}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onApplyDiff={(file, diff) => vscode.postMessage({ type: 'applyDiff', filePath: file, diff })}
            onInsertCode={(code) => vscode.postMessage({ type: 'insertCode', code })}
            onCopyCode={(code) => vscode.postMessage({ type: 'copyCode', code })}
            onOpenFile={(file, line) => vscode.postMessage({ type: 'openFile', filePath: file, line })}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <InputArea
        onSend={handleSend}
        onStop={() => vscode.postMessage({ type: 'stop' })}
        isStreaming={isStreaming}
      />
    </div>
  );
};
```

### 2.2 Message Bubble

```tsx
// src/vscode/webview/components/MessageBubble.tsx

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onApplyDiff, onInsertCode, onCopyCode, onOpenFile }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
      {/* Avatar */}
      <div className="message-avatar">
        {isUser ? '👤' : '⌘'}
      </div>

      {/* Content */}
      <div className="message-content">
        {/* Render markdown with special handling for code blocks */}
        <MarkdownRenderer
          content={message.content}
          onApplyDiff={onApplyDiff}
          onInsertCode={onInsertCode}
          onCopyCode={onCopyCode}
          onOpenFile={onOpenFile}
        />

        {/* Tool execution cards */}
        {message.tools?.map((tool, i) => (
          <ToolCard key={i} tool={tool} />
        ))}

        {/* Timestamp */}
        <div className="message-timestamp">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};
```

### 2.3 Code Block with Actions

```tsx
// src/vscode/webview/components/CodeBlock.tsx

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, filePath, onApply, onInsert, onCopy }) => {
  const [copied, setCopied] = useState(false);
  const highlighted = useSyntaxHighlight(code, language);

  return (
    <div className="code-block">
      {/* Header with language and file path */}
      <div className="code-block-header">
        <span className="code-block-language">{language}</span>
        {filePath && (
          <span className="code-block-file" onClick={() => onOpenFile(filePath)}>
            {filePath}
          </span>
        )}
        <div className="code-block-actions">
          <button onClick={() => { onCopy(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={() => onInsert(code)}>Insert at Cursor</button>
          {filePath && <button onClick={() => onApply(filePath, code)}>Apply to File</button>}
        </div>
      </div>

      {/* Highlighted code */}
      <pre className="code-block-content">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
};
```

### 2.4 Diff View

```tsx
// src/vscode/webview/components/DiffView.tsx

const DiffView: React.FC<DiffViewProps> = ({ filePath, original, modified, onApply, onReject }) => {
  const diffLines = computeDiff(original, modified);

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-file">{filePath}</span>
        <div className="diff-actions">
          <button className="diff-accept" onClick={() => onApply(filePath, modified)}>
            ✓ Accept Changes
          </button>
          <button className="diff-reject" onClick={onReject}>
            ✗ Reject
          </button>
        </div>
      </div>

      <div className="diff-content">
        {diffLines.map((line, i) => (
          <div key={i} className={`diff-line diff-${line.type}`}>
            <span className="diff-gutter">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
            <span className="diff-text">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 2.5 Tool Status Card

```tsx
// src/vscode/webview/components/ToolCard.tsx

const ToolCard: React.FC<{ tool: ToolExecution }> = ({ tool }) => {
  const icon = {
    start: '⟳',
    done: '✓',
    error: '✗',
  }[tool.status];

  const color = {
    start: 'var(--vscode-charts-yellow)',
    done: 'var(--vscode-charts-green)',
    error: 'var(--vscode-charts-red)',
  }[tool.status];

  return (
    <div className="tool-card" style={{ borderLeftColor: color }}>
      <span className="tool-icon">{icon}</span>
      <span className="tool-name">{tool.name}</span>
      {tool.duration && <span className="tool-duration">{tool.duration}ms</span>}
      {tool.output && (
        <details className="tool-output">
          <summary>Output</summary>
          <pre>{tool.output}</pre>
        </details>
      )}
    </div>
  );
};
```

### 2.6 Input Area with Slash Commands

```tsx
// src/vscode/webview/components/InputArea.tsx

const InputArea: React.FC<InputAreaProps> = ({ onSend, onStop, isStreaming }) => {
  const [text, setText] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const SLASH_COMMANDS = [
    { name: '/explain', description: 'Explain the selected code' },
    { name: '/fix', description: 'Fix errors in the current file' },
    { name: '/test', description: 'Generate tests for the selected code' },
    { name: '/review', description: 'Review recent code changes' },
    { name: '/refactor', description: 'Refactor the selected code' },
    { name: '/docs', description: 'Generate documentation' },
    { name: '/optimize', description: 'Optimize for performance' },
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !isStreaming) {
        onSend(text.trim());
        setText('');
        setShowSlashMenu(false);
      }
    }

    // Show slash menu on /
    if (e.key === '/' && text === '') {
      setShowSlashMenu(true);
    }

    // Show file picker on @
    if (e.key === '@') {
      setShowFilePicker(true);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Toggle slash menu visibility
    if (val.startsWith('/')) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  };

  return (
    <div className="input-area">
      {/* Slash command autocomplete */}
      {showSlashMenu && (
        <SlashMenu
          commands={SLASH_COMMANDS}
          filter={text.slice(1)}
          onSelect={(cmd) => { setText(cmd.name + ' '); setShowSlashMenu(false); textareaRef.current?.focus(); }}
        />
      )}

      {/* File picker */}
      {showFilePicker && (
        <FilePicker
          onSelect={(file) => { setText(text + file + ' '); setShowFilePicker(false); }}
          onClose={() => setShowFilePicker(false)}
        />
      )}

      {/* Input */}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'cmdr is thinking...' : 'Ask cmdr anything... (/ for commands, @ for files)'}
          disabled={isStreaming}
          rows={1}
        />

        {isStreaming ? (
          <button className="stop-button" onClick={onStop} title="Stop generation">
            ■
          </button>
        ) : (
          <button
            className="send-button"
            onClick={() => { if (text.trim()) { onSend(text.trim()); setText(''); } }}
            disabled={!text.trim()}
            title="Send message (Enter)"
          >
            ↑
          </button>
        )}
      </div>

      <div className="input-hints">
        <span>Enter to send</span>
        <span>Shift+Enter for newline</span>
        <span>/ for commands</span>
        <span>@ to mention files</span>
      </div>
    </div>
  );
};
```

### 2.7 Welcome Screen

```tsx
// src/vscode/webview/components/WelcomeScreen.tsx

const WelcomeScreen: React.FC = () => (
  <div className="welcome-screen">
    <div className="welcome-logo">⌘ cmdr</div>
    <div className="welcome-tagline">Local AI coding assistant</div>
    <div className="welcome-subtitle">Your models, your machine, your data.</div>

    <div className="welcome-suggestions">
      <button onClick={() => sendPrompt('/explain')}>
        💡 Explain this code
      </button>
      <button onClick={() => sendPrompt('/fix')}>
        🔧 Fix errors
      </button>
      <button onClick={() => sendPrompt('/test')}>
        🧪 Write tests
      </button>
      <button onClick={() => sendPrompt('/review')}>
        📝 Review changes
      </button>
    </div>

    <div className="welcome-tip">
      Tip: Select code in the editor before asking for context-aware help.
    </div>
  </div>
);
```

---

## PART 3: STYLES (CSS using VS Code variables)

```css
/* src/vscode/webview/styles/chat.css */

/* Use VS Code's native CSS variables for theme integration */
:root {
  --chat-bg: var(--vscode-editor-background);
  --chat-fg: var(--vscode-editor-foreground);
  --chat-border: var(--vscode-panel-border);
  --chat-input-bg: var(--vscode-input-background);
  --chat-input-border: var(--vscode-input-border);
  --chat-user-bg: var(--vscode-textBlockQuote-background);
  --chat-assistant-bg: transparent;
  --chat-code-bg: var(--vscode-textCodeBlock-background);
  --chat-accent: var(--vscode-focusBorder);
  --chat-muted: var(--vscode-descriptionForeground);
  --chat-success: var(--vscode-charts-green, #89d185);
  --chat-error: var(--vscode-errorForeground, #f14c4c);
  --chat-warning: var(--vscode-charts-yellow, #cca700);
}

/* The styles MUST use VS Code CSS variables so they automatically
   adapt to any VS Code theme (dark, light, high contrast).
   NEVER hardcode colors. */

.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--chat-bg);
  color: var(--chat-fg);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

/* Header */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--chat-border);
  gap: 8px;
}

/* Messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message-bubble {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  animation: fadeIn 0.2s ease-in;
}

.message-bubble.user .message-content {
  background: var(--chat-user-bg);
  border-radius: 8px;
  padding: 12px 16px;
}

.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

/* Code blocks */
.code-block {
  border: 1px solid var(--chat-border);
  border-radius: 6px;
  margin: 8px 0;
  overflow: hidden;
}

.code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: var(--vscode-titleBar-activeBackground);
  font-size: 12px;
  color: var(--chat-muted);
}

.code-block-actions button {
  background: none;
  border: 1px solid var(--chat-border);
  color: var(--chat-fg);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  margin-left: 4px;
}

.code-block-actions button:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.code-block-content {
  padding: 12px;
  margin: 0;
  overflow-x: auto;
  background: var(--chat-code-bg);
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  line-height: 1.5;
}

/* Diff view */
.diff-view {
  border: 1px solid var(--chat-border);
  border-radius: 6px;
  margin: 8px 0;
  overflow: hidden;
}

.diff-line.diff-add { background: rgba(35, 134, 54, 0.15); }
.diff-line.diff-remove { background: rgba(248, 81, 73, 0.15); }

.diff-accept {
  background: var(--chat-success) !important;
  color: var(--vscode-editor-background) !important;
}

/* Tool cards */
.tool-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-left: 3px solid;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 0 4px 4px 0;
  margin: 4px 0;
  font-size: 12px;
}

/* Input area */
.input-area {
  border-top: 1px solid var(--chat-border);
  padding: 12px 16px;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.input-wrapper textarea {
  flex: 1;
  resize: none;
  background: var(--chat-input-bg);
  color: var(--chat-fg);
  border: 1px solid var(--chat-input-border);
  border-radius: 8px;
  padding: 10px 14px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
  outline: none;
  min-height: 40px;
  max-height: 200px;
}

.input-wrapper textarea:focus {
  border-color: var(--chat-accent);
}

.send-button, .stop-button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.send-button {
  background: var(--chat-accent);
  color: var(--vscode-editor-background);
}

.stop-button {
  background: var(--chat-error);
  color: white;
}

/* Slash command menu */
.slash-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--vscode-quickInput-background);
  border: 1px solid var(--chat-border);
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.2);
}

/* Welcome screen */
.welcome-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 32px;
}

.welcome-logo {
  font-size: 48px;
  font-weight: bold;
  margin-bottom: 8px;
}

.welcome-suggestions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 24px;
  width: 100%;
  max-width: 400px;
}

.welcome-suggestions button {
  padding: 12px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--chat-border);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## PART 4: BUILD SYSTEM

### 4.1 Webpack Config for Webview

```javascript
// src/vscode/webpack.config.js
const path = require('path');

module.exports = [
  // Extension host bundle (Node.js)
  {
    target: 'node',
    entry: './extension.ts',
    output: {
      path: path.resolve(__dirname, '../../dist/vscode'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: { vscode: 'commonjs vscode' },
    resolve: { extensions: ['.ts', '.tsx', '.js'] },
    module: {
      rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
  },
  // Webview bundle (browser)
  {
    target: 'web',
    entry: './webview/app.tsx',
    output: {
      path: path.resolve(__dirname, '../../dist/webview'),
      filename: 'app.js',
    },
    resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
    module: {
      rules: [
        { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ],
    },
  },
];
```

### 4.2 Package Scripts

Add to `src/vscode/package.json`:

```json
{
  "scripts": {
    "build": "webpack --mode production",
    "watch": "webpack --mode development --watch",
    "package": "npx vsce package",
    "publish": "npx vsce publish"
  },
  "devDependencies": {
    "@types/vscode": "^1.90.0",
    "ts-loader": "^9.5.0",
    "webpack": "^5.90.0",
    "webpack-cli": "^5.1.0",
    "style-loader": "^3.3.0",
    "css-loader": "^6.10.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

---

## PART 5: EXTENSION MANIFEST UPDATE

Update `src/vscode/package.json` to register the sidebar view:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "cmdr",
        "title": "cmdr",
        "icon": "assets/icon.svg"
      }]
    },
    "views": {
      "cmdr": [{
        "type": "webview",
        "id": "cmdr.chatView",
        "name": "Chat"
      }]
    },
    "commands": [
      { "command": "cmdr.openChat", "title": "cmdr: Open Chat", "icon": "$(comment-discussion)" },
      { "command": "cmdr.explain", "title": "cmdr: Explain Selection" },
      { "command": "cmdr.fix", "title": "cmdr: Fix Errors" },
      { "command": "cmdr.test", "title": "cmdr: Write Tests" },
      { "command": "cmdr.refactor", "title": "cmdr: Refactor Selection" },
      { "command": "cmdr.review", "title": "cmdr: Review Changes" },
      { "command": "cmdr.switchModel", "title": "cmdr: Switch Model" },
      { "command": "cmdr.toggleInline", "title": "cmdr: Toggle Inline Completions" }
    ],
    "menus": {
      "editor/context": [
        { "command": "cmdr.explain", "group": "cmdr@1", "when": "editorHasSelection" },
        { "command": "cmdr.fix", "group": "cmdr@2" },
        { "command": "cmdr.test", "group": "cmdr@3", "when": "editorHasSelection" },
        { "command": "cmdr.refactor", "group": "cmdr@4", "when": "editorHasSelection" }
      ]
    },
    "keybindings": [
      { "command": "cmdr.openChat", "key": "ctrl+shift+c", "mac": "cmd+shift+c" },
      { "command": "cmdr.explain", "key": "ctrl+shift+e", "mac": "cmd+shift+e", "when": "editorHasSelection" }
    ]
  }
}
```

---

## EXECUTION ORDER

1. Create `context-collector.ts`
2. Create `chat/stream-client.ts`
3. Create `chat/message-handler.ts`
4. Create `chat/panel-manager.ts`
5. Create all webview components (ChatPanel, MessageBubble, CodeBlock, DiffView, ToolCard, InputArea, SlashMenu, FilePicker, ModelSelector, WelcomeScreen)
6. Create `webview/styles/chat.css`
7. Create `webview/hooks/useMessages.ts`, `useStream.ts`, `useVSCode.ts`
8. Create `webview/utils/markdown.ts`, `syntax.ts`, `diff.ts`
9. Create `webview/app.tsx` (React entry point)
10. Create `webview/index.html`
11. Update `extension.ts` to register sidebar webview provider and wire panel manager
12. Create `webpack.config.js`
13. Update `package.json` with sidebar views, context menus, keybindings
14. Build and test locally: `npm run build && code --extensionDevelopmentPath=.`
15. Create extension icon (SVG)
16. Write marketplace README with screenshots
17. Package: `npx vsce package`
18. Publish: `npx vsce publish`

---

## SUCCESS CRITERIA

1. Activity bar icon shows cmdr sidebar
2. Chat panel renders with welcome screen on first open
3. Typing a message streams a response from local Ollama model
4. Code blocks have Copy, Insert, Apply buttons that work
5. Tool executions show as status cards (spinner -> checkmark)
6. /explain with selected code sends selection as context
7. /fix reads diagnostics and generates a fix
8. Diff view shows with Accept/Reject buttons
9. Model selector changes the active model
10. Effort badge shows and changes effort level
11. Chat history persists across panel hide/show
12. Ctrl+Shift+C opens the chat panel
13. Right-click context menu shows cmdr actions
14. Works with both dark and light VS Code themes
15. Stop button cancels in-progress generation

---

## MARKETPLACE LISTING

**Name**: cmdr - Local AI Coding Assistant
**Publisher**: reyyanxahmed
**Category**: AI, Programming Languages
**Tags**: ai, copilot, local, ollama, coding-assistant, privacy

**Short Description**: Local-first alternative to GitHub Copilot. Chat, inline completions, and code actions powered by your local models via Ollama. No API keys. No cloud. Your code stays on your machine.

**Key Features** (for marketplace listing):
- Chat with @cmdr in a dedicated sidebar panel
- Inline code completions from local models
- Fix errors, explain code, write tests, refactor with one click
- Diff previews with Accept/Reject for suggested changes
- Works with 19+ model families via Ollama
- No API keys required, no data leaves your machine
- Full theme integration (works with any VS Code theme)