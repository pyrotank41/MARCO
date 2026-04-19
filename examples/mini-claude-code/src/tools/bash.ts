// mini-claude-code — bash tool. Runs a shell command, returns stdout/stderr + exit code.

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Tool } from '../../../../src/tools.js'

const execAsync = promisify(exec)

const bashInput = z.object({
  command: z.string().min(1),
})

export const bashTool: Tool<z.infer<typeof bashInput>> = {
  name: 'bash',
  description: 'Run a shell command and return stdout/stderr. Use for terminal commands.',
  category: 'system',
  inputJsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
    },
    required: ['command'],
  },
  validate: (i) => bashInput.parse(i),
  handler: async (input) => {
    try {
      const { stdout, stderr } = await execAsync(input.command, { maxBuffer: 1024 * 1024 })
      const parts: string[] = []
      if (stdout) parts.push(`stdout:\n${stdout}`)
      if (stderr) parts.push(`stderr:\n${stderr}`)
      if (!parts.length) parts.push('(no output)')
      return parts.join('\n')
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message: string }
      const parts: string[] = []
      if (e.stdout) parts.push(`stdout:\n${e.stdout}`)
      if (e.stderr) parts.push(`stderr:\n${e.stderr}`)
      parts.push(`exit code: ${e.code ?? 'unknown'}`)
      return parts.join('\n')
    }
  },
}
