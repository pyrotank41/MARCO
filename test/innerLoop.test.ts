import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { runInnerLoop, type RunInnerLoopInput } from '../src/innerLoop.js'
import { MockProvider } from '../src/providers/mock.js'
import { ToolRegistry, type Tool } from '../src/tools.js'
import type { AssistantMessage, Message } from '../src/messages.js'
import type { Hooks } from '../src/hooks.js'

const echoTool: Tool = {
  name: 'echo',
  description: 'Echo input back',
  inputJsonSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  validate: (i) => z.object({ text: z.string() }).parse(i),
  handler: async (input) => `echoed: ${(input as { text: string }).text}`,
}

describe('runInnerLoop', () => {
  it('returns on end_turn without calling any tool', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'done', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const provider = new MockProvider([[{ type: 'message_end', message: endMsg }]])
    const registry = new ToolRegistry()
    const input: RunInnerLoopInput = {
      runId: 'r1',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolRegistry: registry,
      hooks: {},
      modelConfig: { model: 'mock' },
    }
    const result = await runInnerLoop(input)
    expect(result.status).toBe('completed')
    expect(result.finalMessage).toEqual(endMsg)
    expect(result.iterations).toBe(1)
  })

  it('executes tool calls and feeds results back until end_turn', async () => {
    const turn1: AssistantMessage = {
      role: 'assistant', text: '', toolCalls: [
        { id: 'c1', name: 'echo', input: { text: 'hi' } },
      ],
      stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const turn2: AssistantMessage = {
      role: 'assistant', text: 'all done', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 },
    }
    const provider = new MockProvider([
      [{ type: 'message_end', message: turn1 }],
      [{ type: 'message_end', message: turn2 }],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)

    const result = await runInnerLoop({
      runId: 'r2',
      messages: [{ role: 'user', text: 'say hi' }],
      provider,
      toolRegistry: registry,
      hooks: {},
      modelConfig: { model: 'mock' },
    })

    expect(result.status).toBe('completed')
    expect(result.iterations).toBe(2)

    const roles = result.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant'])
    const toolMsg = result.messages[2]
    expect(toolMsg.role).toBe('tool')
    if (toolMsg.role === 'tool') {
      expect(toolMsg.content).toContain('echoed: hi')
    }
  })

  it('denies a tool call via beforeToolCall and returns the reason as an error tool result', async () => {
    const turn1: AssistantMessage = {
      role: 'assistant', text: '', toolCalls: [
        { id: 'c1', name: 'echo', input: { text: 'nope' } },
      ],
      stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const turn2: AssistantMessage = {
      role: 'assistant', text: 'ok sorry', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 },
    }
    const provider = new MockProvider([
      [{ type: 'message_end', message: turn1 }],
      [{ type: 'message_end', message: turn2 }],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)

    const hooks: Hooks = {
      beforeToolCall: async ({ toolCall }) =>
        toolCall.name === 'echo'
          ? { decision: 'deny', reason: 'not allowed' }
          : { decision: 'execute' },
    }

    const result = await runInnerLoop({
      runId: 'r3',
      messages: [{ role: 'user', text: 'nope' }],
      provider,
      toolRegistry: registry,
      hooks,
      modelConfig: { model: 'mock' },
    })

    const toolMsg = result.messages[2]
    expect(toolMsg.role).toBe('tool')
    if (toolMsg.role === 'tool') {
      expect(toolMsg.isError).toBe(true)
      expect(toolMsg.content).toContain('not allowed')
    }
  })

  it('short-circuits a tool call and returns the provided result', async () => {
    const turn1: AssistantMessage = {
      role: 'assistant', text: '', toolCalls: [
        { id: 'c1', name: 'echo', input: { text: 'x' } },
      ],
      stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const turn2: AssistantMessage = {
      role: 'assistant', text: 'done', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 },
    }
    const provider = new MockProvider([
      [{ type: 'message_end', message: turn1 }],
      [{ type: 'message_end', message: turn2 }],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)

    const hooks: Hooks = {
      beforeToolCall: async () => ({ decision: 'short-circuit', result: 'CACHED' }),
    }

    const result = await runInnerLoop({
      runId: 'r4',
      messages: [{ role: 'user', text: 'x' }],
      provider,
      toolRegistry: registry,
      hooks,
      modelConfig: { model: 'mock' },
    })

    const toolMsg = result.messages[2]
    if (toolMsg.role === 'tool') {
      expect(toolMsg.isError).toBe(false)
      expect(toolMsg.content).toBe('CACHED')
    }
  })

  it('aborts when beforeModelCall returns abort=true', async () => {
    const endMsg: AssistantMessage = {
      role: 'assistant', text: 'never reached', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const provider = new MockProvider([[{ type: 'message_end', message: endMsg }]])

    const hooks: Hooks = {
      beforeModelCall: async ({ messages }) => ({ messages, abort: true, abortReason: 'budget' }),
    }

    const result = await runInnerLoop({
      runId: 'r5',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolRegistry: new ToolRegistry(),
      hooks,
      modelConfig: { model: 'mock' },
    })

    expect(result.status).toBe('aborted')
    expect(result.iterations).toBe(0)
  })

  it('errors out on unknown tool', async () => {
    const turn1: AssistantMessage = {
      role: 'assistant', text: '', toolCalls: [
        { id: 'c1', name: 'unknown_tool', input: {} },
      ],
      stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
    }
    const turn2: AssistantMessage = {
      role: 'assistant', text: 'oh well', toolCalls: [],
      stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 },
    }
    const provider = new MockProvider([
      [{ type: 'message_end', message: turn1 }],
      [{ type: 'message_end', message: turn2 }],
    ])

    const result = await runInnerLoop({
      runId: 'r6',
      messages: [{ role: 'user', text: '' }],
      provider,
      toolRegistry: new ToolRegistry(),
      hooks: {},
      modelConfig: { model: 'mock' },
    })

    const toolMsg = result.messages[2]
    if (toolMsg.role === 'tool') {
      expect(toolMsg.isError).toBe(true)
      expect(toolMsg.content).toContain('not registered')
    }
  })
})
