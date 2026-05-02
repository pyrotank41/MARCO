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

export type SystemMessage = {
  role: 'system'
  text: string
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
