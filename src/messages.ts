// MARCO — canonical message types. Provider-agnostic shapes the inner loop uses.

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'safety' | 'error'

export type Usage = {
  inputTokens: number
  outputTokens: number
}

export type ToolCall = {
  id: string
  name: string
  input: unknown
}

// Free-form passthrough slot on any message. The harness NEVER reads, writes,
// or transforms `meta` — it exists purely so libraries and apps that
// synthesize, annotate, or persist messages have a place to attach
// information without needing to extend the canonical message types.
//
// Convention (not enforced): when one layer produces a message and another
// consumes it, use a `kind: string` discriminator so consumers can branch
// reliably. Examples:
//   - marco-agent's performCompaction sets
//       meta = { kind: 'compaction', messagesRemoved, summaryUsage }
//     and exports a type guard for consumers to narrow safely.
//   - An app might set meta = { transport: 'whatsapp', sourceMsgId: '...' }
//     on user messages, or { retried: true, attempt: 2 } on assistants.
//
// Stays optional everywhere; absent / undefined / null carry the same
// meaning. Harness has zero opinion about the contents.
export type MessageMeta = Record<string, unknown>

export type SystemMessage = {
  role: 'system'
  text: string
  meta?: MessageMeta
}

export type UserMessage = {
  role: 'user'
  text: string
  meta?: MessageMeta
}

export type AssistantMessage = {
  role: 'assistant'
  text?: string
  // The model's chain-of-thought, surfaced separately from `text` for
  // reasoning models (DeepSeek R1/V4-Pro, OpenAI o-series, Anthropic
  // extended thinking). Optional — only set when the provider received
  // reasoning content from the upstream model.
  reasoning?: string
  toolCalls: ToolCall[]
  stopReason: StopReason
  usage: Usage
  meta?: MessageMeta
}

export type ToolResultMessage = {
  role: 'tool'
  toolCallId: string
  content: string
  isError: boolean
  meta?: MessageMeta
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage
