// mini-claude-code — session persistence. One JSONL file per session under <cwd>/.marco/sessions.

import { randomUUID } from 'node:crypto'
import {
  readFileSync, existsSync, appendFileSync, mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Message } from '../../../src/messages.js'

export function newSessionId(): string {
  return randomUUID()
}

export function sessionPath(baseDir: string, sessionId: string): string {
  return join(baseDir, 'sessions', `${sessionId}.jsonl`)
}

export function loadSession(baseDir: string, sessionId: string): Message[] {
  const path = sessionPath(baseDir, sessionId)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Message)
}

export function appendMessage(baseDir: string, sessionId: string, message: Message): void {
  const path = sessionPath(baseDir, sessionId)
  mkdirSync(join(baseDir, 'sessions'), { recursive: true })
  appendFileSync(path, JSON.stringify(message) + '\n')
}
