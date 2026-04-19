// mini-claude-code — read tool. Reads a file and returns its contents.

import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { Tool } from '../../../../src/tools.js'

const readInput = z.object({
  path: z.string().min(1),
})

export const readTool: Tool<z.infer<typeof readInput>> = {
  name: 'read',
  description: 'Read a file and return its contents.',
  category: 'fs',
  permissionLevel: 'auto',
  inputJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
    },
    required: ['path'],
  },
  validate: (i) => readInput.parse(i),
  handler: async (input) => {
    try {
      return readFileSync(input.path, 'utf8')
    } catch (err) {
      return `Error reading ${input.path}: ${(err as Error).message}`
    }
  },
}
