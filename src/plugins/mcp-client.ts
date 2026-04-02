/**
 * MCP Client — connects to external Model Context Protocol servers for tool expansion.
 *
 * MCP servers expose tools over HTTP (SSE or REST).
 * This client registers remote tools as local tool definitions.
 */

import type { McpServerConfig, ToolDefinition, ToolResult, ToolUseContext } from '../core/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import { z } from 'zod'

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface McpConnection {
  config: McpServerConfig
  tools: McpTool[]
  connected: boolean
}

export class McpClient {
  private connections = new Map<string, McpConnection>()

  /** Connect to an MCP server and discover its tools. */
  async connect(config: McpServerConfig): Promise<McpTool[]> {
    const url = config.url.replace(/\/$/, '')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    try {
      const response = await fetch(`${url}/tools`, { headers })
      if (!response.ok) {
        throw new Error(`MCP server returned ${response.status}: ${response.statusText}`)
      }
      const data = await response.json() as { tools?: McpTool[] }
      const tools = data.tools ?? []

      this.connections.set(config.name, {
        config,
        tools,
        connected: true,
      })

      return tools
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to connect to MCP server "${config.name}" at ${config.url}: ${msg}`)
    }
  }

  /** Disconnect from an MCP server. */
  disconnect(name: string): boolean {
    return this.connections.delete(name)
  }

  /** List connected MCP servers. */
  listConnections(): Array<{ name: string; url: string; tools: number; connected: boolean }> {
    return Array.from(this.connections.values()).map(c => ({
      name: c.config.name,
      url: c.config.url,
      tools: c.tools.length,
      connected: c.connected,
    }))
  }

  /** Call a tool on an MCP server. */
  async callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const conn = this.connections.get(serverName)
    if (!conn) throw new Error(`Not connected to MCP server "${serverName}"`)

    const url = conn.config.url.replace(/\/$/, '')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (conn.config.apiKey) {
      headers['Authorization'] = `Bearer ${conn.config.apiKey}`
    }

    try {
      const response = await fetch(`${url}/tools/${toolName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      })

      if (!response.ok) {
        const text = await response.text()
        return { data: `MCP tool error (${response.status}): ${text}`, isError: true }
      }

      const data = await response.json() as { result?: string; error?: string }
      if (data.error) {
        return { data: data.error, isError: true }
      }
      return { data: data.result ?? JSON.stringify(data) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: `MCP call failed: ${msg}`, isError: true }
    }
  }

  /**
   * Register all tools from connected MCP servers into a ToolRegistry.
   * Tools are prefixed with `mcp_{serverName}_` to avoid collisions.
   */
  registerTools(registry: ToolRegistry): number {
    let count = 0

    for (const [serverName, conn] of this.connections) {
      for (const mcpTool of conn.tools) {
        const toolName = `mcp_${serverName}_${mcpTool.name}`
        const client = this

        const tool: ToolDefinition = {
          name: toolName,
          description: `[MCP:${serverName}] ${mcpTool.description}`,
          inputSchema: z.record(z.unknown()),
          async execute(input: Record<string, unknown>, _context: ToolUseContext): Promise<ToolResult> {
            return client.callTool(serverName, mcpTool.name, input)
          },
        }

        registry.register(tool)
        count++
      }
    }

    return count
  }

  /** Check if any servers are connected. */
  get hasConnections(): boolean {
    return this.connections.size > 0
  }
}
