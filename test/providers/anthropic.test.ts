import { describe, it, expect } from 'vitest'
import { AnthropicProvider, type AnthropicMessagesClient } from '../../src/providers/anthropic.js'
import type { ChunkEvent } from '../../src/provider.js'

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of gen) out.push(x)
  return out
}

/**
 * Fake Anthropic client returning a canned stream of SDK events. The event
 * shapes here match the real SDK: `message_stop` is a bare terminator with
 * no payload; `message_delta` carries the final stop_reason + output_tokens.
 */
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
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [],
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]
    const p = new AnthropicProvider({ client: fakeClient(sdkEvents) })
    const events = await collect(p.stream([{ role: 'user', text: 'hi' }], [], { model: 'claude-sonnet-4-6' }))

    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('text_delta')
    expect(kinds).toContain('message_end')
    const endEvent = events.find((e) => e.type === 'message_end') as Extract<ChunkEvent, { type: 'message_end' }>
    expect(endEvent.message.stopReason).toBe('end_turn')
    expect(endEvent.message.text).toBe('hello')
    expect(endEvent.message.usage).toEqual({ inputTokens: 1, outputTokens: 1 })
  })

  it('translates tool_use SDK events to canonical tool_call_* events and assembles the tool call from partial JSON', async () => {
    const sdkEvents = [
      {
        type: 'message_start',
        message: {
          id: 'msg_2',
          role: 'assistant',
          content: [],
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"ls"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 10 },
      },
      { type: 'message_stop' },
    ]
    const p = new AnthropicProvider({ client: fakeClient(sdkEvents) })
    const events = await collect(p.stream([], [], { model: 'claude-sonnet-4-6' }))

    const kinds = events.map((e) => e.type)
    expect(kinds).toEqual(expect.arrayContaining(['tool_call_start', 'tool_call_delta', 'tool_call_end', 'message_end']))

    const endEvent = events.find((e) => e.type === 'message_end') as Extract<ChunkEvent, { type: 'message_end' }>
    expect(endEvent.message.toolCalls).toHaveLength(1)
    expect(endEvent.message.toolCalls[0]).toEqual({ id: 'toolu_1', name: 'bash', input: { command: 'ls' } })
    expect(endEvent.message.stopReason).toBe('tool_use')
    expect(endEvent.message.usage).toEqual({ inputTokens: 5, outputTokens: 10 })
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
            type: 'message_start',
            message: {
              id: 'x',
              role: 'assistant',
              content: [],
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
          {
            type: 'message_delta',
            delta: { stop_reason: sdkReason },
            usage: { output_tokens: 0 },
          },
          { type: 'message_stop' },
        ]),
      })
      const events = await collect(p.stream([], [], { model: 'claude-sonnet-4-6' }))
      const end = events.find((e) => e.type === 'message_end') as Extract<ChunkEvent, { type: 'message_end' }>
      expect(end.message.stopReason).toBe(canonical)
    }
  })
})
