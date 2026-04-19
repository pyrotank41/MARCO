import { describe, it, expect } from 'vitest'
import { AnthropicProvider, type AnthropicMessagesClient } from '../../src/providers/anthropic.js'
import type { ChunkEvent } from '../../src/provider.js'

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of gen) out.push(x)
  return out
}

function fakeClient(events: unknown[]): AnthropicMessagesClient {
  return {
    messages: {
      async *stream() {
        for (const e of events) yield e as never
      },
    },
  } as unknown as AnthropicMessagesClient
}

describe('AnthropicProvider', () => {
  it('translates text_delta SDK events to canonical text_delta events', async () => {
    const sdkEvents = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_stop',
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ]
    const p = new AnthropicProvider({ client: fakeClient(sdkEvents) })
    const events = await collect(p.stream([{ role: 'user', text: 'hi' }], [], { model: 'claude-sonnet-4-6' }))

    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('text_delta')
    expect(kinds).toContain('message_end')
    const endEvent = events.find((e) => e.type === 'message_end') as Extract<ChunkEvent, { type: 'message_end' }>
    expect(endEvent.message.stopReason).toBe('end_turn')
    expect(endEvent.message.text).toBe('hello')
  })

  it('translates tool_use SDK events to canonical tool_call_* events', async () => {
    const sdkEvents = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_stop',
        message: {
          id: 'msg_2',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 5, output_tokens: 10 },
        },
      },
    ]
    const p = new AnthropicProvider({ client: fakeClient(sdkEvents) })
    const events = await collect(p.stream([], [], { model: 'claude-sonnet-4-6' }))
    const kinds = events.map((e) => e.type)
    expect(kinds).toEqual(expect.arrayContaining(['tool_call_start', 'tool_call_delta', 'tool_call_end', 'message_end']))
    const endEvent = events.find((e) => e.type === 'message_end') as Extract<ChunkEvent, { type: 'message_end' }>
    expect(endEvent.message.toolCalls).toHaveLength(1)
    expect(endEvent.message.toolCalls[0]).toEqual({ id: 'toolu_1', name: 'bash', input: { command: 'ls' } })
    expect(endEvent.message.stopReason).toBe('tool_use')
  })

  it('maps Anthropic stop_reason values to canonical StopReason', async () => {
    const cases: Array<[string, string]> = [
      ['end_turn', 'end_turn'],
      ['tool_use', 'tool_use'],
      ['max_tokens', 'max_tokens'],
      ['stop_sequence', 'end_turn'],
    ]
    for (const [sdkReason, canonical] of cases) {
      const p = new AnthropicProvider({
        client: fakeClient([
          {
            type: 'message_stop',
            message: {
              id: 'x',
              role: 'assistant',
              content: [],
              stop_reason: sdkReason,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
        ]),
      })
      const events = await collect(p.stream([], [], { model: 'claude-sonnet-4-6' }))
      const end = events.find((e) => e.type === 'message_end') as Extract<ChunkEvent, { type: 'message_end' }>
      expect(end.message.stopReason).toBe(canonical)
    }
  })
})
