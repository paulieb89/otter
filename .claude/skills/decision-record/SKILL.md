---
name: decision-record
description: Write a new Otter decision record in docs/decisions/ when a load-bearing design choice or core invariant is introduced or changed.
---

# Writing an Otter decision record

1. Pick the next free number: `ls docs/decisions/ | sort | tail -1`. File name
   is `D<NNN>-<kebab-slug>.md`.
2. Use this exact shape (the frontmatter is linted by
   `scripts/lint-decisions.mjs`):

```markdown
---
title: One-line statement of the decision
status: accepted        # proposed | accepted | superseded
category: "Orchestration & Control"   # or Reliability & Eval, Security & Safety, …
tags: [tag1, tag2]
---

# D<NNN> — Title

## Problem

What breaks or rots without this decision. Be concrete.

## Decision

The rule itself, stated so a reviewer can check code against it. Include the
enforcing mechanism (which package, which test).

## Consequences

What this buys, what it costs, and the named conformance test that pins it.
```

3. If the decision changes an existing invariant, update the old record's
   `status` to `superseded` and link both ways.
4. Land the decision file **in the same commit** as the code/tests that
   implement it. Run `pnpm lint` before committing.
