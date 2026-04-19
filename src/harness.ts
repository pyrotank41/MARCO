// MARCO — Harness. The outer-loop orchestrator. Owns tool registry, hooks,
// provider, config. Also owns tool execution — the inner loop delegates
// to this class via the `handleToolCall` closure passed into runInnerLoop.

import { randomUUID } from 'node:crypto'
import { runInnerLoop, type RunInnerLoopResult } from './innerLoop.js'
import { ToolRegistry, type Tool } from './tools.js'
import { runHook, type Hooks, type Trigger } from './hooks.js'
import type { ModelConfig, ModelProvider } from './provider.js'
import type { Message, ToolCall, ToolResultMessage } from './messages.js'

export type HarnessOptions = {
  provider: ModelProvider
  modelConfig: ModelConfig
  hooks?: Hooks
  tools?: Tool[]
  maxIterations?: number
  initialMessages?: Message[]
}

export class Harness {
  private readonly provider: ModelProvider
  private readonly modelConfig: ModelConfig
  private readonly hooks: Hooks
  private readonly toolRegistry: ToolRegistry
  private readonly maxIterations: number
  private readonly initialMessages: Message[]

  constructor(options: HarnessOptions) {
    this.provider = options.provider
    this.modelConfig = options.modelConfig
    this.hooks = options.hooks ?? {}
    this.toolRegistry = new ToolRegistry()
    this.maxIterations = options.maxIterations ?? 25
    this.initialMessages = options.initialMessages ?? []

    for (const tool of options.tools ?? []) {
      this.toolRegistry.register(tool)
    }
  }

  registerTool(tool: Tool): void {
    this.toolRegistry.register(tool)
  }

  getTool(name: string): Tool | undefined {
    return this.toolRegistry.get(name)
  }

  async run(trigger: Trigger): Promise<RunInnerLoopResult> {
    const runId = randomUUID()

    const triggerMessages = triggerToMessages(trigger)
    let messages: Message[] = [...this.initialMessages, ...triggerMessages]
    let modelConfig = this.modelConfig

    const harnessStart = await runHook(this.hooks.onRunStart, {
      trigger, runId, messages, modelConfig,
    })
    if (harnessStart) {
      if (!harnessStart.allowed) {
        const rejected: RunInnerLoopResult = {
          status: 'aborted',
          messages,
          iterations: 0,
          abortReason: harnessStart.rejectReason ?? 'rejected by onRunStart',
        }
        await runHook(this.hooks.onRunEnd, {
          runId,
          status: 'aborted',
          messages,
          iterations: 0,
        })
        return rejected
      }
      messages = harnessStart.messages
      if (harnessStart.modelConfig) modelConfig = harnessStart.modelConfig
    }

    const result = await runInnerLoop({
      runId,
      messages,
      provider: this.provider,
      toolSpecs: this.toolRegistry.toSpecs(),
      requestToolCall: (call) => this.handleToolCall(call, runId),
      hooks: { beforeModelCall: this.hooks.beforeModelCall },
      modelConfig,
      maxIterations: this.maxIterations,
    })

    await runHook(this.hooks.onRunEnd, {
      runId,
      status: result.status,
      finalMessage: result.finalMessage,
      messages: result.messages,
      iterations: result.iterations,
      error: result.error,
    })

    return result
  }

  /**
   * Handle a single tool call — the outcome may be execution, denial,
   * a short-circuit cached result, or an error. The loop asks (via
   * requestToolCall); the harness handles. The loop never calls this
   * directly — it invokes the bound closure passed into runInnerLoop.
   *
   * Lifecycle per call: beforeToolCall hook (decide execute / deny /
   * short-circuit) → tool.validate → tool.handler → afterToolResult hook.
   * Errors (validation, handler throws, unknown tool) become error
   * ToolResultMessage objects so the model can see and react.
   */
  private async handleToolCall(call: ToolCall, runId: string): Promise<ToolResultMessage> {
    const harnessDecision = await runHook(this.hooks.beforeToolCall, { toolCall: call, runId })

    // Short-circuit paths: harness said don't actually execute
    switch (harnessDecision?.decision) {
      case 'deny':
        return {
          role: 'tool',
          toolCallId: call.id,
          content: `Denied: ${harnessDecision.reason}`,
          isError: true,
        }
      case 'short-circuit':
        return {
          role: 'tool',
          toolCallId: call.id,
          content: harnessDecision.result,
          isError: false,
        }
    }

    // Execute path
    const effectiveInput = harnessDecision?.decision === 'execute' && harnessDecision.input !== undefined
      ? harnessDecision.input
      : call.input

    const tool = this.toolRegistry.get(call.name)
    if (!tool) {
      return {
        role: 'tool',
        toolCallId: call.id,
        content: `Tool "${call.name}" is not registered`,
        isError: true,
      }
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

    const harnessTransform = await runHook(this.hooks.afterToolResult, {
      toolCall: call,
      result: resultContent,
      isError,
      durationMs,
      runId,
    })

    return {
      role: 'tool',
      toolCallId: call.id,
      content: harnessTransform?.result ?? resultContent,
      isError: harnessTransform?.isError ?? isError,
    }
  }
}

function triggerToMessages(trigger: Trigger): Message[] {
  switch (trigger.kind) {
    case 'user_message':
      return [{ role: 'user', text: trigger.text }]
    case 'schedule':
      return [{ role: 'user', text: `[scheduled trigger: ${trigger.cron}]` }]
    case 'event':
      return [{ role: 'user', text: `[event: ${trigger.eventType}] ${JSON.stringify(trigger.payload)}` }]
    case 'webhook':
      return [{ role: 'user', text: `[webhook ${trigger.path}] ${JSON.stringify(trigger.payload)}` }]
  }
}
