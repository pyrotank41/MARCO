// Multimodal content-part translation tests for both providers.
//
// We exercise the translator functions indirectly by capturing the
// `messages` payload each provider's stream() sends to its underlying
// transport (the Anthropic SDK client or the fetch impl). Both
// providers expose hooks for this (custom client / custom fetch), so
// no monkey-patching is needed.

import { describe, it, expect } from 'vitest'
import { AnthropicProvider, type AnthropicMessagesClient } from '../../src/providers/anthropic.js'
import { OpenAICompatibleProvider } from '../../src/providers/openai-compatible.js'
import type { Message, UserMessage, UserMessageContentPart } from '../../src/messages.js'

type CapturedAnthropic = {
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>
  system?: string
}

function captureAnthropic(): {
  client: AnthropicMessagesClient
  captured: CapturedAnthropic | null
} {
  let captured: CapturedAnthropic | null = null
  const client: AnthropicMessagesClient = {
    messages: {
      stream(args) {
        captured = { messages: args.messages, system: args.system }
        // Return an empty event stream. We only care about the request payload.
        return (async function* () {})() as AsyncIterable<unknown>
      },
    },
  }
  return { client, get captured() { return captured } } as {
    client: AnthropicMessagesClient
    captured: CapturedAnthropic | null
  }
}

function captureOpenAIFetch(): {
  fetch: typeof globalThis.fetch
  getBody: () => Record<string, unknown> | null
} {
  let body: Record<string, unknown> | null = null
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    // Empty SSE response body so the provider's stream parse loop exits cleanly.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new Response(stream, { status: 200 })
  }
  return { fetch, getBody: () => body }
}

async function drain<T>(it: AsyncIterable<T>): Promise<void> {
  for await (const _ of it) { /* swallow */ }
}

function userWith(content: UserMessageContentPart[]): UserMessage {
  return { role: 'user', text: '(see attachments)', content }
}

// ─────────── Anthropic ───────────

describe('AnthropicProvider — user content parts', () => {
  it('falls back to plain string content when UserMessage.content is absent', async () => {
    const cap = captureAnthropic()
    const provider = new AnthropicProvider({ client: cap.client })
    await drain(
      provider.stream(
        [{ role: 'user', text: 'hello world' }] as Message[],
        [],
        { model: 'claude-sonnet', maxTokens: 100 }
      )
    )
    expect(cap.captured?.messages).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('emits a content array with text + image (url) when content is set', async () => {
    const cap = captureAnthropic()
    const provider = new AnthropicProvider({ client: cap.client })
    await drain(
      provider.stream(
        [
          userWith([
            { type: 'text', text: 'describe this' },
            { type: 'image', source: { kind: 'url', url: 'https://x.test/a.png' } },
          ]),
        ],
        [],
        { model: 'claude-sonnet', maxTokens: 100 }
      )
    )
    expect(cap.captured?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image', source: { type: 'url', url: 'https://x.test/a.png' } },
        ],
      },
    ])
  })

  it('translates base64 images to Anthropic base64 source shape', async () => {
    const cap = captureAnthropic()
    const provider = new AnthropicProvider({ client: cap.client })
    await drain(
      provider.stream(
        [
          userWith([
            { type: 'image', source: { kind: 'base64', mediaType: 'image/png', data: 'ABCD' } },
          ]),
        ],
        [],
        { model: 'claude-sonnet', maxTokens: 100 }
      )
    )
    expect(cap.captured?.messages[0].content).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'ABCD' },
      },
    ])
  })

  it('translates documents (PDFs) to Anthropic document blocks', async () => {
    const cap = captureAnthropic()
    const provider = new AnthropicProvider({ client: cap.client })
    await drain(
      provider.stream(
        [
          userWith([
            { type: 'document', source: { kind: 'url', url: 'https://x.test/c.pdf', filename: 'c.pdf' } },
          ]),
        ],
        [],
        { model: 'claude-sonnet', maxTokens: 100 }
      )
    )
    expect(cap.captured?.messages[0].content).toEqual([
      { type: 'document', source: { type: 'url', url: 'https://x.test/c.pdf' } },
    ])
  })

  it('preserves all part types in declared order', async () => {
    const cap = captureAnthropic()
    const provider = new AnthropicProvider({ client: cap.client })
    await drain(
      provider.stream(
        [
          userWith([
            { type: 'text', text: 'A' },
            { type: 'image', source: { kind: 'url', url: 'https://x/i' } },
            { type: 'document', source: { kind: 'base64', mediaType: 'application/pdf', data: 'XX', filename: 'd.pdf' } },
            { type: 'text', text: 'B' },
          ]),
        ],
        [],
        { model: 'claude-sonnet', maxTokens: 100 }
      )
    )
    const content = cap.captured?.messages[0].content as Array<{ type: string }>
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'document', 'text'])
  })

  it('does NOT emit a content array when content is set to empty (falls back to text)', async () => {
    const cap = captureAnthropic()
    const provider = new AnthropicProvider({ client: cap.client })
    await drain(
      provider.stream(
        [{ role: 'user', text: 'hello', content: [] } as UserMessage],
        [],
        { model: 'claude-sonnet', maxTokens: 100 }
      )
    )
    expect(cap.captured?.messages).toEqual([{ role: 'user', content: 'hello' }])
  })
})

// ─────────── OpenAI-compatible ───────────

describe('OpenAICompatibleProvider — user content parts', () => {
  it('falls back to plain string content when UserMessage.content is absent', async () => {
    const cap = captureOpenAIFetch()
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', fetch: cap.fetch })
    await drain(
      provider.stream(
        [{ role: 'user', text: 'hi' }] as Message[],
        [],
        { model: 'gpt-x', maxTokens: 100 }
      )
    )
    const body = cap.getBody() as { messages: Array<{ role: string; content: unknown }> }
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('emits text + image_url parts for image content', async () => {
    const cap = captureOpenAIFetch()
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', fetch: cap.fetch })
    await drain(
      provider.stream(
        [
          userWith([
            { type: 'text', text: 'whats this' },
            { type: 'image', source: { kind: 'url', url: 'https://x/y.png' } },
          ]),
        ],
        [],
        { model: 'gpt-x', maxTokens: 100 }
      )
    )
    const body = cap.getBody() as { messages: Array<{ role: string; content: unknown }> }
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'whats this' },
          { type: 'image_url', image_url: { url: 'https://x/y.png' } },
        ],
      },
    ])
  })

  it('inlines base64 images as data: URLs', async () => {
    const cap = captureOpenAIFetch()
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', fetch: cap.fetch })
    await drain(
      provider.stream(
        [userWith([{ type: 'image', source: { kind: 'base64', mediaType: 'image/png', data: 'AAAA' } }])],
        [],
        { model: 'gpt-x', maxTokens: 100 }
      )
    )
    const body = cap.getBody() as { messages: Array<{ role: string; content: Array<{ type: string; image_url?: { url: string } }> }> }
    expect(body.messages[0].content[0].type).toBe('image_url')
    expect(body.messages[0].content[0].image_url?.url).toBe('data:image/png;base64,AAAA')
  })

  it('degrades documents to text mentions (OpenAI Chat has no document type)', async () => {
    const cap = captureOpenAIFetch()
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', fetch: cap.fetch })
    await drain(
      provider.stream(
        [
          userWith([
            { type: 'document', source: { kind: 'url', url: 'https://x/d.pdf', filename: 'd.pdf' } },
          ]),
        ],
        [],
        { model: 'gpt-x', maxTokens: 100 }
      )
    )
    const body = cap.getBody() as { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }
    expect(body.messages[0].content[0].type).toBe('text')
    expect(body.messages[0].content[0].text).toMatch(/d\.pdf/)
    expect(body.messages[0].content[0].text).toMatch(/https:\/\/x\/d\.pdf/)
    expect(body.messages[0].content[0].text).toMatch(/not natively/)
  })

  it('passes plain text through to a text part', async () => {
    const cap = captureOpenAIFetch()
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', fetch: cap.fetch })
    await drain(
      provider.stream(
        [userWith([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }])],
        [],
        { model: 'gpt-x', maxTokens: 100 }
      )
    )
    const body = cap.getBody() as { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }
    expect(body.messages[0].content.map((p) => p.text)).toEqual(['first', 'second'])
  })
})
