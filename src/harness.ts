// MARCO — Harness. The outer-loop orchestrator. Owns tool registry, hooks, provider, config.

import { randomUUID } from 'node:crypto'
import { runInnerLoop, type RunInnerLoopResult } from './innerLoop.js'
import { ToolRegistry, type Tool } from './tools.js'
import { runHook, type Hooks, type Trigger } from './hooks.js'
import type { ModelConfig, ModelProvider } from './provider.js'
import type { Message } from './messages.js'

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

    const start = await runHook(this.hooks.onRunStart, {
      trigger, runId, messages, modelConfig,
    })
    if (start) {
      if (!start.allowed) {
        const rejected: RunInnerLoopResult = {
          status: 'aborted',
          messages,
          iterations: 0,
          abortReason: start.rejectReason ?? 'rejected by onRunStart',
        }
        await runHook(this.hooks.onRunEnd, {
          runId,
          status: 'aborted',
          messages,
          iterations: 0,
        })
        return rejected
      }
      messages = start.messages
      if (start.modelConfig) modelConfig = start.modelConfig
    }

    const result = await runInnerLoop({
      runId,
      messages,
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      hooks: this.hooks,
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
