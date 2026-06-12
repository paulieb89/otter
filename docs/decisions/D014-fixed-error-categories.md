---
title: Fixed closed sets for error categories and trajectory event types
status: accepted
category: "Reliability & Eval"
tags: [errors, trajectory, taxonomy, core-invariant]
---

# D014 — Fixed closed sets for error categories and trajectory event types

## Problem

Open-ended error taxonomies rot: every layer invents its own strings, retry
logic degenerates into substring matching, and dashboards can't aggregate.
The same applies to trajectory/observability events — if surfaces can emit
ad-hoc event types, no consumer can render a run reliably.

## Decision

Two closed sets, defined once in `@otter/core` and never extended by other
packages:

**Error categories** (`ErrorCategory`):

```
validation · permission · transient · business-rule · network · server · timeout · cancelled
```

**Trajectory event types** (`TrajectoryEvent["type"]`):

```
model-turn-received · transcript-appended · hook-fired · permission-decided ·
invocation-started · error-raised · invocation-completed · run-state-changed
```

Anything that doesn't fit must be mapped to the nearest existing category
(e.g. MCP server failures map to `transient` or `server`), with detail carried
in free-text fields — never in new enum members. Adding a member is a breaking
change that requires updating this record and the conformance tests in the
same commit.

## Consequences

- Retry/backoff policy can be written once against `transient · network ·
  timeout` and hold across every tool, including future MCP servers.
- The web run inspector renders any run from any surface because the event
  vocabulary is closed.
- Pressure to add a category is redirected into the `message`/`detail` fields,
  keeping the taxonomy stable.
