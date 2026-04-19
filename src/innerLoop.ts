// MARCO — inner loop. The engine: build context, call model, run tools, accumulate, decide stop.
//
// Deliberately small. Every responsibility NOT here belongs to the harness.

import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from './messages.js'
import type { ModelConfig, ModelProvider } from './provider.js'
import type { ToolRegistry } from './tools.js'
import { runHook, type Hooks } from './hooks.js'

export type RunInnerLoopInput = {
  runId: string
  messages: Message[]
  provider: ModelProvider
  toolRegistry: ToolRegistry
  hooks: Hooks
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
  const { runId, provider, toolRegistry, hooks, modelConfig } = input
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
      for await (const event of provider.stream(messages, toolRegistry.toSpecs(), config)) {
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
        const toolResults = await executeToolCalls({
          calls: assistantMessage.toolCalls,
          toolRegistry,
          hooks,
          runId,
        })
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

async function executeToolCalls(args: {
  calls: ToolCall[]
  toolRegistry: ToolRegistry
  hooks: Hooks
  runId: string
}): Promise<ToolResultMessage[]> {
  const { calls, toolRegistry, hooks, runId } = args
  const results: ToolResultMessage[] = []

  for (const call of calls) {
    const harnessDecision = await runHook(hooks.beforeToolCall, { toolCall: call, runId })

    // Short-circuit paths: the harness said don't actually execute
    switch (harnessDecision?.decision) {
      case 'deny':
        results.push({
          role: 'tool',
          toolCallId: call.id,
          content: `Denied: ${harnessDecision.reason}`,
          isError: true,
        })
        continue
      case 'short-circuit':
        results.push({
          role: 'tool',
          toolCallId: call.id,
          content: harnessDecision.result,
          isError: false,
        })
        continue
    }

    // Execute path
    const effectiveInput = harnessDecision?.decision === 'execute' && harnessDecision.input !== undefined
      ? harnessDecision.input
      : call.input

    const tool = toolRegistry.get(call.name)
    if (!tool) {
      results.push({
        role: 'tool',
        toolCallId: call.id,
        content: `Tool "${call.name}" is not registered`,
        isError: true,
      })
      continue
    }

    const started = Date.now()
    let resultContent: string
    let isError = false
    try {
      const validated = tool.validate(effectiveInput)
      resultContent = await tool.handler(validated, { runId })
    } catch (err) {
      isError = true
      resultContent = err instanceof Error ? err.message : String(err)
    }
    const durationMs = Date.now() - started

    const harnessTransform = await runHook(hooks.afterToolResult, {
      toolCall: call,
      result: resultContent,
      isError,
      durationMs,
      runId,
    })

    results.push({
      role: 'tool',
      toolCallId: call.id,
      content: harnessTransform?.result ?? resultContent,
      isError: harnessTransform?.isError ?? isError,
    })
  }

  return results
}
