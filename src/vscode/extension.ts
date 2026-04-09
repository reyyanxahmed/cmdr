/**
 * cmdr VS Code Extension — Entry Point.
 *
 * Activates on startup:
 * 1. Starts cmdr serve as child process
 * 2. Registers chat participant (@cmdr)
 * 3. Registers inline completion provider
 * 4. Registers code actions
 * 5. Registers status bar
 * 6. Registers commands
 */

import * as vscode from 'vscode'
import { ServerManager } from './server-manager.js'
import { ChatProvider } from './chat-provider.js'
import { InlineProvider } from './inline-provider.js'
import { CodeActionProvider } from './code-action.js'
import { StatusBar } from './status-bar.js'
import { registerCommands } from './commands.js'

let serverManager: ServerManager | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cmdr')
  const autoStart = config.get<boolean>('autoStart', true)

  // Server manager
  serverManager = new ServerManager(context)
  if (autoStart) {
    await serverManager.start()
  }

  // Chat provider (@cmdr participant)
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
