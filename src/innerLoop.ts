// MARCO — inner loop. The engine: build context, call model, request tool
// execution, accumulate results, decide stop.
//
// Deliberately small. The loop does NOT execute tools itself — it calls
// the `executeToolCall` function supplied by the harness. The loop's
// world is narrow: provider, tool specs (as data), beforeModelCall hook,
// and executeToolCall. Everything else about tools — registry, handlers,
// permission gates, redaction — lives in the harness layer.

import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from './messages.js'
import type { ModelConfig, ModelProvider, ToolSpec } from './provider.js'
import { runHook, type Hooks } from './hooks.js'

export type RunInnerLoopInput = {
  runId: string
  messages: Message[]
  provider: ModelProvider
  toolSpecs: ToolSpec[]
  executeToolCall: (call: ToolCall) => Promise<ToolResultMessage>
  hooks: Pick<Hooks, 'beforeModelCall'>
  modelConfig: ModelConfig
  maxIterations?: number
}

export type RunInnerLoopResult = {
  status: 'completed' | 'aborted' | 'errored'
  finalMessage?: AssistantMessage
  messages: Message[]
  iterations: number
  error?: Error
  abortReason?: string
}

const DEFAULT_MAX_ITERATIONS = 25

export async function runInnerLoop(input: RunInnerLoopInput): Promise<RunInnerLoopResult> {
  const { runId, provider, toolSpecs, executeToolCall, hooks, modelConfig } = input
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS

  let messages: Message[] = [...input.messages]
  let iteration = 0
  let config = modelConfig

  while (iteration < maxIterations) {
    // Phase 1 — apply harness overrides (beforeModelCall hook)
    const harnessOverrides = await runHook(hooks.beforeModelCall, { messages, iteration, runId })
    if (harnessOverrides?.abort) {
      return {
        status: 'aborted',
        messages: harnessOverrides.messages,
        iterations: iteration,
        abortReason: harnessOverrides.abortReason,
      }
    }
    messages = harnessOverrides?.messages ?? messages
    config = harnessOverrides?.modelConfig ?? config

    // Phase 2 — call the model, consume the stream, capture the terminal message
    let assistantMessage: AssistantMessage | undefined
    try {
      for await (const event of provider.stream(messages, toolSpecs, config)) {
        if (event.type === 'message_end') assistantMessage = event.message
      }
    } catch (err) {
      return {
        status: 'errored',
        messages,
        iterations: iteration,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
    if (!assistantMessage) {
      return {
        status: 'errored',
        messages,
        iterations: iteration,
        error: new Error('Provider stream ended without message_end event'),
      }
    }

    messages = [...messages, assistantMessage]
    iteration += 1

    // Phase 3 — route on stop reason
    switch (assistantMessage.stopReason) {
      case 'end_turn':
      case 'max_tokens':
        return { status: 'completed', finalMessage: assistantMessage, messages, iterations: iteration }

      case 'error':
      case 'safety':
        return {
          status: 'errored',
          finalMessage: assistantMessage,
          messages,
          iterations: iteration,
          error: new Error(`stopReason=${assistantMessage.stopReason}`),
        }

      case 'tool_use': {
        // Delegate to the harness. The loop never touches a tool directly.
        const toolResults: ToolResultMessage[] = []
        for (const call of assistantMessage.toolCalls) {
          toolResults.push(await executeToolCall(call))
        }
        messages = [...messages, ...toolResults]
        break
      }
    }
  }

  return {
    status: 'aborted',
    messages,
    iterations: iteration,
    abortReason: `exceeded maxIterations (${maxIterations})`,
  }
}
