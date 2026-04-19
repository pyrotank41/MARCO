import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTool } from '../../src/tools/read.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'marco-read-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('readTool', () => {
  it('reads the file contents', async () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'hello world')
    const result = await readTool.handler(
      readTool.validate({ path }),
      { runId: 'r1' },
    )
    expect(result).toContain('hello world')
  })

  it('returns an error message for missing file', async () => {
    const result = await readTool.handler(
      readTool.validate({ path: join(dir, 'missing.txt') }),
      { runId: 'r1' },
    )
    expect(result).toMatch(/not found|ENOENT/i)
  })
})
