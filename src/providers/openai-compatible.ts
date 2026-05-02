// MARCO — OpenAICompatibleProvider. Speaks the OpenAI Chat Completions
// streaming format, which is the de facto standard for OpenRouter, Together,
// Groq, vLLM, LM Studio, Fireworks, DeepSeek's direct API, OpenAI itself,
// and anything else that ships an /v1/chat/completions endpoint.
//
// Streaming chunk flow (SSE, one JSON object per `data:` frame):
//   {"choices":[{"delta":{"role":"assistant"}}]}
//   {"choices":[{"delta":{"content":"hi"}}]}
//   {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"...","function":{"name":"...","arguments":""}}]}}]}
//   {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q"}}]}}]}
//   {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{...}}
//   data: [DONE]
//
// Tool-call arguments arrive as a stream of string fragments keyed by `index`
// — we accumulate per-index and parse the JSON once finished.
//
// Usage: requires `stream_options: { include_usage: true }` so the final
// chunk carries prompt_tokens + completion_tokens. Most OpenAI-compatible
// providers honor this; OpenAI itself, OpenRouter, Together, Groq, all do.

import type { ChunkEvent, ModelConfig, ModelProvider, ToolSpec } from '../provider.js'
import type { Message, StopReason, ToolCall } from '../messages.js'

export type OpenAICompatibleProviderOptions = {
  apiKey?: string
  // Defaults to OpenAI's API. Override for OpenRouter
  // ('https://openrouter.ai/api/v1'), Together, Groq, etc.
  baseURL?: string
  // Extra headers — OpenRouter uses HTTP-Referer and X-Title for app rankings.
  headers?: Record<string, string>
  // Override fetch for testing or custom transports.
  fetch?: typeof globalThis.fetch
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly headers: Record<string, string>
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(opts: OpenAICompatibleProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.headers = opts.headers ?? {}
    const f = opts.fetch ?? globalThis.fetch
    if (!f) throw new Error('OpenAICompatibleProvider: no fetch available')
    this.fetchImpl = f
  }

  async *stream(messages: Message[], tools: ToolSpec[], config: ModelConfig): AsyncIterable<ChunkEvent> {
    const apiMessages = toOpenAIMessages(messages, config.systemPrompt)
    const body: Record<string, unknown> = {
      model: config.model,
      messages: apiMessages,
      max_tokens: config.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (config.temperature !== undefined) body.temperature = config.temperature
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
    }

    const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey && { authorization: `Bearer ${this.apiKey}` }),
        ...this.headers,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`OpenAI-compatible HTTP ${res.status}: ${await res.text()}`)
    if (!res.body) throw new Error('OpenAI-compatible: no response body')

    let accumulatedText: string | undefined
    let accumulatedReasoning: string | undefined
    const toolCallBuilders = new Map<number, { id: string; name: string; argParts: string[] }>()
    const emittedStartIds = new Set<number>()
    let stopReason: StopReason = 'end_turn'
    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of parseSseChunks(res.body)) {
      const choice = chunk.choices?.[0]

      if (choice?.delta?.content) {
        accumulatedText = (accumulatedText ?? '') + choice.delta.content
        yield { type: 'text_delta', text: choice.delta.content }
      }

      // Reasoning content from chain-of-thought models (DeepSeek R1/V4-Pro,
      // OpenAI o-series via OpenRouter, etc.). Different providers use
      // different field names — accept both.
      const reasoningChunk = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
      if (reasoningChunk) {
        accumulatedReasoning = (accumulatedReasoning ?? '') + reasoningChunk
        yield { type: 'reasoning_delta', text: reasoningChunk }
      }

      if (choice?.delta?.tool_calls) {
        for (const td of choice.delta.tool_calls) {
          const idx = td.index
          let builder = toolCallBuilders.get(idx)
          if (!builder) {
            builder = { id: td.id ?? '', name: td.function?.name ?? '', argParts: [] }
            toolCallBuilders.set(idx, builder)
          }
          if (td.id && !builder.id) builder.id = td.id
          if (td.function?.name && !builder.name) builder.name = td.function.name
          if (td.function?.arguments) builder.argParts.push(td.function.arguments)

          if (builder.id && builder.name && !emittedStartIds.has(idx)) {
            emittedStartIds.add(idx)
            yield { type: 'tool_call_start', id: builder.id, name: builder.name }
          }
          if (td.function?.arguments && emittedStartIds.has(idx)) {
            yield { type: 'tool_call_delta', id: builder.id, inputJson: td.function.arguments }
          }
        }
      }

      if (choice?.finish_reason) {
        stopReason = mapStopReason(choice.finish_reason)
        for (const idx of emittedStartIds) {
          const b = toolCallBuilders.get(idx)
          if (b) yield { type: 'tool_call_end', id: b.id }
        }
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0
        outputTokens = chunk.usage.completion_tokens ?? 0
      }
    }

    const toolCalls: ToolCall[] = []
    for (const [, b] of toolCallBuilders) {
      const inputJson = b.argParts.join('')
      let input: unknown = {}
      try { input = inputJson ? JSON.parse(inputJson) : {} } catch { input = { _raw: inputJson } }
      toolCalls.push({ id: b.id, name: b.name, input })
    }

    yield {
      type: 'message_end',
      message: {
        role: 'assistant',
        ...(accumulatedText !== undefined && { text: accumulatedText }),
        ...(accumulatedReasoning !== undefined && { reasoning: accumulatedReasoning }),
        toolCalls,
        stopReason,
        usage: { inputTokens, outputTokens },
      },
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; content: string; tool_call_id: string }

function toOpenAIMessages(messages: Message[], systemPrompt?: string): OpenAIMessage[] {
  const systemParts: string[] = []
  if (systemPrompt) systemParts.push(systemPrompt)
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.text)
  }

  const out: OpenAIMessage[] = []
  if (systemParts.length > 0) out.push({ role: 'system', content: systemParts.join('\n\n') })

  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text })
    } else if (m.role === 'assistant') {
      const msg: Extract<OpenAIMessage, { role: 'assistant' }> = {
        role: 'assistant',
        content: m.text ?? null,
      }
      if (m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }))
      }
      out.push(msg)
    } else if (m.role === 'tool') {
      const content = m.isError ? `Error: ${m.content}` : m.content
      out.push({ role: 'tool', content, tool_call_id: m.toolCallId })
    }
  }
  return out
}

function mapStopReason(reason: string): StopReason {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'tool_calls':
    case 'function_call': return 'tool_use'
    case 'content_filter': return 'safety'
    default: return 'end_turn'
  }
}

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string
      // Reasoning models surface chain-of-thought either as
      // `reasoning_content` (DeepSeek) or `reasoning` (some others).
      reasoning_content?: string
      reasoning?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function* parseSseChunks(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // SSE frames are separated by blank lines
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') return
        if (!payload) continue
        try {
          yield JSON.parse(payload) as StreamChunk
        } catch {
          // ignore unparseable frames; some providers emit keep-alive comments
        }
      }
    }
  }
}
