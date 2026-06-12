---
title: Loop continuation is decided by toolCalls.length alone
status: accepted
category: "Orchestration & Control"
tags: [agent-loop, finish-reason, core-invariant]
---

# D013 — Loop continuation is decided by `toolCalls.length` alone

## Problem

Agent loops commonly branch on the provider's `finishReason` / `stop_reason`
string to decide whether to keep going. That string is an open diagnostic
vocabulary owned by the provider: new values appear without notice
(`max_tokens`, `pause_turn`, `refusal`, gateway-specific values), and the same
semantic outcome maps to different strings across providers and gateways. Any
branch on it is a latent bug that surfaces only when a provider ships a new
value.

## Decision

The loop continues if and only if the parsed model turn contains one or more
tool calls:

```ts
while (turn.toolCalls.length > 0) { /* dispatch, append results, call model */ }
```

`finishReason` is carried on `ModelTurn` as an opaque string for trajectory
diagnostics only. No code path in `@otter/core` may compare it, switch on it,
or derive control flow from it. `ModelAdapter` implementations are responsible
for parsing provider output into `toolCalls`; the loop trusts only that array.

## Consequences

- New provider stop reasons are inert: they show up in the trajectory, never
  in control flow.
- An adapter that fails to parse tool calls terminates the run cleanly (no
  calls → no continuation) rather than spinning or crashing.
- Conformance test: `loop-invariant.test.ts` feeds turns with adversarial
  `finishReason` values (`"tool_use"` with zero calls, `"end_turn"` with
  calls, unknown strings) and asserts continuation tracks only the array
  length.
