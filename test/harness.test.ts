import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Harness } from '../src/harness.js'
import { MockProvider } from '../src/providers/mock.js'
import type { Tool } from '../src/tools.js'
import type { AssistantMessage } from '../src/messages.js'
import type { Hooks } from '../src/hooks.js'

const echoTool: Tool = {
  name: 'echo',
  description: 'Echo input',
  inputJsonSchema: {
    type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
  },
  validate: (i) => z.object({ text: z.string() }).parse(i),
  handler: async (input) => `got ${(input as { text: string }).text}`,
}

describe('Harness', () => {
  it('runs a single-turn conversation and returns the final message', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'hi!', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const harness = new Harness({
      provider: new MockProvider([[{ type: 'message_end', message: endMsg }]]),
      modelConfig: { model: 'mock' },
    })
    const result = await harness.run({ kind: 'user_message', text: 'hello' })
    expect(result.status).toBe('completed')
    expect(result.finalMessage?.text).toBe('hi!')
  })

  it('rejects a run when onRunStart returns allowed=false', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'never called', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const hooks: Hooks = {
      onRunStart: async ({ messages }) => ({ allowed: false, rejectReason: 'blocked', messages }),
    }
    const harness = new Harness({
      provider: new MockProvider([[{ type: 'message_end', message: endMsg }]]),
      modelConfig: { model: 'mock' },
      hooks,
    })
    const result = await harness.run({ kind: 'user_message', text: 'x' })
    expect(result.status).toBe('aborted')
    expect(result.abortReason).toBe('blocked')
  })

  it('allows onRunStart to add a system prompt and hydrate messages', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'ok', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const hooks: Hooks = {
      onRunStart: async ({ messages }) => ({
        allowed: true,
        messages: [
          { role: 'system', text: 'you are echo bot' },
          ...messages,
        ],
      }),
    }
    const harness = new Harness({
      provider: new MockProvider([[{ type: 'message_end', message: endMsg }]]),
      modelConfig: { model: 'mock' },
      hooks,
    })
    const result = await harness.run({ kind: 'user_message', text: 'hi' })
    expect(result.messages[0].role).toBe('system')
    expect(result.messages[1].role).toBe('user')
  })

  it('invokes onRunEnd with the final status', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'done', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    let captured: { status: string; iterations: number } | undefined
    const hooks: Hooks = {
      onRunEnd: async ({ status, iterations }) => {
        captured = { status, iterations }
      },
    }
    const harness = new Harness({
      provider: new MockProvider([[{ type: 'message_end', message: endMsg }]]),
      modelConfig: { model: 'mock' },
      hooks,
    })
    await harness.run({ kind: 'user_message', text: 'x' })
    expect(captured?.status).toBe('completed')
    expect(captured?.iterations).toBe(1)
  })

  it('supports registering tools', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'done', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const harness = new Harness({
      provider: new MockProvider([[{ type: 'message_end', message: endMsg }]]),
      modelConfig: { model: 'mock' },
    })
    harness.registerTool(echoTool)
    expect(harness.getTool('echo')).toBe(echoTool)
  })
})
