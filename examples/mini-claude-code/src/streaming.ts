// mini-claude-code — pipe provider events to stdout as they arrive.
//
// Buffers text_delta events per assistant message and renders the completed
// markdown (with ANSI styling, in pastel blue) on message_end. We trade live
// token streaming for proper markdown rendering — partial markdown tokens
// (``` fences, **bold**, etc.) can't be styled correctly mid-stream.

import { stdout } from 'node:process'
import type { ChunkEvent, ModelProvider, ModelConfig, ToolSpec, Message } from 'marco-harness'
import { renderMarkdown, DIM, RESET } from './ui.js'

export class StreamingProvider implements ModelProvider {
  constructor(private readonly inner: ModelProvider) {}

  async *stream(
    messages: Message[],
    tools: ToolSpec[],
    config: ModelConfig,
  ): AsyncIterable<ChunkEvent> {
    let buffer = ''
    let spinnerTimer: ReturnType<typeof setInterval> | null = null
    let spinnerActive = false
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let frameIdx = 0

    const startSpinner = (): void => {
      if (spinnerActive) return
      spinnerActive = true
      spinnerTimer = setInterval(() => {
        stdout.write(`\r${DIM}${frames[frameIdx]} thinking…${RESET}`)
        frameIdx = (frameIdx + 1) % frames.length
      }, 80)
    }
    const stopSpinner = (): void => {
      if (!spinnerActive) return
      if (spinnerTimer) clearInterval(spinnerTimer)
      spinnerTimer = null
      spinnerActive = false
      stdout.write('\r\x1b[2K')
    }

    startSpinner()
    try {
      for await (const event of this.inner.stream(messages, tools, config)) {
        if (event.type === 'text_delta') {
          buffer += event.text
        }
        if (event.type === 'message_end') {
          stopSpinner()
          if (buffer.trim().length > 0) {
            stdout.write(renderMarkdown(buffer) + '\n')
          }
          buffer = ''
        }
        yield event
      }
    } finally {
      stopSpinner()
    }
  }
}
