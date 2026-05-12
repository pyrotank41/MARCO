// MARCO — public API surface.

export { Harness, type HarnessOptions } from './harness.js'

export {
  runInnerLoop,
  type RunInnerLoopInput,
  type RunInnerLoopResult,
} from './innerLoop.js'

export { ToolRegistry, type Tool, type ToolContext, type PermissionLevel } from './tools.js'

export type {
  Hooks,
  Trigger,
  OnRunStartInput, OnRunStartOutput,
  BeforeModelCallInput, BeforeModelCallOutput,
  BeforeToolCallInput, BeforeToolCallOutput,
  AfterToolResultInput, AfterToolResultOutput,
  OnRunEndInput,
} from './hooks.js'

export type {
  ModelProvider,
  ModelConfig,
  ChunkEvent,
  ToolSpec,
} from './provider.js'

export type {
  Message,
  SystemMessage,
  MessageMeta,
  UserMessage,
  UserMessageContentPart,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
  StopReason,
  Usage,
} from './messages.js'

export { MockProvider } from './providers/mock.js'
export { AnthropicProvider, type AnthropicProviderOptions } from './providers/anthropic.js'
export { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './providers/openai-compatible.js'
