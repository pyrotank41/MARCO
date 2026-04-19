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
