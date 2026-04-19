import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, type Tool } from '../src/tools.js'

const bashTool: Tool = {
  name: 'bash',
  description: 'Run a shell command',
  inputJsonSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
  validate: (i) => z.object({ command: z.string() }).parse(i),
  handler: async (input) => `ran: ${(input as { command: string }).command}`,
  category: 'system',
}

const readTool: Tool = {
  name: 'read',
  description: 'Read a file',
  inputJsonSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  validate: (i) => z.object({ path: z.string() }).parse(i),
  handler: async () => 'file contents',
  category: 'fs',
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const reg = new ToolRegistry()
    reg.register(bashTool)
    expect(reg.get('bash')).toBe(bashTool)
    expect(reg.get('missing')).toBeUndefined()
  })

  it('lists all tools', () => {
    const reg = new ToolRegistry()
    reg.register(bashTool)
    reg.register(readTool)
    expect(reg.list()).toHaveLength(2)
  })

  it('filters list by category', () => {
    const reg = new ToolRegistry()
    reg.register(bashTool)
    reg.register(readTool)
    expect(reg.list({ category: 'fs' })).toEqual([readTool])
  })

  it('toSpecs produces provider-ready specs', () => {
    const reg = new ToolRegistry()
    reg.register(bashTool)
    const specs = reg.toSpecs()
    expect(specs).toHaveLength(1)
    expect(specs[0]).toEqual({
      name: 'bash',
      description: 'Run a shell command',
      inputSchema: bashTool.inputJsonSchema,
    })
  })

  it('toSpecs supports filtering', () => {
    const reg = new ToolRegistry()
    reg.register(bashTool)
    reg.register(readTool)
    const specs = reg.toSpecs({ category: 'fs' })
    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('read')
  })

  it('rejects duplicate registrations', () => {
    const reg = new ToolRegistry()
    reg.register(bashTool)
    expect(() => reg.register(bashTool)).toThrow(/already registered/)
  })
})
