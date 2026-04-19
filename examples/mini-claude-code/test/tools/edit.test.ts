import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { editTool } from '../../src/tools/edit.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'marco-edit-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('editTool', () => {
  it('replaces old_string with new_string', async () => {
    const path = join(dir, 'f.txt')
    writeFileSync(path, 'hello world')
    const result = await editTool.handler(
      editTool.validate({ path, old_string: 'world', new_string: 'marco' }),
      { runId: 'r1' },
    )
    expect(readFileSync(path, 'utf8')).toBe('hello marco')
    expect(result).toMatch(/replaced/i)
  })

  it('errors when old_string is not found', async () => {
    const path = join(dir, 'f.txt')
    writeFileSync(path, 'hello world')
    const result = await editTool.handler(
      editTool.validate({ path, old_string: 'missing', new_string: 'x' }),
      { runId: 'r1' },
    )
    expect(result).toMatch(/not found/i)
  })

  it('errors when old_string is not unique', async () => {
    const path = join(dir, 'f.txt')
    writeFileSync(path, 'a\na\na')
    const result = await editTool.handler(
      editTool.validate({ path, old_string: 'a', new_string: 'b' }),
      { runId: 'r1' },
    )
    expect(result).toMatch(/not unique|multiple/i)
  })
})
