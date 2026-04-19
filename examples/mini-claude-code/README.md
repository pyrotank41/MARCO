# mini-claude-code

A deliberately narrow CLI agent built with MARCO. Four tools: `bash`, `read`, `write`, `edit`. Stream tokens to the terminal. Per-tool permission UX. Session persistence as JSONL.

## Run

```bash
ANTHROPIC_API_KEY=sk-... npm run example
```

Or drop your key into a `.env` file at the repo root (see `.env.example`) and run:

```bash
npm run example
```

First run creates `~/.marco/config.json` with Claude Sonnet 4.6 selected.

## Subcommands

- `marco` — start a new session
- `marco --session <id>` — resume a session
- `marco config` — show current model + available models
- `marco config set <id>` — switch model
- `marco config reset` — revert to default
