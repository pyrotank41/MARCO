import { describe, it, expect } from 'vitest'
import type {
  Message, SystemMessage, UserMessage, AssistantMessage, ToolResultMessage,
  MessageMeta, ToolCall, StopReason,
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

  describe('MessageMeta — opaque passthrough slot on every message', () => {
    it('meta is optional on every variant; plain messages leave it undefined', () => {
      const sys: SystemMessage = { role: 'system', text: 'plain' }
      const user: UserMessage = { role: 'user', text: 'plain' }
      const assistant: AssistantMessage = {
        role: 'assistant', text: 'plain', toolCalls: [], stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
      const tool: ToolResultMessage = { role: 'tool', toolCallId: 'x', content: '', isError: false }

      expect(sys.meta).toBeUndefined()
      expect(user.meta).toBeUndefined()
      expect(assistant.meta).toBeUndefined()
      expect(tool.meta).toBeUndefined()
    })

    it('accepts arbitrary keys on any message — harness has no opinion about contents', () => {
      // System: marco-agent compaction shape
      const sysMeta: MessageMeta = {
        kind: 'compaction',
        messagesRemoved: 14,
        summaryUsage: { inputTokens: 5000, outputTokens: 100 },
      }
      const sys: SystemMessage = { role: 'system', text: 'Summary...', meta: sysMeta }

      // User: an app-level transport tag
      const user: UserMessage = {
        role: 'user', text: 'hi',
        meta: { transport: 'whatsapp', sourceMsgId: 'wa_abc123' },
      }

      // Assistant: an app-level retry annotation
      const assistant: AssistantMessage = {
        role: 'assistant', text: 'hi back', toolCalls: [], stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        meta: { retried: true, attempt: 2 },
      }

      // Tool: an app-level truncation marker
      const tool: ToolResultMessage = {
        role: 'tool', toolCallId: 'x', content: 'first 1KB...', isError: false,
        meta: { truncated: true, originalBytes: 8192 },
      }

      // Convention check: kind discriminator works for branching
      expect(sys.meta?.kind).toBe('compaction')
      expect(user.meta?.transport).toBe('whatsapp')
      expect(assistant.meta?.attempt).toBe(2)
      expect(tool.meta?.truncated).toBe(true)
    })

    it('MessageMeta is structurally Record<string, unknown> — anything assignable', () => {
      const m1: MessageMeta = {}
      const m2: MessageMeta = { foo: 1, bar: 'x', baz: { nested: true } }
      const m3: MessageMeta = { kind: 'whatever-future-thing' }
      expect([m1, m2, m3]).toHaveLength(3)
    })
  })
})
