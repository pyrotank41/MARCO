import { describe, it, expect } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/providers/openai-compatible.js'
import type { ChunkEvent } from '../../src/provider.js'

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f))
      controller.close()
    },
  })
}

function fakeFetch(frames: string[], status = 200): typeof globalThis.fetch {
  return (async () => new Response(sseStream(frames), {
    status,
    headers: { 'content-type': 'text/event-stream' },
  })) as typeof globalThis.fetch
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

async function collect(iter: AsyncIterable<ChunkEvent>): Promise<ChunkEvent[]> {
  const out: ChunkEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

const baseConfig = { model: 'test-model' as const, maxTokens: 100 }

describe('OpenAICompatibleProvider', () => {
  it('streams text deltas and emits message_end with usage + stopReason', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test',
      fetch: fakeFetch([
        frame({ choices: [{ delta: { role: 'assistant' } }] }),
        frame({ choices: [{ delta: { content: 'Hello' } }] }),
        frame({ choices: [{ delta: { content: ' world' } }] }),
        frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        'data: [DONE]\n\n',
      ]),
    })

    const events = await collect(provider.stream([{ role: 'user', text: 'hi' }], [], baseConfig))

    const texts = events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text)
    expect(texts.join('')).toBe('Hello world')

    const end = events.find((e) => e.type === 'message_end')!
    expect(end).toBeDefined()
    if (end.type !== 'message_end') throw new Error('expected message_end')
    expect(end.message.text).toBe('Hello world')
    expect(end.message.stopReason).toBe('end_turn')
    expect(end.message.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(end.message.toolCalls).toEqual([])
  })

  it('assembles streamed tool calls and emits start/delta/end + tool_use stop reason', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test',
      fetch: fakeFetch([
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }] }),
        frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 8, completion_tokens: 3 } }),
        'data: [DONE]\n\n',
      ]),
    })

    const events = await collect(provider.stream([{ role: 'user', text: 'go' }], [
      { name: 'search', description: 's', inputSchema: { type: 'object' } },
    ], baseConfig))

    const types = events.map((e) => e.type)
    expect(types).toContain('tool_call_start')
    expect(types).toContain('tool_call_delta')
    expect(types).toContain('tool_call_end')

    const end = events.find((e) => e.type === 'message_end')!
    if (end.type !== 'message_end') throw new Error('expected message_end')
    expect(end.message.stopReason).toBe('tool_use')
    expect(end.message.toolCalls).toHaveLength(1)
    expect(end.message.toolCalls[0]).toEqual({ id: 'call_1', name: 'search', input: { q: 'hi' } })
  })

  it('uses Bearer auth header when apiKey is set', async () => {
    let seenAuth: string | null = null
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get('authorization')
      return new Response(sseStream([
        frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ]), { status: 200 })
    }) as typeof globalThis.fetch
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-xyz', fetch })
    await collect(provider.stream([{ role: 'user', text: 'hi' }], [], baseConfig))
    expect(seenAuth).toBe('Bearer sk-xyz')
  })

  it('honors custom baseURL (OpenRouter pattern) and extra headers', async () => {
    let seenUrl: string | null = null
    let seenReferer: string | null = null
    const fetch = (async (url: unknown, init?: RequestInit) => {
      seenUrl = String(url)
      seenReferer = new Headers(init?.headers).get('http-referer')
      return new Response(sseStream(['data: [DONE]\n\n']), { status: 200 })
    }) as typeof globalThis.fetch
    const provider = new OpenAICompatibleProvider({
      apiKey: 'or-xyz',
      baseURL: 'https://openrouter.ai/api/v1',
      headers: { 'HTTP-Referer': 'https://crystallio.app' },
      fetch,
    })
    await collect(provider.stream([{ role: 'user', text: 'hi' }], [], { ...baseConfig, model: 'deepseek/deepseek-chat' }))
    expect(seenUrl).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(seenReferer).toBe('https://crystallio.app')
  })

  it('translates canonical Message[] to OpenAI shape and includes tool results', async () => {
    let seenBody: { messages: unknown[]; tools?: unknown[] } | null = null
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      seenBody = JSON.parse((init?.body as string) ?? '{}')
      return new Response(sseStream(['data: [DONE]\n\n']), { status: 200 })
    }) as typeof globalThis.fetch
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', fetch })
    await collect(provider.stream([
      { role: 'system', text: 'You are X.' },
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'thinking', toolCalls: [{ id: 'c1', name: 'search', input: { q: 'foo' } }], stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      { role: 'tool', toolCallId: 'c1', content: 'result text', isError: false },
    ], [], { ...baseConfig, systemPrompt: 'Be concise.' }))

    expect(seenBody!.messages).toEqual([
      { role: 'system', content: 'Be concise.\n\nYou are X.' },
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: 'thinking',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"foo"}' } }],
      },
      { role: 'tool', content: 'result text', tool_call_id: 'c1' },
    ])
  })

  it('maps finish_reason variants to canonical StopReason', async () => {
    async function runWith(reason: string): Promise<string> {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        fetch: fakeFetch([
          frame({ choices: [{ delta: {}, finish_reason: reason }] }),
          'data: [DONE]\n\n',
        ]),
      })
      const events = await collect(provider.stream([{ role: 'user', text: 'hi' }], [], baseConfig))
      const end = events.find((e) => e.type === 'message_end')!
      if (end.type !== 'message_end') throw new Error('expected message_end')
      return end.message.stopReason
    }
    expect(await runWith('stop')).toBe('end_turn')
    expect(await runWith('length')).toBe('max_tokens')
    expect(await runWith('tool_calls')).toBe('tool_use')
    expect(await runWith('content_filter')).toBe('safety')
  })

  it('surfaces non-2xx HTTP as Error with status', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      fetch: (async () => new Response('forbidden', { status: 403 })) as typeof globalThis.fetch,
    })
    await expect(collect(provider.stream([{ role: 'user', text: 'hi' }], [], baseConfig)))
      .rejects.toThrow(/HTTP 403/)
  })

  it('strips trailing slash from baseURL', async () => {
    let seenUrl: string | null = null
    const fetch = (async (url: unknown) => {
      seenUrl = String(url)
      return new Response(sseStream(['data: [DONE]\n\n']), { status: 200 })
    }) as typeof globalThis.fetch
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', baseURL: 'https://api.example.com/v1/', fetch })
    await collect(provider.stream([{ role: 'user', text: 'hi' }], [], baseConfig))
    expect(seenUrl).toBe('https://api.example.com/v1/chat/completions')
  })
})
