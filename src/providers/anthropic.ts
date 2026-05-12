// MARCO — AnthropicProvider. Normalizes Anthropic SDK events to MARCO's canonical ChunkEvent shape.
//
// Real SDK event flow for a streaming message:
//   message_start          → carries initial message shell + input_tokens
//   content_block_start    → per block (text or tool_use); tool_use has id/name
//   content_block_delta    → text_delta or input_json_delta
//   content_block_stop     → block terminator (index only, no payload)
//   message_delta          → carries final stop_reason + final output_tokens
//   message_stop           → terminator only — NO message payload
//
// We accumulate state across these events and yield a single `message_end`
// ChunkEvent when `message_stop` fires.

import Anthropic from '@anthropic-ai/sdk'
import type { ChunkEvent, ModelConfig, ModelProvider, StreamOptions, ToolSpec } from '../provider.js'
import type { Message, StopReason, ToolCall, UserMessageContentPart } from '../messages.js'

export interface AnthropicMessagesClient {
  messages: {
    stream(
      args: {
        model: string
        max_tokens: number
        temperature?: number
        system?: string
        messages: Array<{
          role: 'user' | 'assistant'
          content: unknown
        }>
        tools?: Array<{ name: string; description: string; input_schema: unknown }>
      },
      options?: { signal?: AbortSignal },
    ): AsyncIterable<unknown>
  }
}

export type AnthropicProviderOptions = {
  apiKey?: string
  client?: AnthropicMessagesClient
}

type ToolCallBuilder = {
  id: string
  name: string
  inputJsonParts: string[]
}

export class AnthropicProvider implements ModelProvider {
  private readonly client: AnthropicMessagesClient

  constructor(opts: AnthropicProviderOptions = {}) {
    if (opts.client) {
      this.client = opts.client
    } else {
      this.client = new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicMessagesClient
    }
  }

  async *stream(
    messages: Message[],
    tools: ToolSpec[],
    config: ModelConfig,
    options?: StreamOptions,
  ): AsyncIterable<ChunkEvent> {
    const { system, apiMessages } = toAnthropicMessages(messages, config.systemPrompt)

    // Forward the signal to the Anthropic SDK so the underlying HTTP
    // request is aborted mid-stream when the caller cancels.
    const sdkStream = this.client.messages.stream(
      {
        model: config.model,
        max_tokens: config.maxTokens ?? 4096,
        temperature: config.temperature,
        system,
        messages: apiMessages,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      },
      options?.signal ? { signal: options.signal } : undefined,
    )

    let accumulatedText: string | undefined
    const accumulatedToolCalls: ToolCall[] = []
    const toolCallBuilders = new Map<number, ToolCallBuilder>()
    let stopReason = 'end_turn'
    let inputTokens = 0
    let outputTokens = 0

    for await (const rawEvent of sdkStream) {
      const event = rawEvent as Record<string, unknown>

      switch (event.type) {
        case 'message_start': {
          const msg = event.message as {
            usage?: { input_tokens?: number; output_tokens?: number }
          } | undefined
          if (msg?.usage?.input_tokens !== undefined) inputTokens = msg.usage.input_tokens
          if (msg?.usage?.output_tokens !== undefined) outputTokens = msg.usage.output_tokens
          break
        }

        case 'content_block_start': {
          const index = event.index as number
          const block = event.content_block as {
            type: string
            id?: string
            name?: string
          }
          if (block.type === 'tool_use' && block.id && block.name) {
            toolCallBuilders.set(index, { id: block.id, name: block.name, inputJsonParts: [] })
            yield { type: 'tool_call_start', id: block.id, name: block.name }
          }
          break
        }

        case 'content_block_delta': {
          const index = event.index as number
          const delta = event.delta as {
            type: string
            text?: string
            partial_json?: string
          }
          if (delta.type === 'text_delta' && delta.text !== undefined) {
            accumulatedText = (accumulatedText ?? '') + delta.text
            yield { type: 'text_delta', text: delta.text }
          } else if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) {
            const builder = toolCallBuilders.get(index)
            if (builder) {
              builder.inputJsonParts.push(delta.partial_json)
              yield { type: 'tool_call_delta', id: builder.id, inputJson: delta.partial_json }
            }
          }
          break
        }

        case 'content_block_stop': {
          const index = event.index as number
          const builder = toolCallBuilders.get(index)
          if (builder) {
            yield { type: 'tool_call_end', id: builder.id }
            const inputJson = builder.inputJsonParts.join('')
            let input: unknown = {}
            if (inputJson.trim()) {
              try {
                input = JSON.parse(inputJson)
              } catch {
                input = {}
              }
            }
            accumulatedToolCalls.push({ id: builder.id, name: builder.name, input })
            toolCallBuilders.delete(index)
          }
          break
        }

        case 'message_delta': {
          const delta = event.delta as { stop_reason?: string } | undefined
          if (delta?.stop_reason) stopReason = delta.stop_reason
          const usage = event.usage as { output_tokens?: number } | undefined
          if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens
          break
        }

        case 'message_stop': {
          yield {
            type: 'message_end',
            message: {
              role: 'assistant',
              text: accumulatedText,
              toolCalls: accumulatedToolCalls,
              stopReason: mapStopReason(stopReason),
              usage: { inputTokens, outputTokens },
            },
          }
          break
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */

function toAnthropicMessages(
  messages: Message[],
  fallbackSystem?: string,
): { system?: string; apiMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> } {
  const systemParts: string[] = []
  if (fallbackSystem) systemParts.push(fallbackSystem)

  const apiMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.text)
    } else if (m.role === 'user') {
      if (m.content && m.content.length > 0) {
        apiMessages.push({
          role: 'user',
          content: m.content.map(userPartToAnthropicBlock),
        })
      } else {
        apiMessages.push({ role: 'user', content: m.text })
      }
    } else if (m.role === 'assistant') {
      const content: Array<Record<string, unknown>> = []
      if (m.text) content.push({ type: 'text', text: m.text })
      for (const call of m.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
      }
      apiMessages.push({ role: 'assistant', content })
    } else if (m.role === 'tool') {
      apiMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: m.content,
            is_error: m.isError,
          },
        ],
      })
    }
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    apiMessages,
  }
}

function userPartToAnthropicBlock(part: UserMessageContentPart): Record<string, unknown> {
  // Anthropic's content blocks: { type: 'text' | 'image' | 'document', ... }.
  // Image source can be { type: 'url' | 'base64', ... }; same for document.
  // We map our internal `kind: 'url' | 'base64'` onto Anthropic's `type` key.
  if (part.type === 'text') {
    return { type: 'text', text: part.text }
  }
  if (part.type === 'image') {
    if (part.source.kind === 'url') {
      return { type: 'image', source: { type: 'url', url: part.source.url } }
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.source.mediaType,
        data: part.source.data,
      },
    }
  }
  // document
  if (part.source.kind === 'url') {
    return { type: 'document', source: { type: 'url', url: part.source.url } }
  }
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: part.source.mediaType,
      data: part.source.data,
    },
  }
}

function mapStopReason(sdk: string): StopReason {
  switch (sdk) {
    case 'end_turn': return 'end_turn'
    case 'tool_use': return 'tool_use'
    case 'max_tokens': return 'max_tokens'
    case 'stop_sequence': return 'end_turn'
    default: return 'error'
  }
}
