// MARCO — MockProvider. Replays a scripted sequence of ChunkEvents for tests and examples.

import type { ChunkEvent, ModelConfig, ModelProvider, StreamOptions, ToolSpec } from '../provider.js'
import type { Message } from '../messages.js'

export class MockProvider implements ModelProvider {
  private turn = 0
  constructor(private readonly script: ChunkEvent[][]) {}

  async *stream(
    _messages: Message[],
    _tools: ToolSpec[],
    _config: ModelConfig,
    options?: StreamOptions,
  ): AsyncIterable<ChunkEvent> {
    if (this.turn >= this.script.length) {
      throw new Error('MockProvider: script exhausted')
    }
    const turnEvents = this.script[this.turn]!
    this.turn += 1
    for (const event of turnEvents) {
      // Yield to the microtask queue so a parallel signal.abort() can
      // be observed; without this, a synchronous yield-of-all-events
      // wouldn't be cancellable mid-stream.
      await Promise.resolve()
      if (options?.signal?.aborted) {
        const reason = signalReason(options.signal) ?? 'aborted'
        if (typeof DOMException !== 'undefined') {
          throw new DOMException(reason, 'AbortError')
        }
        const err = new Error(reason)
        err.name = 'AbortError'
        throw err
      }
      yield event
    }
  }
}

function signalReason(signal: AbortSignal): string | undefined {
  const r = signal.reason
  if (r === undefined) return undefined
  if (r instanceof Error) return r.message
  if (typeof r === 'string') return r
  try { return String(r) } catch { return undefined }
}
