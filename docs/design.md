# MARCO — Design

**Model-Agnostic Runtime for Controlled Orchestration**

A small, readable TypeScript AI agent harness. Companion code artifact to [*How AI agents work: a control flow breakdown*](https://karankochar.dev/posts/how-ai-agents-work-a-control-flow-breakdown). Encodes the article's *loop-inside-a-harness* framing as the shape of the API.

---

## Core thesis

An AI agent is a **loop inside a harness**.

- **Inner loop** — the engine. Builds context, calls the model, emits tool calls, accumulates results, decides when to stop.
- **Harness (outer loop)** — everything around the inner loop that makes it usable: triggers, permissions, tool execution, human-in-the-loop, monitoring, delivery, scheduling.

MARCO's API makes this split explicit. The inner loop is small and hidden. The harness is the entire user-facing surface.

---

## The three interfaces between loop and harness

Every interaction between the inner loop and the harness flows through one of three interfaces. Each has a different initiator.

| Interface | Direction | Initiator | Purpose |
|---|---|---|---|
| **Tools** | model → harness | model | Model requests the harness do something |
| **Lifecycle hooks** | harness → loop | harness | Harness injects behavior at fixed points |
| **Model provider** | loop → harness | loop | Loop requests the next assistant message |

---

## Interface 1 — Tools

Tools are model-initiated. The model emits a tool call; the harness decides what to do with it.

Tools are registered in a harness-owned registry. Each tool carries a JSON schema describing its input (sent to the provider API), a runtime validator (typically backed by zod), a handler, and optional metadata (category, permission level).

**Tool execution is not inside the inner loop.** The loop emits a request and consumes a result. Everything in between — permission checks, human approval, execution, redaction — is harness territory, implemented via the `beforeToolCall` and `afterToolResult` hooks.

**Clarification tools are a special case.** The model emits e.g. `ask_user({question})`; the harness intercepts it, surfaces the question, waits for the answer, and returns it as a tool result. Same wire shape as any tool, different execution path (no permission check, no "execution" — just question and wait).

---

## Interface 2 — Lifecycle hooks

Five hooks map 1:1 to nodes in the article's outer-loop diagram.

### `onRunStart(trigger)`
Fires once when the outer loop receives a trigger, before the inner loop begins.

Responsibilities: authenticate/authorize the trigger, run-level rate limiting, session hydration (load conversation history, user profile), budget check, model selection, initial message assembly, observability init. Can short-circuit with a rejection.

Maps to diagram nodes: *Trigger*, *Permissions & rate limits*, *Reject/Notify*.

### `beforeModelCall(messages)`
Fires on every inner-loop iteration, before the model is invoked.

Responsibilities: context compaction (may itself call the model), message transformation, fresh context injection ("current time is…"), prompt-level guardrails, per-call model routing, iteration budget check, per-iteration observability.

Fires N times per run, unlike the others which fire once. No explicit diagram node — context management was implicit in the article but surfaces here as a first-class concern.

### `beforeToolCall(call)`
Fires after the model emits a tool call, before execution.

Responsibilities: permission check, human approval gate, per-tool rate limits, argument validation or redaction, routing (which backend implementation), short-circuit (cached result or canned rejection), special-case clarification handling.

Maps to diagram nodes: *Harness: Check & Execute*, *Ask Human permission*, *Ask Human clarification*.

### `afterToolResult(result)`
Fires after tool execution, before the result enters context.

Responsibilities: redaction, auto-summarization of large payloads, observability (log duration/size/status), error policy (retry/escalate/surface), side-effect recording (audit log, billing), memory writes.

Maps to diagram node: *Monitor + Log* (per-tool slice).

### `onRunEnd(result)`
Fires once when the inner loop produces a final answer or errors out, before delivery.

Responsibilities: final observability (total tokens, cost, duration), conversation-history persistence, output post-processing, quality gates (schema validation, safety classifiers), human review routing for high-stakes output, delivery, next-run scheduling, error policy, memory consolidation.

Takes a `status` arg — fires for both success and failure. Maps to diagram nodes: *Monitor + Log* (final), *Human Review*, *Deliver Output*, *Schedule next run*.

---

## Interface 3 — Model provider

Loop-initiated. On each iteration, the loop asks the harness for the next assistant message, given the current messages and the currently-available tools.

```ts
interface ModelProvider {
  stream(messages: Message[], tools: ToolSpec[], config: ModelConfig)
    : AsyncIterable<ChunkEvent>
}
```

`ToolSpec` is a provider-agnostic serializable shape (`{ name, description, inputSchema }`) produced from the tool registry via `toSpecs()`. The provider never sees the Tool's handler or validator — only the wire-level schema.

The provider normalizes all provider-specific shapes (Anthropic, OpenAI, Google, local) to MARCO's canonical message format. This normalization is where *model-agnostic* is enforced — not by supporting every provider out of the box, but by making the interface thin enough that swapping providers is a single file.

### Canonical shapes

```ts
type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage

type AssistantMessage = {
  role: 'assistant'
  text?: string
  toolCalls: ToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'safety' | 'error'
  usage: { inputTokens: number, outputTokens: number }
}

type ToolCall = {
  id: string      // canonical, not provider-specific
  name: string
  input: unknown  // validated against registered schema
}
```

### Ownership

**Provider** owns: API transport, retries, backoff, normalization to canonical shapes, token counting, streaming event emission.

**Loop** owns: calling `provider.stream(...)` each iteration, consuming the stream, handling `stopReason`:
- `end_turn` → exit loop, return to `onRunEnd`
- `tool_use` → run tool calls via harness, feed results back, continue
- `max_tokens` → harness policy decides (force-continue or treat as complete)
- `safety` / `error` → surface to harness

**Harness** owns: registering the `ModelProvider` at boot, deciding which subset of registered tools to pass to each `provider.stream` call, setting model config per run or per iteration, subscribing to provider events for observability.

---

## Context sourcing

Context has three logical sources but one wire shape.

1. **Static, harness-injected** (at run start): system prompt, tool schemas, auth context, initial conversation history
2. **Loop-accumulated** (during run): assistant messages and tool results from this run
3. **Dynamic, fetched during run**: memory lookups, retrieval, fresh external data

Sources 1 and 3 are harness-owned. At the wire level, (3) collapses into tool calls — either model-initiated (true tools) or harness-initiated at lifecycle points (the harness pre-invokes a tool on the model's behalf and injects the result as a `tool_result` message).

There is no separate "provider" primitive. Everything external is a tool; some tools are called by the model, some are called by the harness at fixed lifecycle points.

---

## Context compaction

Compaction is harness-initiated but model-executed.

1. The harness detects token count exceeds threshold inside `beforeModelCall`
2. It picks a strategy (summarize oldest N turns, drop middle, keep system + last K)
3. If the strategy requires a model call, the harness uses the same `ModelProvider` the loop uses
4. Replaces old turns with the summary
5. Returns the new message list to the loop
6. The loop sends it, unaware anything happened

The *decision* to compact is harness policy. The *execution* may require the model. This is why compaction can't be pure harness — it needs provider access too.

---

## Design constraints for v1

- Target < 1000 LOC total
- Single TypeScript package, no monorepo
- Minimal dependencies: `@anthropic-ai/sdk` and `zod` only
- Two model providers: `AnthropicProvider` (real) + `MockProvider` (tests, examples)
- Node 22+, TypeScript via tsx or native type-stripping
- File names teach the architecture:
  - `innerLoop.ts` — the core loop
  - `harness.ts` — the outer-loop orchestrator
  - `hooks.ts` — the five lifecycle hook types and runner
  - `provider.ts` — the `ModelProvider` interface
  - `providers/anthropic.ts` — real implementation
  - `providers/mock.ts` — test implementation
  - `tools.ts` — tool registry
  - `messages.ts` — canonical message shapes

---

## Non-goals for v1

- **Durable execution.** Resume-after-crash is out of scope. Compose MARCO with Inngest or Temporal for durability. MARCO's process model is: one run, one process.
- **Multi-agent / handoffs.** Handoffs are tool calls in MARCO's model; dedicated multi-agent orchestration is a separate concern.
- **Memory backend.** Memory is tools. Bring your own backend — register a tool that reads and writes memory however you want.
- **Evals.** Out of scope.
- **Production observability.** Hooks provide the surfaces; bring your own OTEL adapter.
- **RAG / retrieval stack.** A tool concern. Example provided; bring your own retrieval.

---

## Worked example — mini Claude Code

MARCO v1 ships with one example: a CLI agent with four tools.

- `bash` — run a shell command, return output
- `read` — read a file
- `write` — create or overwrite a file
- `edit` — diff-style edit of an existing file

### Example UX

- **Streaming** — tokens stream to the terminal as the provider produces them. The example subscribes to provider events; MARCO core just exposes the stream.
- **Permission UX per tool** — `read` is auto-approved. `bash` shows a `[y/N]` confirm with the command. `write` shows the full file contents before confirming. `edit` shows a red/green diff before confirming. All implemented in the example's `beforeToolCall` hook — illustrating that permission policy is per-tool, not global.
- **Session persistence** — JSONL files at `.marco/sessions/<session-id>.jsonl`, one line per canonical message. Resumable via `marco --session <id>`. Readable with `cat`/`jq`.
- **Model selection** — configured via `~/.marco/config.json` (user-level, not per-project). Stores `selected_model` and a list of `available_models`. Managed via CLI subcommands: `marco config` (show), `marco config set <id>` (switch), `marco config reset` (revert to default). First run creates the file with Claude Sonnet 4.6 selected. No env vars. Config ownership lives in the example, not MARCO core — core accepts a model ID string and is unopinionated about where it came from.

### Explicitly not included in the example
- Sub-agents
- Slash commands
- A nested hook system of its own
- IDE integration
- Richer approval UI beyond the per-tool confirms above

The narrow scope is intentional: the minimum version of a coding agent that still exercises the loop-inside-a-harness architecture. Everything cut is harness-layer polish, not loop-layer architecture.
