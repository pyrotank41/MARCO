// mini-claude-code — per-tool permission UX. Plugs into MARCO's beforeToolCall hook.
//
// createPermissionHook takes a readline.Interface and returns the hook.
// The caller owns the readline lifetime. Do NOT create a new Interface
// per prompt — closing it cascades to stdin and can terminate the
// outer readline that drives the main REPL loop.

import { stdout } from 'node:process'
import { readFileSync, existsSync } from 'node:fs'
import type { Interface as Readline } from 'node:readline/promises'
import type { BeforeToolCallInput, BeforeToolCallOutput } from '../../../src/hooks.js'

function isYes(answer: string): boolean {
  const a = answer.trim().toLowerCase()
  return a === 'y' || a === 'yes'
}

function previewDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const out: string[] = []
  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const a = oldLines[i]
    const b = newLines[i]
    if (a === b) {
      out.push(`  ${a ?? ''}`)
    } else {
      if (a !== undefined) out.push(`- ${a}`)
      if (b !== undefined) out.push(`+ ${b}`)
    }
  }
  return out.join('\n')
}

/**
 * Factory: bind a shared readline.Interface into a beforeToolCall hook.
 * The returned hook prompts the user via the supplied rl — it never
 * creates its own Interface, which avoids the nested-readline cascade
 * that closes stdin for the outer REPL.
 */
export function createPermissionHook(rl: Readline) {
  return async function permissionHook(
    input: BeforeToolCallInput,
  ): Promise<BeforeToolCallOutput> {
    const { toolCall } = input

    switch (toolCall.name) {
      case 'read':
        return { decision: 'execute' }

      case 'bash': {
        const command = (toolCall.input as { command?: string }).command ?? ''
        const answer = await rl.question(`\n$ ${command}\n\nRun this command? [y/N] `)
        return isYes(answer)
          ? { decision: 'execute' }
          : { decision: 'deny', reason: 'User denied bash execution' }
      }

      case 'write': {
        const { path, content } = toolCall.input as { path?: string; content?: string }
        stdout.write(`\nWrite to ${path ?? '<unknown>'} (${(content ?? '').length} bytes):\n`)
        stdout.write('─'.repeat(40) + '\n')
        stdout.write((content ?? '') + '\n')
        stdout.write('─'.repeat(40) + '\n')
        const answer = await rl.question('Write this file? [y/N] ')
        return isYes(answer)
          ? { decision: 'execute' }
          : { decision: 'deny', reason: 'User denied write' }
      }

      case 'edit': {
        const { path, old_string, new_string } = toolCall.input as {
          path?: string
          old_string?: string
          new_string?: string
        }
        const current = path && existsSync(path) ? readFileSync(path, 'utf8') : ''
        const next = current.replace(old_string ?? '', new_string ?? '')
        stdout.write(`\nEdit ${path ?? '<unknown>'}:\n`)
        stdout.write('─'.repeat(40) + '\n')
        stdout.write(previewDiff(current, next) + '\n')
        stdout.write('─'.repeat(40) + '\n')
        const answer = await rl.question('Apply this edit? [y/N] ')
        return isYes(answer)
          ? { decision: 'execute' }
          : { decision: 'deny', reason: 'User denied edit' }
      }

      default:
        return { decision: 'deny', reason: `Unknown tool: ${toolCall.name}` }
    }
  }
}
