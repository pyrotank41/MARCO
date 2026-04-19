import { describe, it, expect } from 'vitest'
import { MockProvider } from '../../src/providers/mock.js'
import type { ChunkEvent } from '../../src/provider.js'
import type { AssistantMessage } from '../../src/messages.js'

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of gen) out.push(x)
  return out
}

describe('MockProvider', () => {
  it('replays a single scripted turn', async () => {
    const message: AssistantMessage = {
      role: 'assistant',
      text: 'hello',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    }
    const script: ChunkEvent[][] = [
      [{ type: 'text_delta', text: 'hello' }, { type: 'message_end', message }],
    ]
    const p = new MockProvider(script)
    const events = await collect(p.stream([], [], { model: 'mock' }))
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ type: 'message_end', message })
  })

  it('replays multiple turns in order', async () => {
    const m1: AssistantMessage = {
      role: 'assistant', text: '', toolCalls: [
        { id: 'c1', name: 'bash', input: { command: 'ls' } },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    }
    const m2: AssistantMessage = {
      role: 'assistant', text: 'done', toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 2, outputTokens: 2 },
    }
    const p = new MockProvider([
      [{ type: 'message_end', message: m1 }],
      [{ type: 'message_end', message: m2 }],
    ])
    const t1 = await collect(p.stream([], [], { model: 'mock' }))
    const t2 = await collect(p.stream([], [], { model: 'mock' }))
    expect((t1[0] as { message: AssistantMessage }).message.stopReason).toBe('tool_use')
    expect((t2[0] as { message: AssistantMessage }).message.stopReason).toBe('end_turn')
  })

  it('throws when the script is exhausted', async () => {
    const p = new MockProvider([])
    await expect(collect(p.stream([], [], { model: 'mock' }))).rejects.toThrow(/exhausted/)
  })
})
