/**
 * cmdr VS Code Extension — Entry Point.
 *
 * Activates on startup:
 * 1. Starts cmdr serve as child process
 * 2. Registers custom webview chat panel (sidebar)
 * 3. Registers chat participant (@cmdr)
 * 4. Registers inline completion provider
 * 5. Registers code actions
 * 6. Registers status bar
 * 7. Registers commands
 */

import * as vscode from 'vscode'
import { ServerManager } from './server-manager.js'
import { ChatProvider } from './chat-provider.js'
import { InlineProvider } from './inline-provider.js'
import { CodeActionProvider } from './code-action.js'
import { StatusBar } from './status-bar.js'
import { registerCommands } from './commands.js'
import { ChatPanelManager } from './chat/panel-manager.js'
import { MessageHandler } from './chat/message-handler.js'

let serverManager: ServerManager | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cmdr')
  const autoStart = config.get<boolean>('autoStart', true)

  // Server manager
  serverManager = new ServerManager(context)
  if (autoStart) {
    await serverManager.start()
  }

  // Custom webview chat panel (sidebar)
  const messageHandler = new MessageHandler(serverManager, context)
  const chatPanelManager = new ChatPanelManager(context.extensionUri, messageHandler)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelManager.viewType, chatPanelManager),
  )

  // Chat provider (@cmdr participant — built-in chat API)
  const chatProvider = new ChatProvider(serverManager, context)
  context.subscriptions.push(chatProvider.register())

  // Inline completion provider
  const inlineProvider = new InlineProvider()
  context.subscriptions.push(inlineProvider.register())

  // Code action provider
  const codeActionProvider = new CodeActionProvider(serverManager)
  context.subscriptions.push(codeActionProvider.register())

  // Status bar
  const statusBar = new StatusBar(serverManager, inlineProvider)
  const statusBarDisposables = statusBar.register()
  context.subscriptions.push(...statusBarDisposables)

  // Commands
  registerCommands(context, serverManager)

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cmdr')) {
        serverManager?.reloadConfig()
        inlineProvider.reloadConfig()
        statusBar.update()
      }
    }),
  )

  vscode.window.showInformationMessage('cmdr extension activated')
}

export async function deactivate(): Promise<void> {
  if (serverManager) {
    await serverManager.stop()
    serverManager = undefined
  }
}
