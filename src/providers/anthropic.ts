// MARCO — AnthropicProvider. Normalizes Anthropic SDK events to MARCO's canonical ChunkEvent shape.

import Anthropic from '@anthropic-ai/sdk'
import type { ChunkEvent, ModelConfig, ModelProvider, ToolSpec } from '../provider.js'
import type {
  AssistantMessage, Message, StopReason, ToolCall, Usage,
} from '../messages.js'

export interface AnthropicMessagesClient {
  messages: {
    stream(args: {
      model: string
      max_tokens: number
      temperature?: number
      system?: string
      messages: Array<{
        role: 'user' | 'assistant'
        content: unknown
      }>
      tools?: Array<{ name: string; description: string; input_schema: unknown }>
    }): AsyncIterable<unknown>
  }
}

export type AnthropicProviderOptions = {
  apiKey?: string
  client?: AnthropicMessagesClient
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
  ): AsyncIterable<ChunkEvent> {
    const { system, apiMessages } = toAnthropicMessages(messages, config.systemPrompt)

    const sdkStream = this.client.messages.stream({
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
    })

    // Stream-local state: track the most recent tool block id so input_json_delta
    // and content_block_stop events can be matched back to their tool call.
    let lastToolId: string | undefined

    for await (const rawEvent of sdkStream) {
      const event = rawEvent as Record<string, unknown>
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block as { type: string; id?: string; name?: string }
          if (block.type === 'tool_use' && block.id && block.name) {
            lastToolId = block.id
            yield { type: 'tool_call_start', id: block.id, name: block.name }
          }
          break
        }
        case 'content_block_delta': {
          const delta = event.delta as { type: string; text?: string; partial_json?: string }
          if (delta.type === 'text_delta' && delta.text !== undefined) {
            yield { type: 'text_delta', text: delta.text }
          } else if (delta.type === 'input_json_delta' && delta.partial_json !== undefined && lastToolId) {
            yield { type: 'tool_call_delta', id: lastToolId, inputJson: delta.partial_json }
          }
          break
        }
        case 'content_block_stop': {
          if (lastToolId) {
            yield { type: 'tool_call_end', id: lastToolId }
            lastToolId = undefined
          }
          break
        }
        case 'message_stop': {
          const sdkMessage = event.message as {
            content: Array<Record<string, unknown>>
            stop_reason: string
            usage: { input_tokens: number; output_tokens: number }
          }
          yield { type: 'message_end', message: toAssistantMessage(sdkMessage) }
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
      apiMessages.push({ role: 'user', content: m.text })
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

function toAssistantMessage(sdk: {
  content: Array<Record<string, unknown>>
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}): AssistantMessage {
  const toolCalls: ToolCall[] = []
  let text: string | undefined
  for (const block of sdk.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text = (text ?? '') + block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: String(block.id),
        name: String(block.name),
        input: block.input ?? {},
      })
    }
  }
  const usage: Usage = {
    inputTokens: sdk.usage.input_tokens,
    outputTokens: sdk.usage.output_tokens,
  }
  return {
    role: 'assistant',
    text,
    toolCalls,
    stopReason: mapStopReason(sdk.stop_reason),
    usage,
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
