// mini-claude-code — write tool. Creates or overwrites a file, creating parent dirs as needed.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Tool } from '../../../../src/tools.js'

const writeInput = z.object({
  path: z.string().min(1),
  content: z.string(),
})

export const writeTool: Tool<z.infer<typeof writeInput>> = {
  name: 'write',
  description: 'Create or overwrite a file at the given path with the given content.',
  category: 'fs',
  permissionLevel: 'confirm',
  inputJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      content: { type: 'string', description: 'Full file contents' },
    },
    required: ['path', 'content'],
  },
  validate: (i) => writeInput.parse(i),
  handler: async (input) => {
    try {
      mkdirSync(dirname(input.path), { recursive: true })
      writeFileSync(input.path, input.content)
      return `wrote ${input.content.length} bytes to ${input.path}`
    } catch (err) {
      return `Error writing ${input.path}: ${(err as Error).message}`
    }
  },
}
