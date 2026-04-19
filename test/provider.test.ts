import { describe, it, expect } from 'vitest'
import type { ModelProvider, ChunkEvent, ModelConfig, ToolSpec } from '../src/provider.js'
import type { AssistantMessage } from '../src/messages.js'

describe('provider types', () => {
  it('ChunkEvent union includes every documented kind', () => {
    const events: ChunkEvent[] = [
      { type: 'text_delta', text: 'hi' },
      { type: 'tool_call_start', id: 'c1', name: 'bash' },
      { type: 'tool_call_delta', id: 'c1', inputJson: '{"command"' },
      { type: 'tool_call_end', id: 'c1' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          text: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        } satisfies AssistantMessage,
      },
    ]
    expect(events).toHaveLength(5)
  })

  it('ModelConfig has required model and optional tuning', () => {
    const cfg: ModelConfig = { model: 'claude-sonnet-4-6' }
    const cfgFull: ModelConfig = {
      model: 'claude-opus-4-7',
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: 'you are helpful',
    }
    expect(cfg.model).toBeDefined()
    expect(cfgFull.temperature).toBe(0.7)
  })

  it('ToolSpec carries name, description, and JSON schema', () => {
    const spec: ToolSpec = {
      name: 'bash',
      description: 'Run a shell command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    }
    expect(spec.name).toBe('bash')
  })

  it('ModelProvider is implementable', () => {
    const p: ModelProvider = {
      async *stream() {
        yield { type: 'text_delta', text: '' }
      },
    }
    expect(p).toBeDefined()
  })
})
