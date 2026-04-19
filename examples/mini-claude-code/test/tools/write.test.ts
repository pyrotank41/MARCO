import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeTool } from '../../src/tools/write.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'marco-write-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('writeTool', () => {
  it('writes a new file', async () => {
    const path = join(dir, 'new.txt')
    const result = await writeTool.handler(
      writeTool.validate({ path, content: 'abc' }),
      { runId: 'r1' },
    )
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('abc')
    expect(result).toMatch(/wrote/i)
  })

  it('overwrites an existing file', async () => {
    const path = join(dir, 'over.txt')
    await writeTool.handler(writeTool.validate({ path, content: 'one' }), { runId: 'r1' })
    await writeTool.handler(writeTool.validate({ path, content: 'two' }), { runId: 'r1' })
    expect(readFileSync(path, 'utf8')).toBe('two')
  })

  it('creates nested directories', async () => {
    const path = join(dir, 'a', 'b', 'c.txt')
    await writeTool.handler(writeTool.validate({ path, content: 'x' }), { runId: 'r1' })
    expect(existsSync(path)).toBe(true)
  })
})
