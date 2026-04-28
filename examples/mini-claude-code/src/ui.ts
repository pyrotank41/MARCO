// mini-claude-code — terminal UI helpers: ANSI colors + tiny markdown renderer.
//
// We avoid adding a markdown dependency. The renderer covers the subset that
// shows up in coding-agent output: headings, bold, italic, inline code, fenced
// code blocks, bullet/numbered lists, blockquotes, and links.

const ESC = '\x1b['
export const RESET = `${ESC}0m`

// 256-color palette picks. Pastel blue ~153, pastel orange ~216.
export const PASTEL_BLUE = `${ESC}38;5;153m`
export const PASTEL_ORANGE = `${ESC}38;5;216m`
export const DIM = `${ESC}2m`
export const BOLD = `${ESC}1m`
export const ITALIC = `${ESC}3m`
export const UNDERLINE = `${ESC}4m`

// Code styling: dim grey background + warm foreground.
const CODE_FG = `${ESC}38;5;223m`
const CODE_BG = `${ESC}48;5;236m`

export function blue(s: string): string {
  return `${PASTEL_BLUE}${s}${RESET}`
}

// Strip ANSI escape sequences for width measurement.
function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

function termWidth(): number {
  const cols = (process.stdout as { columns?: number }).columns
  // Cap at 100 so very wide terminals still produce readable line lengths.
  return Math.max(40, Math.min(cols ?? 80, 100))
}

/**
 * Word-wrap a styled line to `width` visible columns. Splits on whitespace,
 * preserves ANSI styles per chunk, and indents continuation lines by
 * `hangingIndent` spaces. Words longer than the available width are emitted
 * on their own line rather than hard-broken.
 */
export function wrapLine(text: string, width: number, hangingIndent = 0): string {
  if (visibleLength(text) <= width) return text
  const words = text.split(/(\s+)/) // keep separators
  const lines: string[] = []
  let cur = ''
  let curWidth = 0
  const pad = ' '.repeat(hangingIndent)

  for (const word of words) {
    if (word.length === 0) continue
    const w = visibleLength(word)
    if (curWidth === 0 && /^\s+$/.test(word)) continue // skip leading whitespace on a new line
    if (curWidth + w > width && curWidth > 0) {
      lines.push(cur)
      cur = pad
      curWidth = hangingIndent
      if (/^\s+$/.test(word)) continue
    }
    cur += word
    curWidth += w
  }
  if (cur.length > 0) lines.push(cur)
  return lines.join('\n')
}

export function orange(s: string): string {
  return `${PASTEL_ORANGE}${s}${RESET}`
}

// Render inline markdown: **bold**, *italic*, `code`, [text](url).
function renderInline(text: string): string {
  let out = text
  // Inline code first so its contents don't get further styled.
  out = out.replace(/`([^`]+)`/g, (_m, code) => `${CODE_BG}${CODE_FG} ${code} ${RESET}${PASTEL_BLUE}`)
  // Links [text](url) -> underlined text + dim url.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
    `${UNDERLINE}${label}${RESET}${PASTEL_BLUE} ${DIM}(${url})${RESET}${PASTEL_BLUE}`,
  )
  // Bold **x** (must come before single-asterisk italic).
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `${BOLD}${t}${RESET}${PASTEL_BLUE}`)
  // Italic *x* or _x_.
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, (_m, pre, t) => `${pre}${ITALIC}${t}${RESET}${PASTEL_BLUE}`)
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, (_m, pre, t) => `${pre}${ITALIC}${t}${RESET}${PASTEL_BLUE}`)
  return out
}

/**
 * Render a complete markdown string into ANSI-styled text. The whole output
 * is wrapped in PASTEL_BLUE so the trailing reset returns the terminal to
 * default — every styled segment re-enters PASTEL_BLUE so styles compose.
 */
export function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  const width = termWidth()
  let inFence = false
  let fenceLang = ''

  for (const raw of lines) {
    const line = raw

    // Fenced code blocks ```lang ... ```
    const fenceMatch = line.match(/^```(\w*)\s*$/)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fenceLang = fenceMatch[1] ?? ''
        out.push(`${DIM}${fenceLang ? `┌─ ${fenceLang}` : '┌──'}${RESET}`)
      } else {
        inFence = false
        fenceLang = ''
        out.push(`${DIM}└──${RESET}`)
      }
      continue
    }
    if (inFence) {
      out.push(`${CODE_BG}${CODE_FG}  ${line.padEnd(76)}${RESET}`)
      continue
    }

    // Headings.
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const text = renderInline(h[2])
      const prefix = level === 1 ? '█ ' : level === 2 ? '▌ ' : '· '
      out.push(`${BOLD}${PASTEL_BLUE}${prefix}${text}${RESET}`)
      continue
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const body = `${DIM}│${RESET} ${PASTEL_BLUE}${renderInline(line.replace(/^>\s?/, ''))}${RESET}`
      out.push(wrapLine(body, width, 2))
      continue
    }

    // Bullet list.
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/)
    if (bullet) {
      const indent = bullet[1] ?? ''
      const body = `${PASTEL_BLUE}${indent}• ${renderInline(bullet[2])}${RESET}`
      out.push(wrapLine(body, width, indent.length + 2))
      continue
    }

    // Numbered list.
    const num = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
    if (num) {
      const indent = num[1] ?? ''
      const marker = `${num[2]}. `
      const body = `${PASTEL_BLUE}${indent}${BOLD}${num[2]}.${RESET}${PASTEL_BLUE} ${renderInline(num[3])}${RESET}`
      out.push(wrapLine(body, width, indent.length + marker.length))
      continue
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(`${DIM}${'─'.repeat(40)}${RESET}`)
      continue
    }

    // Plain paragraph line.
    if (line.length === 0) {
      out.push('')
    } else {
      out.push(wrapLine(`${PASTEL_BLUE}${renderInline(line)}${RESET}`, width, 0))
    }
  }

  return out.join('\n')
}
