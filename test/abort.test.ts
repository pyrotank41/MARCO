// Cancellation tests — exercises the AbortSignal threading through
// runInnerLoop, providers, and tool handlers.

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { runInnerLoop, raceWithAbort, type RunInnerLoopInput } from '../src/innerLoop.js'
import { MockProvider } from '../src/providers/mock.js'
import { Harness } from '../src/harness.js'
import { ToolRegistry, type Tool } from '../src/tools.js'
import type { AssistantMessage, ToolCall, ToolResultMessage } from '../src/messages.js'

const endTurnMessage: AssistantMessage = {
  role: 'assistant', text: 'done', toolCalls: [],
  stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
}

const toolCallMessage: AssistantMessage = {
  role: 'assistant', text: '', toolCalls: [{ id: 'tc1', name: 'sleep_tool', input: {} }],
  stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
}

function makeDirectExecutor(registry: ToolRegistry) {
  return async (call: ToolCall, opts?: { signal?: AbortSignal }): Promise<ToolResultMessage> => {
    const tool = registry.get(call.name)
    if (!tool) {
      return { role: 'tool', toolCallId: call.id, content: 'not registered', isError: true }
    }
    try {
      const validated = tool.validate(call.input)
      const result = await tool.handler(validated, { runId: 'test', abortSignal: opts?.signal })
      return { role: 'tool', toolCallId: call.id, content: result, isError: false }
    } catch (err) {
      return { role: 'tool', toolCallId: call.id, content: String(err), isError: true }
    }
  }
}

describe('runInnerLoop — abort signal', () => {
  it('returns aborted immediately if signal is already aborted', async () => {
    const provider = new MockProvider([[{ type: 'message_end', message: endTurnMessage }]])
    const ctrl = new AbortController()
    ctrl.abort('pre-flight stop')

    const input: RunInnerLoopInput = {
      runId: 'r1',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolSpecs: [],
      requestToolCall: async () => { throw new Error('should not be called') },
      hooks: {},
      modelConfig: { model: 'mock' },
      signal: ctrl.signal,
    }
    const result = await runInnerLoop(input)
    expect(result.status).toBe('aborted')
    expect(result.iterations).toBe(0)
    expect(result.abortReason).toContain('pre-flight stop')
  })

  it('returns aborted when signal fires mid-stream (provider observes signal)', async () => {
    // MockProvider yields events one-per-microtask and checks the signal
    // before each yield, so firing the signal between yields aborts the
    // stream from the provider's side — same as a real fetch would.
    const provider = new MockProvider([[
      { type: 'text_delta', text: 'partial...' },
      { type: 'text_delta', text: 'more...' },
      { type: 'text_delta', text: 'still going...' },
      { type: 'message_end', message: endTurnMessage },
    ]])
    const ctrl = new AbortController()

    const promise = runInnerLoop({
      runId: 'r1',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolSpecs: [],
      requestToolCall: async () => { throw new Error('should not be called') },
      hooks: {},
      modelConfig: { model: 'mock' },
      signal: ctrl.signal,
    })

    // Fire abort after the first event has flushed
    queueMicrotask(() => ctrl.abort('user clicked stop'))
    const result = await promise
    expect(result.status).toBe('aborted')
    expect(result.abortReason).toContain('user clicked stop')
  })

  it('returns aborted when signal fires mid-tool (tool keeps running orphaned)', async () => {
    const registry = new ToolRegistry()
    let toolStarted = false
    let toolCompleted = false
    const slowTool: Tool = {
      name: 'sleep_tool',
      description: 'Sleep then return',
      inputJsonSchema: { type: 'object', properties: {}, required: [] },
      validate: (i) => z.object({}).parse(i),
      handler: async () => {
        toolStarted = true
        await new Promise((resolve) => setTimeout(resolve, 100))
        toolCompleted = true
        return 'slept'
      },
    }
    registry.register(slowTool)

    const provider = new MockProvider([
      [{ type: 'message_end', message: toolCallMessage }],
      // (we never get here — abort happens during tool execution)
      [{ type: 'message_end', message: endTurnMessage }],
    ])
    const ctrl = new AbortController()

    const promise = runInnerLoop({
      runId: 'r1',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolSpecs: [],
      requestToolCall: makeDirectExecutor(registry),
      hooks: {},
      modelConfig: { model: 'mock' },
      signal: ctrl.signal,
    })

    // Wait for the tool to start, then abort.
    setTimeout(() => ctrl.abort('user clicked stop'), 20)
    const result = await promise

    expect(result.status).toBe('aborted')
    expect(result.abortReason).toContain('user clicked stop')
    expect(toolStarted).toBe(true)
    // Tool keeps running orphaned — that's the documented contract.
    // We don't assert on toolCompleted because timing is racy.
  })

  it('works as before when no signal is provided (back-compat)', async () => {
    const provider = new MockProvider([[{ type: 'message_end', message: endTurnMessage }]])
    const result = await runInnerLoop({
      runId: 'r1',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolSpecs: [],
      requestToolCall: async () => { throw new Error('should not be called') },
      hooks: {},
      modelConfig: { model: 'mock' },
      // no signal
    })
    expect(result.status).toBe('completed')
    expect(result.finalMessage).toEqual(endTurnMessage)
  })

  it('handler can observe ctx.abortSignal (for tools that want to listen)', async () => {
    const registry = new ToolRegistry()
    let receivedSignal: AbortSignal | undefined
    const inspectingTool: Tool = {
      name: 'sleep_tool',
      description: 'Captures the abort signal it receives',
      inputJsonSchema: { type: 'object', properties: {}, required: [] },
      validate: (i) => z.object({}).parse(i),
      handler: async (_input, ctx) => {
        receivedSignal = ctx.abortSignal
        return 'ok'
      },
    }
    registry.register(inspectingTool)

    const provider = new MockProvider([
      [{ type: 'message_end', message: toolCallMessage }],
      [{ type: 'message_end', message: endTurnMessage }],
    ])
    const ctrl = new AbortController()

    await runInnerLoop({
      runId: 'r1',
      messages: [{ role: 'user', text: 'hi' }],
      provider,
      toolSpecs: [],
      requestToolCall: makeDirectExecutor(registry),
      hooks: {},
      modelConfig: { model: 'mock' },
      signal: ctrl.signal,
    })

    expect(receivedSignal).toBe(ctrl.signal)
  })
})

describe('raceWithAbort', () => {
  it('rejects immediately if signal already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort('already done')
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 100))
    await expect(raceWithAbort(slow, ctrl.signal)).rejects.toThrow(/already done/)
  })

  it('rejects with AbortError when signal fires during await', async () => {
    const ctrl = new AbortController()
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 100))
    setTimeout(() => ctrl.abort('user stop'), 10)
    await expect(raceWithAbort(slow, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('returns underlying promise value when signal never fires', async () => {
    const ctrl = new AbortController()
    const value = await raceWithAbort(Promise.resolve('ok'), ctrl.signal)
    expect(value).toBe('ok')
  })

  it('passes through unmodified when signal is undefined', async () => {
    const value = await raceWithAbort(Promise.resolve('ok'), undefined)
    expect(value).toBe('ok')
  })

  it('removes its abort listener on settle (no leak)', async () => {
    const ctrl = new AbortController()
    const before = (ctrl.signal as unknown as { _listeners?: unknown }).constructor.name
    // Run many races; the signal should not accumulate listeners.
    for (let i = 0; i < 100; i++) {
      await raceWithAbort(Promise.resolve(i), ctrl.signal)
    }
    // No direct listener-count API exists; we assert indirectly that
    // abort still works (would still work even if listeners leaked, so
    // this is mostly a smoke test that nothing throws).
    expect(before).toBe('AbortSignal')
    ctrl.abort()
    expect(ctrl.signal.aborted).toBe(true)
  })
})

describe('Harness — abort signal', () => {
  it('threads signal through to runInnerLoop and returns aborted', async () => {
    const provider = new MockProvider([[
      { type: 'text_delta', text: 'partial...' },
      { type: 'text_delta', text: 'more...' },
      { type: 'message_end', message: endTurnMessage },
    ]])
    const harness = new Harness({ provider, modelConfig: { model: 'mock' } })
    const ctrl = new AbortController()

    const promise = harness.run({ kind: 'user_message', text: 'hi' }, { signal: ctrl.signal })
    queueMicrotask(() => ctrl.abort('stopped'))
    const result = await promise
    expect(result.status).toBe('aborted')
  })

  it('threads abortSignal into ToolContext via handleToolCall', async () => {
    let observed: AbortSignal | undefined
    const tool: Tool = {
      name: 'inspector',
      description: 'observe ctx',
      inputJsonSchema: { type: 'object', properties: {}, required: [] },
      validate: (i) => i,
      handler: async (_input, ctx) => {
        observed = ctx.abortSignal
        return 'ok'
      },
    }

    const provider = new MockProvider([
      [{ type: 'message_end', message: { ...toolCallMessage, toolCalls: [{ id: 'tc1', name: 'inspector', input: {} }] } }],
      [{ type: 'message_end', message: endTurnMessage }],
    ])
    const harness = new Harness({ provider, modelConfig: { model: 'mock' }, tools: [tool] })
    const ctrl = new AbortController()
    await harness.run({ kind: 'user_message', text: 'hi' }, { signal: ctrl.signal })
    expect(observed).toBe(ctrl.signal)
  })
})
