# MARCO

[![npm version](https://img.shields.io/npm/v/marco-harness?color=cb3837&label=marco-harness&logo=npm)](https://www.npmjs.com/package/marco-harness)
[![npm downloads](https://img.shields.io/npm/dm/marco-harness?color=cb3837&logo=npm)](https://www.npmjs.com/package/marco-harness)
[![license](https://img.shields.io/npm/l/marco-harness)](./LICENSE)

**M**odel-**A**gnostic **R**untime for **C**ontrolled **O**rchestration.

A small TypeScript AI agent harness. Companion code to [*How AI agents work: a control flow breakdown*](https://karankochar.dev/posts/how-ai-agents-work-a-control-flow-breakdown).

**Launch post:** [*MARCO: the loop inside a harness, in code*](https://karankochar.dev/posts/marco-the-loop-inside-a-harness-in-code) — describes `v0.1.0`. The repo will keep evolving; the post is pinned to that tag.

## Why another agent library?

There are many agent libraries. MARCO is different in two specific ways:

1. **Small.** Core is under 1000 lines of readable TypeScript. You can read the whole thing in an afternoon.
2. **Explicit separation.** The inner loop (the engine) and the harness (the outer loop) are two different things. MARCO's API reflects that split literally — see [`docs/design.md`](docs/design.md).

The point is clarity, not breadth.

## Install

```bash
npm install marco-harness
```

## Usage

```typescript
import { Harness, AnthropicProvider, type Tool } from 'marco-harness'
import { z } from 'zod'

const echoTool: Tool = {
  name: 'echo',
  description: 'Echo back what you say',
  inputJsonSchema: {
    type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
  },
  validate: (i) => z.object({ text: z.string() }).parse(i),
  handler: async (input) => `echoed: ${(input as { text: string }).text}`,
}

const harness = new Harness({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  modelConfig: { model: 'claude-sonnet-4-6' },
  tools: [echoTool],
  hooks: {
    beforeToolCall: async ({ toolCall }) => ({ decision: 'execute' }),
  },
})

const result = await harness.run({ kind: 'user_message', text: 'say hello' })
console.log(result.finalMessage?.text)
```

## The architecture in 90 seconds

MARCO models an agent as a **loop inside a harness**.

### Inner loop (thin)

Iteration: build context → call model → if tool call, run it and feed the result back → stop on end_turn.

The inner loop is one function (`runInnerLoop`). Everything else is the harness.

### Three interfaces between loop and harness

| Interface | Who initiates | What it's for |
|---|---|---|
| **Tools** | model | Model asks the harness to do something |
| **Lifecycle hooks** | harness | Harness injects behavior at fixed points |
| **Model provider** | loop | Loop asks the harness for the next assistant message |

### Five lifecycle hooks

- `onRunStart` — auth, rate limits, session hydration
- `beforeModelCall` — context compaction, injection, budget check
- `beforeToolCall` — permission gate, human approval, routing
- `afterToolResult` — redaction, observability, memory writes
- `onRunEnd` — persistence, quality gates, delivery, scheduling

### Full architecture

See [`docs/design.md`](docs/design.md).

## Worked example — mini Claude Code

A narrow coding agent built with MARCO. Four tools (`bash`, `read`, `write`, `edit`), per-tool permission UX, streaming output, JSONL session persistence, user-level config at `~/.marco/config.json`.

```bash
ANTHROPIC_API_KEY=sk-... npm run example
```

See [`examples/mini-claude-code/README.md`](examples/mini-claude-code/README.md).

## What MARCO is NOT

Non-goals are a taste signal:

- **Not durable.** For resume-after-crash, compose with Inngest/Temporal.
- **Not multi-agent.** Handoffs are tool calls in MARCO's model; dedicated multi-agent is a different library.
- **No memory backend.** Memory is tools. BYO backend.
- **No eval framework.** Different artifact.
- **No production observability built in.** Hooks provide the surface; bring your OTEL.
- **No RAG stack.** A tool concern.

## Development

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build
```

## License

MIT.
