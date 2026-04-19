import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Harness } from '../src/harness.js'
import { MockProvider } from '../src/providers/mock.js'
import type { Tool } from '../src/tools.js'
import type { AssistantMessage } from '../src/messages.js'
import type { Hooks } from '../src/hooks.js'

describe('integration — full lifecycle', () => {
  it('fires all five hooks in order across a tool-using run', async () => {
    const callLog: string[] = []

    const turn1: AssistantMessage = {
      role: 'assistant', text: '', toolCalls: [
        { id: 'c1', name: 'echo', input: { text: 'hi' } },
      ],
      stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const turn2: AssistantMessage = {
      role: 'assistant', text: 'all done', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 2 },
    }

    const provider = new MockProvider([
      [{ type: 'message_end', message: turn1 }],
      [{ type: 'message_end', message: turn2 }],
    ])

    const echoTool: Tool = {
      name: 'echo',
      description: 'Echo',
      inputJsonSchema: {
        type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
      },
      validate: (i) => z.object({ text: z.string() }).parse(i),
      handler: async (input) => {
        callLog.push(`tool:exec:${(input as { text: string }).text}`)
        return `echo:${(input as { text: string }).text}`
      },
    }

    const hooks: Hooks = {
      onRunStart: async ({ messages }) => {
        callLog.push('onRunStart')
        return { allowed: true, messages }
      },
      beforeModelCall: async ({ messages, iteration }) => {
        callLog.push(`beforeModelCall:${iteration}`)
        return { messages }
      },
      beforeToolCall: async ({ toolCall }) => {
        callLog.push(`beforeToolCall:${toolCall.name}`)
        return { decision: 'execute' }
      },
      afterToolResult: async ({ toolCall, result }) => {
        callLog.push(`afterToolResult:${toolCall.name}`)
        return { result }
      },
      onRunEnd: async ({ status }) => {
        callLog.push(`onRunEnd:${status}`)
      },
    }

    const harness = new Harness({
      provider,
      modelConfig: { model: 'mock' },
      hooks,
      tools: [echoTool],
    })
    const result = await harness.run({ kind: 'user_message', text: 'say hi' })

    expect(result.status).toBe('completed')
    expect(callLog).toEqual([
      'onRunStart',
      'beforeModelCall:0',
      'beforeToolCall:echo',
      'tool:exec:hi',
      'afterToolResult:echo',
      'beforeModelCall:1',
      'onRunEnd:completed',
    ])
  })
})
