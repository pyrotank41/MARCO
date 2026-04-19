#!/usr/bin/env node
// mini-claude-code — CLI entry point.

import { createInterface } from 'node:readline/promises'
import { readFileSync, existsSync } from 'node:fs'
import { stdin, stdout, argv, env, exit } from 'node:process'
import { join } from 'node:path'
import { cwd } from 'node:process'
import {
  Harness, AnthropicProvider,
  type Hooks, type Message,
} from '../../../src/index.js'

// Minimal .env loader — avoids taking a dotenv dependency. Lines of the form
// `KEY=value` are added to process.env unless already set. Comments and
// blank lines are skipped. Quoted values have their surrounding quotes stripped.
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!env[key]) env[key] = value
  }
}
import {
  loadConfig, setSelectedModel, resetConfig,
  DEFAULT_CONFIG_PATH,
} from './config.js'
import { loadSession, appendMessage, newSessionId } from './session.js'
import { bashTool } from './tools/bash.js'
import { readTool } from './tools/read.js'
import { writeTool } from './tools/write.js'
import { editTool } from './tools/edit.js'
import { permissionHook } from './permissions.js'
import { StreamingProvider } from './streaming.js'

const SYSTEM_PROMPT = `You are a helpful coding assistant. You have four tools:
- bash: run shell commands
- read: read files
- write: create or overwrite files
- edit: replace unique strings in files

Be concise. Prefer reading before writing. Confirm your understanding before making changes.`

async function main(): Promise<void> {
  loadDotEnv(join(cwd(), '.env'))

  const args = argv.slice(2)

  if (args[0] === 'config') {
    await handleConfig(args.slice(1))
    return
  }

  let sessionId: string | undefined
  const sessIdx = args.indexOf('--session')
  if (sessIdx >= 0 && args[sessIdx + 1]) {
    sessionId = args[sessIdx + 1]
  }
  sessionId ??= newSessionId()

  const cfg = loadConfig()
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    stdout.write('Set ANTHROPIC_API_KEY in your environment.\n')
    exit(1)
  }

  const sessionDir = join(cwd(), '.marco')
  const historyMessages = loadSession(sessionDir, sessionId)

  const provider = new StreamingProvider(new AnthropicProvider({ apiKey }))

  const hooks: Hooks = {
    onRunStart: async ({ messages }) => {
      const hydrated: Message[] = historyMessages.length
        ? [{ role: 'system', text: SYSTEM_PROMPT }, ...historyMessages, ...messages]
        : [{ role: 'system', text: SYSTEM_PROMPT }, ...messages]
      for (const msg of messages) {
        appendMessage(sessionDir, sessionId!, msg)
      }
      return { allowed: true, messages: hydrated }
    },
    beforeToolCall: permissionHook,
    onRunEnd: async ({ status, finalMessage, error }) => {
      if (finalMessage) {
        appendMessage(sessionDir, sessionId!, finalMessage)
      }
      if (status === 'errored' && error) {
        stdout.write(`\n[error] ${error.message}\n\n`)
      } else if (status === 'aborted') {
        stdout.write(`\n[aborted]\n\n`)
      }
    },
  }

  const harness = new Harness({
    provider,
    modelConfig: { model: cfg.selected_model, maxTokens: 4096 },
    hooks,
    tools: [bashTool, readTool, writeTool, editTool],
  })

  stdout.write(`\nmini-claude-code — session ${sessionId}\nmodel: ${cfg.selected_model}\n(type "exit" to quit)\n\n`)

  const rl = createInterface({ input: stdin, output: stdout })
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const text = (await rl.question('> ')).trim()
    if (!text) continue
    if (text === 'exit' || text === 'quit') break

    await harness.run({ kind: 'user_message', text })
  }
  rl.close()
}

async function handleConfig(args: string[]): Promise<void> {
  const sub = args[0]

  if (!sub) {
    const cfg = loadConfig()
    stdout.write(`\nCurrent model: ${cfg.selected_model}\n\nAvailable models:\n`)
    for (const m of cfg.available_models) {
      const marker = m.id === cfg.selected_model ? '→' : ' '
      stdout.write(`  ${marker} ${m.id.padEnd(32)} ${m.label}\n`)
    }
    stdout.write('\n')
    return
  }

  if (sub === 'set') {
    const id = args[1]
    if (!id) {
      stdout.write('Usage: marco config set <model-id>\n')
      exit(1)
    }
    const updated = setSelectedModel(DEFAULT_CONFIG_PATH, id)
    stdout.write(`Model set to: ${updated.selected_model}\n`)
    return
  }

  if (sub === 'reset') {
    const reset = resetConfig(DEFAULT_CONFIG_PATH)
    stdout.write(`Model reset to default: ${reset.selected_model}\n`)
    return
  }

  stdout.write(`Unknown subcommand: ${sub}\nUsage: marco config [set <id> | reset]\n`)
  exit(1)
}

main().catch((err) => {
  stdout.write(`\nError: ${(err as Error).message}\n`)
  exit(1)
})
