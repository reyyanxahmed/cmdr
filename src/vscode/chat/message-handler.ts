import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { StreamClient } from './stream-client'
import { ContextCollector } from '../context-collector'
import type { ServerManager } from '../server-manager'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools?: { name: string; status: string; duration?: number }[]
  context?: { file?: string; selection?: string }
}

export class MessageHandler {
  private streamClient = new StreamClient()
  private contextCollector = new ContextCollector()
  private history: ChatMessage[] = []

  constructor(
    private serverManager: ServerManager,
    private context: vscode.ExtensionContext,
  ) {
    // Load persisted history
    this.history = this.context.globalState.get<ChatMessage[]>('cmdr.chatHistory', [])
  }

  async handleWebviewMessage(msg: any, webview: vscode.Webview): Promise<void> {
    switch (msg.type) {
      case 'send':
        await this.handleSend(msg.text, webview)
        break

      case 'stop':
        this.streamClient.stop()
        break

      case 'getContext': {
        const ctx = this.contextCollector.collect()
        webview.postMessage({
          type: 'context',
          file: ctx.filePath,
          selection: ctx.selectedText,
          language: ctx.language,
          diagnostics: ctx.diagnostics?.map((d) => `${d.severity} at line ${d.line}: ${d.message}`),
        })
        break
      }

      case 'getModels':
        await this.handleGetModels(webview)
        break

      case 'setModel': {
        const config = vscode.workspace.getConfiguration('cmdr')
        await config.update('model', msg.model, vscode.ConfigurationTarget.Global)
        break
      }

      case 'setEffort': {
        const config = vscode.workspace.getConfiguration('cmdr')
        await config.update('effort', msg.effort, vscode.ConfigurationTarget.Global)
        webview.postMessage({ type: 'effort', level: msg.effort })
        break
      }

      case 'applyDiff':
        await this.handleApplyDiff(msg.filePath, msg.code, webview)
        break

      case 'insertCode':
        await this.handleInsertCode(msg.code)
        break

      case 'copyCode':
        await vscode.env.clipboard.writeText(msg.code)
        webview.postMessage({ type: 'notification', text: 'Copied to clipboard', level: 'info' })
        break

      case 'openFile':
        await this.handleOpenFile(msg.filePath, msg.line)
        break

      case 'getHistory':
        webview.postMessage({ type: 'history', messages: this.history })
        break

      case 'clearHistory':
        this.history = []
        await this.context.globalState.update('cmdr.chatHistory', [])
        webview.postMessage({ type: 'history', messages: [] })
        break

      case 'exportChat':
        await this.handleExport(msg.format)
        break
    }
  }

  private async handleSend(text: string, webview: vscode.Webview): Promise<void> {
    if (!this.serverManager.isHealthy()) {
      webview.postMessage({
        type: 'notification',
        text: 'cmdr server is not running. Starting...',
        level: 'warning',
      })
      await this.serverManager.start()
      await new Promise((resolve) => setTimeout(resolve, 3000))
      if (!this.serverManager.isHealthy()) {
        webview.postMessage({
          type: 'streamError',
          id: '',
          error: 'Could not connect to cmdr server.',
        })
        return
      }
    }

    const ctx = this.contextCollector.collect()
    const contextPrompt = this.contextCollector.buildContextPrompt(ctx)
    const fullPrompt = contextPrompt + text

    const config = vscode.workspace.getConfiguration('cmdr')
    const model = config.get<string>('model', 'qwen3-coder')
    const effort = config.get<string>('effort', 'medium')

    const msgId = generateId()

    // Save user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      context: { file: ctx.filePath, selection: ctx.selectedText },
    }
    this.history.push(userMsg)

    // Start streaming
    webview.postMessage({ type: 'streamStart', id: msgId })

    let assistantContent = ''
    const tools: ChatMessage['tools'] = []

    try {
      await this.streamClient.stream(
        this.serverManager.getBaseUrl(),
        fullPrompt,
        { model, effort },
        (event) => {
          switch (event.type) {
            case 'text':
              assistantContent += event.text || ''
              webview.postMessage({ type: 'streamText', id: msgId, text: event.text })
              break
            case 'tool_start':
              tools.push({ name: event.tool || 'unknown', status: 'start' })
              webview.postMessage({
                type: 'streamTool',
                id: msgId,
                tool: event.tool,
                status: 'start',
                input: event.input,
              })
              break
            case 'tool_done': {
              const t = tools.find((t) => t.name === event.tool && t.status === 'start')
              if (t) {
                t.status = 'done'
                t.duration = event.duration
              }
              webview.postMessage({
                type: 'streamTool',
                id: msgId,
                tool: event.tool,
                status: 'done',
                output: event.output,
                duration: event.duration,
              })
              break
            }
            case 'tool_error':
              webview.postMessage({
                type: 'streamTool',
                id: msgId,
                tool: event.tool,
                status: 'error',
              })
              break
            case 'done':
              webview.postMessage({
                type: 'streamEnd',
                id: msgId,
                tokens: event.tokens,
              })
              break
            case 'error':
              webview.postMessage({
                type: 'streamError',
                id: msgId,
                error: event.error,
              })
              break
          }
        },
      )
    } catch (err) {
      webview.postMessage({
        type: 'streamError',
        id: msgId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Save assistant message
    const assistantMsg: ChatMessage = {
      id: msgId,
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
      tools: tools.length > 0 ? tools : undefined,
    }
    this.history.push(assistantMsg)
    await this.context.globalState.update('cmdr.chatHistory', this.history.slice(-100))
  }

  private async handleGetModels(webview: vscode.Webview): Promise<void> {
    const config = vscode.workspace.getConfiguration('cmdr')
    const ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434')
    const currentModel = config.get<string>('model', 'qwen3-coder')

    try {
      const response = await fetch(`${ollamaUrl}/api/tags`)
      if (response.ok) {
        const data = (await response.json()) as { models: { name: string }[] }
        const models = data.models?.map((m) => m.name) ?? []
        webview.postMessage({ type: 'models', models, current: currentModel })
      }
    } catch {
      webview.postMessage({ type: 'models', models: [currentModel], current: currentModel })
    }
  }

  private async handleApplyDiff(filePath: string, code: string, webview: vscode.Webview): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!workspaceRoot) throw new Error('No workspace folder')

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath)

      const uri = vscode.Uri.file(fullPath)
      const encoder = new TextEncoder()
      await vscode.workspace.fs.writeFile(uri, encoder.encode(code))
      await vscode.window.showTextDocument(uri)
      webview.postMessage({ type: 'diffApplied', filePath, success: true })
    } catch (err) {
      webview.postMessage({ type: 'diffApplied', filePath, success: false })
      vscode.window.showErrorMessage(`Failed to apply: ${err instanceof Error ? err.message : err}`)
    }
  }

  private async handleInsertCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('No active editor to insert into.')
      return
    }
    await editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, code)
    })
  }

  private async handleOpenFile(filePath: string, line?: number): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return

    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath)

    const uri = vscode.Uri.file(fullPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc)

    if (line !== undefined) {
      const position = new vscode.Position(Math.max(0, line - 1), 0)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
    }
  }

  private async handleExport(format: 'markdown' | 'json'): Promise<void> {
    let content: string
    if (format === 'json') {
      content = JSON.stringify(this.history, null, 2)
    } else {
      content = this.history
        .map((m) => `## ${m.role === 'user' ? 'You' : 'cmdr'}\n\n${m.content}`)
        .join('\n\n---\n\n')
    }

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: format === 'json' ? 'json' : 'markdown',
    })
    await vscode.window.showTextDocument(doc)
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
