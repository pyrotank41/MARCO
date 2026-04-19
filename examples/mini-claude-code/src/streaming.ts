// mini-claude-code — pipe provider events to stdout as they arrive.
//
// Thin wrapper around a ModelProvider that forwards text_delta events
// to stdout before yielding them. The harness's inner loop is unaware;
// it sees the same ChunkEvent stream.

import { stdout } from 'node:process'
import type { ChunkEvent, ModelProvider, ModelConfig, ToolSpec } from '../../../src/provider.js'
import type { Message } from '../../../src/messages.js'

export class StreamingProvider implements ModelProvider {
  constructor(private readonly inner: ModelProvider) {}

  async *stream(
    messages: Message[],
    tools: ToolSpec[],
    config: ModelConfig,
  ): AsyncIterable<ChunkEvent> {
    for await (const event of this.inner.stream(messages, tools, config)) {
      if (event.type === 'text_delta') {
        stdout.write(event.text)
      }
      if (event.type === 'message_end') {
        stdout.write('\n')
      }
      yield event
    }
  }
}
