import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { newSessionId, loadSession, appendMessage } from '../src/session.js'
import type { Message } from '../../../src/messages.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'marco-session-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('session', () => {
  it('newSessionId returns a stable-format id', () => {
    const id = newSessionId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('loadSession returns [] for a new session', () => {
    const msgs = loadSession(dir, 'new-id')
    expect(msgs).toEqual([])
  })

  it('appendMessage persists and loadSession returns them in order', () => {
    const id = 'sess-1'
    const m1: Message = { role: 'user', text: 'hi' }
    const m2: Message = {
      role: 'assistant', text: 'hello', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    appendMessage(dir, id, m1)
    appendMessage(dir, id, m2)
    const loaded = loadSession(dir, id)
    expect(loaded).toEqual([m1, m2])
  })

  it('stores one JSON object per line (JSONL format)', () => {
    const id = 'sess-2'
    appendMessage(dir, id, { role: 'user', text: 'a' })
    appendMessage(dir, id, { role: 'user', text: 'b' })
    const path = join(dir, 'sessions', `${id}.jsonl`)
    const raw = readFileSync(path, 'utf8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual({ role: 'user', text: 'a' })
  })
})
