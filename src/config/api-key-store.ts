/**
 * API key persistence — securely stores provider API keys in the user's
 * shell profile so they survive across terminal sessions.
 *
 * Supports: zsh (~/.zshrc), bash (~/.bashrc, ~/.bash_profile), fish (~/.config/fish/config.fish).
 * On unknown shells, falls back to ~/.profile.
 *
 * Keys are also injected into process.env immediately so the current session
 * picks them up without a restart.
 */

import { readFile, appendFile, writeFile, mkdir } from 'fs/promises'
import { homedir, platform } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'

export type ProviderKeyName = 'qwen' | 'openai' | 'anthropic'

interface ProviderKeyInfo {
  envVar: string
  baseUrlVar?: string
  defaultBaseUrl?: string
}

const PROVIDER_KEY_MAP: Record<ProviderKeyName, ProviderKeyInfo> = {
  qwen: {
    envVar: 'DASHSCOPE_API_KEY',
    baseUrlVar: 'QWEN_BASE_URL',
    defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  openai: {
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    envVar: 'ANTHROPIC_API_KEY',
  },
}

/**
 * Detect the user's login shell and return the appropriate rc file path.
 */
export function getShellProfilePath(): string {
  const home = homedir()

  if (platform() === 'win32') {
    // Windows: use PowerShell profile or fall back to a .env-style file
    const psProfile = join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
    if (existsSync(psProfile)) return psProfile
    // Fall back to cmdr's own env file
    return join(home, '.cmdr', 'env')
  }

  const shell = process.env.SHELL ?? ''

  if (shell.endsWith('/zsh')) return join(home, '.zshrc')
  if (shell.endsWith('/fish')) return join(home, '.config', 'fish', 'config.fish')
  if (shell.endsWith('/bash')) {
    // macOS prefers .bash_profile, Linux prefers .bashrc
    const bashProfile = join(home, '.bash_profile')
    if (platform() === 'darwin' && existsSync(bashProfile)) return bashProfile
    return join(home, '.bashrc')
  }

  // Fallback
  return join(home, '.profile')
}

/**
 * Format an export line for the given shell.
 */
function formatExport(shellPath: string, key: string, value: string): string {
  if (shellPath.endsWith('config.fish')) {
    return `set -gx ${key} "${value}"`
  }
  if (shellPath.endsWith('.ps1')) {
    return `$env:${key} = "${value}"`
  }
  // sh/bash/zsh
  return `export ${key}="${value}"`
}

/**
 * Check if a shell profile already contains an export for the given env var.
 */
async function profileHasKey(profilePath: string, envVar: string): Promise<boolean> {
  try {
    const content = await readFile(profilePath, 'utf-8')
    // Match export KEY=, set -gx KEY, or $env:KEY patterns
    const patterns = [
      new RegExp(`^export\\s+${envVar}=`, 'm'),
      new RegExp(`^set\\s+-gx\\s+${envVar}\\s+`, 'm'),
      new RegExp(`^\\$env:${envVar}\\s*=`, 'm'),
    ]
    return patterns.some(p => p.test(content))
  } catch {
    return false
  }
}

/**
 * Replace an existing key line in the profile, or append if not found.
 */
async function upsertProfileKey(profilePath: string, envVar: string, value: string): Promise<void> {
  const exportLine = formatExport(profilePath, envVar, value)

  let content: string
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch {
    // File doesn't exist — create it
    const dir = profilePath.substring(0, profilePath.lastIndexOf('/'))
    if (dir) await mkdir(dir, { recursive: true })
    await writeFile(profilePath, exportLine + '\n', 'utf-8')
    return
  }

  // Try to replace existing line
  const patterns = [
    new RegExp(`^export\\s+${envVar}=.*$`, 'm'),
    new RegExp(`^set\\s+-gx\\s+${envVar}\\s+.*$`, 'm'),
    new RegExp(`^\\$env:${envVar}\\s*=.*$`, 'm'),
  ]

  for (const pattern of patterns) {
    if (pattern.test(content)) {
      const updated = content.replace(pattern, exportLine)
      await writeFile(profilePath, updated, 'utf-8')
      return
    }
  }

  // Append with a comment marker
  const block = `\n# cmdr — ${envVar}\n${exportLine}\n`
  await appendFile(profilePath, block, 'utf-8')
}

export interface SaveApiKeyResult {
  envVar: string
  profilePath: string
  shellName: string
  replaced: boolean
}

/**
 * Save an API key for the given provider:
 * 1. Sets it in process.env for the current session
 * 2. Persists it in the user's shell profile
 *
 * Returns info about what was written.
 */
export async function saveApiKey(
  provider: ProviderKeyName,
  apiKey: string,
): Promise<SaveApiKeyResult> {
  const info = PROVIDER_KEY_MAP[provider]
  if (!info) throw new Error(`Unknown provider: ${provider}`)

  const profilePath = getShellProfilePath()
  const replaced = await profileHasKey(profilePath, info.envVar)

  // Set in current process immediately
  process.env[info.envVar] = apiKey

  // Also set the cmdr-prefixed variant
  process.env[`CMDR_${provider.toUpperCase()}_API_KEY`] = apiKey

  // Write base URL default if applicable
  if (info.baseUrlVar && info.defaultBaseUrl) {
    process.env[info.baseUrlVar] = process.env[info.baseUrlVar] ?? info.defaultBaseUrl
  }

  // Persist to shell profile
  await upsertProfileKey(profilePath, info.envVar, apiKey)

  // If provider has a default base URL, persist that too (unless already set)
  if (info.baseUrlVar && info.defaultBaseUrl) {
    const hasBaseUrl = await profileHasKey(profilePath, info.baseUrlVar)
    if (!hasBaseUrl) {
      await upsertProfileKey(profilePath, info.baseUrlVar, info.defaultBaseUrl)
    }
  }

  const shellName = profilePath.includes('.zshrc') ? 'zsh'
    : profilePath.includes('.bashrc') || profilePath.includes('.bash_profile') ? 'bash'
    : profilePath.includes('config.fish') ? 'fish'
    : profilePath.includes('.ps1') ? 'powershell'
    : 'shell'

  return { envVar: info.envVar, profilePath, shellName, replaced }
}

/**
 * Get the list of supported provider names for the /apikey command.
 */
export function listApiKeyProviders(): ProviderKeyName[] {
  return Object.keys(PROVIDER_KEY_MAP) as ProviderKeyName[]
}

/**
 * Get the env var name for a provider.
 */
export function getProviderEnvVar(provider: ProviderKeyName): string {
  return PROVIDER_KEY_MAP[provider]?.envVar ?? ''
}

/**
 * Check if a provider already has a key configured (in env or profile).
 */
export function hasApiKey(provider: ProviderKeyName): boolean {
  const info = PROVIDER_KEY_MAP[provider]
  if (!info) return false
  return !!process.env[info.envVar]
    || !!process.env[`CMDR_${provider.toUpperCase()}_API_KEY`]
}
