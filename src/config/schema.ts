/**
 * Configuration schema — Zod validation for cmdr config.
 */

import { z } from 'zod'

export const McpServerSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  apiKey: z.string().optional(),
})

export const CmdrConfigSchema = z.object({
  ollamaUrl: z.string().url().default('http://localhost:11434'),
  defaultModel: z.string().default('qwen2.5-coder:14b'),
  defaultProvider: z.enum(['ollama', 'openai', 'anthropic']).default('ollama'),
  maxConcurrency: z.number().int().min(1).max(16).default(2),
  maxTurns: z.number().int().min(1).max(500).default(30),
  contextBudget: z.number().int().min(1024).default(32768),
  autoCompact: z.boolean().default(true),
  permissions: z.object({
    allowBash: z.boolean().default(true),
    allowFileWrite: z.boolean().default(true),
    allowNetwork: z.boolean().default(false),
    sandboxDir: z.string().optional(),
  }).default({}),
  mcp: z.object({
    servers: z.array(McpServerSchema).default([]),
  }).default({}),
  plugins: z.array(z.string()).default([]),
  // Spinner customization
  spinner: z.object({
    verbs: z.array(z.string()).optional(),
    mode: z.enum(['append', 'replace']).default('append'),
  }).optional(),
  // Telemetry opt-in
  telemetry: z.boolean().default(false),
}).partial()

export type CmdrConfigInput = z.input<typeof CmdrConfigSchema>
export type CmdrConfigParsed = z.output<typeof CmdrConfigSchema>
