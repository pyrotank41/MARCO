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

// Metadata attached to synthesized system messages so consumers can
// distinguish them from user-provided ones in `result.messages` without
// threading separate stream-event tracking through their persistence layer.
//
// Currently the only kind is 'compaction' (set by marco-agent's
// performCompaction when it folds the prefix into a summary). Future kinds
// could include 'tool-output-truncation', 'safety-redaction', etc.
export type SystemMessageMeta = {
  kind: 'compaction'
  // Number of original messages that were collapsed into this summary.
  messagesRemoved: number
  // Output tokens spent on the summary call.
  summaryTokens: number
}

export type SystemMessage = {
  role: 'system'
  text: string
  // Optional. Set on synthesized system messages (e.g. compaction summary).
  // Plain user-provided system prompts leave this undefined.
  meta?: SystemMessageMeta
}

export type UserMessage = {
  role: 'user'
  text: string
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
}

export type ToolResultMessage = {
  role: 'tool'
  toolCallId: string
  content: string
  isError: boolean
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage
