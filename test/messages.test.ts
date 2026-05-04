import { describe, it, expect, assertType } from 'vitest'
import type {
  Message, SystemMessage, SystemMessageMeta, UserMessage, AssistantMessage, ToolResultMessage,
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

  describe('SystemMessageMeta', () => {
    it('SystemMessage.meta is optional — plain user system prompts leave it unset', () => {
      const plain: SystemMessage = { role: 'system', text: 'you are helpful' }
      expect(plain.meta).toBeUndefined()
    })

    it('SystemMessage accepts compaction meta with summaryUsage', () => {
      const meta: SystemMessageMeta = {
        kind: 'compaction',
        messagesRemoved: 14,
        summaryUsage: { inputTokens: 5000, outputTokens: 100 },
      }
      const msg: SystemMessage = {
        role: 'system',
        text: 'Summary of earlier conversation:\n...',
        meta,
      }
      expect(msg.meta?.kind).toBe('compaction')
      expect(msg.meta?.messagesRemoved).toBe(14)
      expect(msg.meta?.summaryUsage).toEqual({ inputTokens: 5000, outputTokens: 100 })
    })

    it('SystemMessageMeta.summaryUsage reuses the Usage type so cost attribution is consistent', () => {
      const usage: Usage = { inputTokens: 1, outputTokens: 2 }
      const meta: SystemMessageMeta = { kind: 'compaction', messagesRemoved: 1, summaryUsage: usage }
      // Type-level assertion: meta.summaryUsage is assignable to Usage and vice versa
      assertType<Usage>(meta.summaryUsage)
      expect(meta.summaryUsage).toBe(usage)
    })
  })
})
