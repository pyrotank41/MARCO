// MARCO — tool registry. Tools are registered by name and exposed to the provider via toSpecs().

import type { ToolSpec } from './provider.js'

export type ToolContext = {
  runId: string
  sessionId?: string
  abortSignal?: AbortSignal
}

export type PermissionLevel = 'auto' | 'confirm' | 'always-ask'

export type Tool<TInput = unknown> = {
  name: string
  description: string
  inputJsonSchema: Record<string, unknown>
  validate: (input: unknown) => TInput
  handler: (input: TInput, ctx: ToolContext) => Promise<string>
  category?: string
  permissionLevel?: PermissionLevel
}

export type ListFilter = {
  category?: string
}

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register<T>(tool: Tool<T>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`)
    }
    this.tools.set(tool.name, tool as Tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  list(filter?: ListFilter): Tool[] {
    const all = Array.from(this.tools.values())
    if (!filter?.category) return all
    return all.filter((t) => t.category === filter.category)
  }

  toSpecs(filter?: ListFilter): ToolSpec[] {
    return this.list(filter).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputJsonSchema,
    }))
  }
}
