import { describe, it, expect } from 'vitest'
import { bashTool } from '../../src/tools/bash.js'

describe('bashTool', () => {
  it('runs a simple echo command', async () => {
    const result = await bashTool.handler(
      bashTool.validate({ command: "echo 'hello'" }),
      { runId: 'r1' },
    )
    expect(result).toContain('hello')
  })

  it('returns non-zero exit code in output', async () => {
    const result = await bashTool.handler(
      bashTool.validate({ command: 'false' }),
      { runId: 'r1' },
    )
    expect(result).toContain('exit code')
  })

  it('validates input schema', () => {
    expect(() => bashTool.validate({ notCommand: 'x' })).toThrow()
  })
})
