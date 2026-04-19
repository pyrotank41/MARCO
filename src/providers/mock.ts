// MARCO — MockProvider. Replays a scripted sequence of ChunkEvents for tests and examples.

import type { ChunkEvent, ModelConfig, ModelProvider, ToolSpec } from '../provider.js'
import type { Message } from '../messages.js'

export class MockProvider implements ModelProvider {
  private turn = 0
  constructor(private readonly script: ChunkEvent[][]) {}

  async *stream(
    _messages: Message[],
    _tools: ToolSpec[],
    _config: ModelConfig,
  ): AsyncIterable<ChunkEvent> {
    if (this.turn >= this.script.length) {
      throw new Error('MockProvider: script exhausted')
    }
    const turnEvents = this.script[this.turn]!
    this.turn += 1
    for (const event of turnEvents) {
      yield event
    }
  }
}
