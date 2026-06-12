# Otter — guidance for Claude Code

Otter is a reusable agent platform: one hardened TypeScript core that runs
agents for clients, plus a public web showcase of the same engine. The full
build contract lives in the repo's build spec; the invariants below are the
short version and they are **non-negotiable** — if a change would violate one,
stop and flag it instead of coding around it.

## Commands

```sh
pnpm install         # workspace install (pnpm 10, Node 22)
pnpm build           # turbo build across packages (tsc)
pnpm test            # turbo test (vitest)
pnpm typecheck       # tsc --noEmit per package
pnpm lint            # eslint + docs/decisions frontmatter lint
pnpm changeset       # add a changeset for any package change
```

Run a single package's tests: `pnpm --filter @otter/core test`.

## Layout

- `packages/core` — loop, types, registry, gates, trajectory. **Zero runtime
  deps, no provider SDKs** (`ModelAdapter` interface only).
- `packages/adapters` — model clients (Anthropic, gateway).
- `packages/execution` — sandbox interface + local impl.
- `packages/security` — command guards, SSRF guard, secret redaction.
- `packages/tools-std` — bash, read/write/edit, todo, task (subagent), skill.
- `packages/tools-mcp` — MCP client: connect, namespace, schema-validate.
- `packages/surface-cli` / `surface-web` / `surface-slack` — surfaces.
- `apps/web` — public showcase (Next.js). **Never client-derived content.**
- `templates/client` — clone-me scaffold for client repos (not a workspace
  package).
- `docs/decisions` — decision records in pattern format (frontmatter +
  Problem/Decision/Consequences). Linted by `scripts/lint-decisions.mjs`.
- `references/` — read-only reference repos, gitignored. Never copy code or
  text from `references/odysseus-dev` (concepts only).

## Core invariants (tests are the spec)

1. **Loop (D013):** continuation is `toolCalls.length > 0`, never
   `finishReason`.
2. **Gate sequence:** PreToolUse hook → PermissionPolicy → Registry resolve →
   Handler → cancellation watchdog. Every path yields exactly one `ToolResult`
   on the model's call id — never an exception out of the loop.
3. **Closed taxonomies (D014):** error categories `validation · permission ·
   transient · business-rule · network · server · timeout · cancelled`;
   trajectory event types are similarly fixed. Never add members.
4. **Replace-call (D015):** hook substitution preserves the original call id,
   re-enters hook+policy, depth-capped at 3, runtime shape-validated.
5. **Three-tier permissions:** ApprovalConfig → PermissionPolicy →
   ApprovalCallback. Enforced in the dispatch wrapper, never inside tools.
6. **Cancellation:** abort → grace timer (default 100 ms) → settle-in-grace is
   the normal path, else synthetic `cancelled` result and the late handler is
   absorbed silently. `gracePeriodMs: 0` valid, `Infinity` rejected at run
   start.
7. **Id normalisation:** handler results are stamped with the original call id.
8. Deterministic shell, generative core: budgets are shell-counted; policy is
   enforced at the boundary, not in the prompt.
9. No provider SDK in `@otter/core`'s dependency graph.
10. Tool error text is written as a retry instruction for the model.

A PR that changes invariant behaviour must update the matching
`docs/decisions/D*.md` **in the same commit** or be rejected.

## Working agreements

- Small PRs per phase step, conventional commits, changeset per package
  change.
- When uncertain, prefer the reference (`references/learn-claude-code` for
  capability shape, the decision log for invariants). Genuinely new design →
  write a decision file first, then code.
- Package naming: scope `@otter/*`, surfaces `surface-*`, tool packs
  `tools-*`. Literal, ungimmicky names.
