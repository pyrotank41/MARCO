// MARCO — model provider interface. The loop-to-harness boundary for model calls.

import type { AssistantMessage, Message } from './messages.js'

export type ModelConfig = {
  model: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export type ToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ChunkEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; inputJson: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'message_end'; message: AssistantMessage }

export type StreamOptions = {
  /** Cancel the in-flight model call. Forwarded to the underlying fetch
   *  (or SDK) so the HTTP request is aborted mid-stream — saving tokens
   *  and stopping events from being yielded further. */
  signal?: AbortSignal
}

export interface ModelProvider {
  stream(
    messages: Message[],
    tools: ToolSpec[],
    config: ModelConfig,
    options?: StreamOptions,
  ): AsyncIterable<ChunkEvent>
}
