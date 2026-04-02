/**
 * Markdown renderer for terminal output.
 *
 * Uses marked + marked-terminal for rich terminal rendering with
 * cmdr's AMOLED black + green/purple theme.
 */

import { Marked } from 'marked'
import { markedTerminal } from 'marked-terminal'
import chalk from 'chalk'

// AMOLED green/purple palette for marked-terminal
const green = chalk.hex('#00FF41')
const purple = chalk.hex('#BF40FF')
const cyan = chalk.hex('#00FFFF')
const white = chalk.hex('#E0E0E0')
const dim = chalk.hex('#555555')

const marked = new Marked()

marked.use(
  markedTerminal({
    code: chalk.hex('#00FF41'),
    codespan: chalk.hex('#00FF41'),
    strong: chalk.hex('#FFFFFF').bold,
    em: chalk.hex('#BF40FF').italic,
    heading: chalk.hex('#BF40FF').bold,
    firstHeading: chalk.hex('#BF40FF').underline.bold,
    href: chalk.hex('#00FFFF').underline,
    link: chalk.hex('#00FFFF'),
    listitem: chalk.reset,
    blockquote: chalk.hex('#555555').italic,
    hr: chalk.hex('#00BB30'),
    paragraph: chalk.reset,
    table: chalk.reset,
    text: chalk.hex('#E0E0E0'),
    unescape: true,
    emoji: false,
    showSectionPrefix: false,
    reflowText: false,
    width: 80,
    tab: 2,
  }),
)

export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string
  } catch {
    return text
  }
}
