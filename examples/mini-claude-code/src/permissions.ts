// mini-claude-code — per-tool permission UX. Plugs into MARCO's beforeToolCall hook.

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { readFileSync, existsSync } from 'node:fs'
import type { BeforeToolCallInput, BeforeToolCallOutput } from '../../../src/hooks.js'

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim().toLowerCase()
}

function isYes(answer: string): boolean {
  return answer === 'y' || answer === 'yes'
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

export async function permissionHook(
  input: BeforeToolCallInput,
): Promise<BeforeToolCallOutput> {
  const { toolCall } = input

  switch (toolCall.name) {
    case 'read':
      return { decision: 'execute' }

    case 'bash': {
      const command = (toolCall.input as { command?: string }).command ?? ''
      const answer = await ask(`\n$ ${command}\n\nRun this command? [y/N] `)
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
      const answer = await ask('Write this file? [y/N] ')
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
      const answer = await ask('Apply this edit? [y/N] ')
      return isYes(answer)
        ? { decision: 'execute' }
        : { decision: 'deny', reason: 'User denied edit' }
    }

    default:
      return { decision: 'deny', reason: `Unknown tool: ${toolCall.name}` }
  }
}
