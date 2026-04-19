import { describe, it, expect, assertType } from 'vitest'
import type {
  Message, SystemMessage, UserMessage, AssistantMessage, ToolResultMessage,
  ToolCall, StopReason, Usage,
} from '../src/messages.js'

describe('messages', () => {
  it('allows constructing every message variant', () => {
    const sys: SystemMessage = { role: 'system', text: 'you are a helpful agent' }
    const user: UserMessage = { role: 'user', text: 'hello' }
    const assistant: AssistantMessage = {
      role: 'assistant',
      text: 'hi there',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    }
    const toolResult: ToolResultMessage = {
      role: 'tool',
      toolCallId: 'call_1',
      content: 'ok',
      isError: false,
    }

    const msgs: Message[] = [sys, user, assistant, toolResult]
    expect(msgs).toHaveLength(4)
  })

  it('ToolCall carries id, name, input', () => {
    const call: ToolCall = { id: 'call_1', name: 'bash', input: { command: 'ls' } }
    expect(call.id).toBe('call_1')
    expect(call.name).toBe('bash')
  })

  it('StopReason is a finite union', () => {
    const reasons: StopReason[] = ['end_turn', 'tool_use', 'max_tokens', 'safety', 'error']
    expect(reasons).toHaveLength(5)
  })
})
