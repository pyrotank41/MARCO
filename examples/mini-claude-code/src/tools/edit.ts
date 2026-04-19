// mini-claude-code — edit tool. String-replacement edit. Fails if old_string is missing or not unique.

import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { Tool } from '../../../../src/tools.js'

const editInput = z.object({
  path: z.string().min(1),
  old_string: z.string().min(1),
  new_string: z.string(),
})

export const editTool: Tool<z.infer<typeof editInput>> = {
  name: 'edit',
  description: 'Replace a unique old_string with new_string in a file. Fails if old_string is absent or appears more than once.',
  category: 'fs',
  permissionLevel: 'confirm',
  inputJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  validate: (i) => editInput.parse(i),
  handler: async (input) => {
    let content: string
    try {
      content = readFileSync(input.path, 'utf8')
    } catch (err) {
      return `Error reading ${input.path}: ${(err as Error).message}`
    }

    const occurrences = content.split(input.old_string).length - 1
    if (occurrences === 0) {
      return `old_string not found in ${input.path}`
    }
    if (occurrences > 1) {
      return `old_string is not unique in ${input.path} (found ${occurrences} matches). Provide more context.`
    }

    const updated = content.replace(input.old_string, input.new_string)
    try {
      writeFileSync(input.path, updated)
      return `replaced 1 occurrence in ${input.path}`
    } catch (err) {
      return `Error writing ${input.path}: ${(err as Error).message}`
    }
  },
}
