/**
 * Structured theme system for cmdr.
 *
 * Defines the CmdrTheme interface, 5 built-in themes, and a
 * global active theme that other modules can read.
 */

import chalk, { type ChalkInstance } from 'chalk'

// ---------------------------------------------------------------------------
// Theme interface
// ---------------------------------------------------------------------------

export interface CmdrTheme {
  name: string
  type: 'dark' | 'light' | 'custom'

  text: {
    primary: string       // Main text
    secondary: string     // Dim text for metadata
    accent: string        // Highlighted text, links
    muted: string         // Very dim text
  }

  syntax: {
    keyword: string
    string: string
    number: string
    comment: string
    function: string
    type: string
  }

  status: {
    success: string       // Pass, complete
    error: string         // Fail, error
    warning: string       // Caution
    info: string          // Neutral info / cyan
    thinking: string      // Spinner/thinking state
  }

  tool: {
    name: string          // Tool name color
    executing: string     // While running
    result: string        // Collapsed result
    border: string        // Tool output border
  }

  ui: {
    border: string        // UI borders, separators
    prompt: string        // The prompt character
    banner: string        // ASCII art gradient start
    bannerAccent: string  // ASCII art gradient end
    badge: string         // Permission badges
  }
}

// ---------------------------------------------------------------------------
// Built-in themes
// ---------------------------------------------------------------------------

const cmdrDark: CmdrTheme = {
  name: 'cmdr-dark',
  type: 'dark',
  text: { primary: '#E0E0E0', secondary: '#555555', accent: '#BF40FF', muted: '#444444' },
  syntax: { keyword: '#FF6B9D', string: '#98C379', number: '#D19A66', comment: '#5C6370', function: '#61AFEF', type: '#E5C07B' },
  status: { success: '#00FF41', error: '#FF3333', warning: '#FFD700', info: '#00FFFF', thinking: '#BF40FF' },
  tool: { name: '#00FFFF', executing: '#FFD700', result: '#555555', border: '#333333' },
  ui: { border: '#00BB30', prompt: '#00FF41', banner: '#00FF41', bannerAccent: '#BF40FF', badge: '#FF6B9D' },
}

const cmdrLight: CmdrTheme = {
  name: 'cmdr-light',
  type: 'light',
  text: { primary: '#1A1A2E', secondary: '#666666', accent: '#7B2FBE', muted: '#999999' },
  syntax: { keyword: '#D63384', string: '#198754', number: '#CF6A26', comment: '#6C757D', function: '#0D6EFD', type: '#B98100' },
  status: { success: '#198754', error: '#DC3545', warning: '#FFC107', info: '#0DCAF0', thinking: '#7B2FBE' },
  tool: { name: '#0D6EFD', executing: '#FFC107', result: '#6C757D', border: '#DEE2E6' },
  ui: { border: '#198754', prompt: '#198754', banner: '#198754', bannerAccent: '#7B2FBE', badge: '#D63384' },
}

const monokai: CmdrTheme = {
  name: 'monokai',
  type: 'dark',
  text: { primary: '#F8F8F2', secondary: '#75715E', accent: '#AE81FF', muted: '#49483E' },
  syntax: { keyword: '#F92672', string: '#E6DB74', number: '#AE81FF', comment: '#75715E', function: '#A6E22E', type: '#66D9EF' },
  status: { success: '#A6E22E', error: '#F92672', warning: '#E6DB74', info: '#66D9EF', thinking: '#AE81FF' },
  tool: { name: '#66D9EF', executing: '#E6DB74', result: '#75715E', border: '#49483E' },
  ui: { border: '#49483E', prompt: '#A6E22E', banner: '#A6E22E', bannerAccent: '#AE81FF', badge: '#F92672' },
}

const nord: CmdrTheme = {
  name: 'nord',
  type: 'dark',
  text: { primary: '#ECEFF4', secondary: '#4C566A', accent: '#B48EAD', muted: '#3B4252' },
  syntax: { keyword: '#81A1C1', string: '#A3BE8C', number: '#B48EAD', comment: '#616E88', function: '#88C0D0', type: '#EBCB8B' },
  status: { success: '#A3BE8C', error: '#BF616A', warning: '#EBCB8B', info: '#88C0D0', thinking: '#B48EAD' },
  tool: { name: '#88C0D0', executing: '#EBCB8B', result: '#4C566A', border: '#3B4252' },
  ui: { border: '#3B4252', prompt: '#A3BE8C', banner: '#88C0D0', bannerAccent: '#B48EAD', badge: '#BF616A' },
}

const solarizedDark: CmdrTheme = {
  name: 'solarized-dark',
  type: 'dark',
  text: { primary: '#839496', secondary: '#586E75', accent: '#6C71C4', muted: '#073642' },
  syntax: { keyword: '#859900', string: '#2AA198', number: '#D33682', comment: '#586E75', function: '#268BD2', type: '#B58900' },
  status: { success: '#859900', error: '#DC322F', warning: '#B58900', info: '#2AA198', thinking: '#6C71C4' },
  tool: { name: '#268BD2', executing: '#B58900', result: '#586E75', border: '#073642' },
  ui: { border: '#073642', prompt: '#859900', banner: '#268BD2', bannerAccent: '#6C71C4', badge: '#D33682' },
}

// ---------------------------------------------------------------------------
// Theme registry
// ---------------------------------------------------------------------------

export const BUILT_IN_THEMES: Record<string, CmdrTheme> = {
  'cmdr-dark': cmdrDark,
  'cmdr-light': cmdrLight,
  'monokai': monokai,
  'nord': nord,
  'solarized-dark': solarizedDark,
}

let activeTheme: CmdrTheme = cmdrDark

/** Get the currently active theme. */
export function getActiveTheme(): CmdrTheme {
  return activeTheme
}

/** Switch the active theme by name (returns false if not found). */
export function setActiveTheme(name: string): boolean {
  const theme = BUILT_IN_THEMES[name]
  if (!theme) return false
  activeTheme = theme
  return true
}

/** Register a custom theme. */
export function registerTheme(theme: CmdrTheme): void {
  BUILT_IN_THEMES[theme.name] = theme
}

/** List all available theme names. */
export function listThemeNames(): string[] {
  return Object.keys(BUILT_IN_THEMES)
}

// ---------------------------------------------------------------------------
// Theme-aware chalk helpers
// ---------------------------------------------------------------------------

/** Create a chalk function from the active theme. */
export function t(category: keyof CmdrTheme, key: string): ChalkInstance {
  const cat = activeTheme[category]
  if (cat && typeof cat === 'object' && key in cat) {
    return chalk.hex((cat as Record<string, string>)[key])
  }
  return chalk.white
}
