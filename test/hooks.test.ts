import { describe, it, expect } from 'vitest'
import type {
  Hooks, OnRunStartInput, BeforeModelCallInput, BeforeToolCallInput,
  AfterToolResultInput, OnRunEndInput, Trigger,
} from '../src/hooks.js'
import { runHook } from '../src/hooks.js'
import type { Message, AssistantMessage, ToolCall } from '../src/messages.js'

describe('hooks', () => {
  it('Trigger accepts user message, schedule, event, webhook shapes', () => {
    const t1: Trigger = { kind: 'user_message', text: 'hi', metadata: { userId: 'u1' } }
    const t2: Trigger = { kind: 'schedule', cron: '0 * * * *' }
    const t3: Trigger = { kind: 'event', eventType: 'pr_opened', payload: {} }
    const t4: Trigger = { kind: 'webhook', path: '/hook', payload: {} }
    expect([t1, t2, t3, t4]).toHaveLength(4)
  })

  it('Hooks is a bag of optional async functions', () => {
    const hooks: Hooks = {
      onRunStart: async (i: OnRunStartInput) => ({ allowed: true, messages: i.messages }),
      beforeModelCall: async (i: BeforeModelCallInput) => ({ messages: i.messages }),
      beforeToolCall: async (i: BeforeToolCallInput) => ({ decision: 'execute' }),
      afterToolResult: async (i: AfterToolResultInput) => ({ result: i.result }),
      onRunEnd: async (_i: OnRunEndInput) => {},
    }
    expect(Object.keys(hooks)).toHaveLength(5)
  })

  it('runHook returns undefined when the hook is not defined', async () => {
    const result = await runHook(undefined, { messages: [] } as BeforeModelCallInput)
    expect(result).toBeUndefined()
  })

  it('runHook invokes the hook when defined', async () => {
    const messages: Message[] = [{ role: 'user', text: 'hi' }]
    const hook = async (i: BeforeModelCallInput) => ({ messages: [...i.messages] })
    const result = await runHook(hook, { messages })
    expect(result?.messages).toEqual(messages)
  })

  it('beforeToolCall decision supports execute, deny, short-circuit', () => {
    const toolCall: ToolCall = { id: 'c1', name: 'bash', input: {} }
    const input: BeforeToolCallInput = { toolCall, runId: 'r1' }
    const execute: Awaited<ReturnType<NonNullable<Hooks['beforeToolCall']>>> =
      { decision: 'execute' }
    const deny: Awaited<ReturnType<NonNullable<Hooks['beforeToolCall']>>> =
      { decision: 'deny', reason: 'not allowed' }
    const shortCircuit: Awaited<ReturnType<NonNullable<Hooks['beforeToolCall']>>> =
      { decision: 'short-circuit', result: 'cached' }
    expect([execute, deny, shortCircuit]).toHaveLength(3)
    expect(input).toBeDefined()
  })
})
