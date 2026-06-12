# Otter

Otter is an agent harness you can deploy for a client in a day, with a public
web workspace that proves it.

One hardened TypeScript core runs agents behind any surface — CLI, web, Slack
— with the security boundary in the harness, not the prompt: every tool call
passes a gate pipeline (hooks → permission policy → registry → handler →
cancellation watchdog), every gate decision is a trajectory event, and budgets
are counted by the shell, never promised by the model.

## Status

| Phase | Contents | State |
|---|---|---|
| 0 | Workspace, CI, decision records D013–D015 | ✅ gate passed |
| 1 | `@otter/core` loop + invariant conformance suite (41 tests) | ✅ gate passed |
| 2 | `@otter/adapters`, `@otter/tools-std`, `@otter/surface-cli` | ✅ fixture gate passed; live-model run pending credentials |
| 3 | `@otter/tools-mcp` + `@otter/security`, showcase MCP servers | not started |
| 4 | `@otter/surface-web` run API + `apps/web` showcase | not started |
| 5 | Client template + `@otter/surface-slack` | not started |

## Try the CLI

```sh
pnpm install && pnpm build
cp .env.example .env           # set ANTHROPIC_API_KEY (or ANTHROPIC_BASE_URL for a gateway)
node packages/surface-cli/dist/main.js
```

The CLI auto-loads `.env` from the directory you launch it in; shell-exported
variables take precedence over the file.

The agent works in your current directory: read-only tools run freely,
anything that mutates (bash, write, edit) asks first, and every tool call,
gate decision and skill load is printed as it happens.

## Invariants

The product is the set of invariants in [`CLAUDE.md`](./CLAUDE.md) and
[`docs/decisions/`](./docs/decisions/) — loop continuation by
`toolCalls.length` alone (D013), closed error/event taxonomies (D014),
replace-call semantics (D015), three-tier permissions enforced in the dispatch
wrapper, and non-cooperative cancellation. Each has a named conformance test;
changing one requires changing its decision record in the same commit.
