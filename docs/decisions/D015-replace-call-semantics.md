---
title: PreToolUse hooks may replace a call under strict re-entry rules
status: accepted
category: "Security & Safety"
tags: [hooks, gates, replace-call, core-invariant]
---

# D015 — PreToolUse hooks may replace a call under strict re-entry rules

## Problem

A PreToolUse hook that can only allow or block is too blunt: real policies
want to rewrite calls (downgrade `bash rm` to a dry-run, redirect a write into
a sandbox path, add namespacing to an MCC call). But naive substitution breaks
the transcript contract — the model emitted a call id and expects exactly one
result on it — and an unconstrained rewrite chain can loop forever or smuggle
a call past policy.

## Decision

A PreToolUse hook may return a replacement `ToolCall`. The dispatch wrapper
then enforces:

1. **Id preservation.** The replacement is stamped with the original
   `ToolCall.id`; whatever executes, exactly one `ToolResult` is produced on
   the id the model emitted.
2. **Full re-entry.** The replacement re-enters the gate sequence from the top
   (hooks, then `PermissionPolicy`). A replacement cannot skip policy.
3. **Depth cap.** At most 3 substitutions per original call; exceeding the cap
   yields a synthetic `validation` error result.
4. **Runtime shape validation.** The replacement object is structurally
   validated at runtime (name is a string, args is an object) — hooks are
   user code and their return values are not trusted.

## Consequences

- Policies can rewrite instead of merely refusing, which keeps the model's
  loop moving (errors-as-retry-instructions, invariant 10).
- Replacement chains are finite and auditable: each substitution emits a
  `hook-fired` trajectory event, so the run inspector shows the rewrite chain.
- Conformance test: `replace-call.test.ts` covers id preservation, policy
  re-entry on the replacement, depth-cap exhaustion, and malformed hook
  returns.
