// Conformance: invariant 4 (D015).
// Hook substitution preserves the original call id, re-enters hook+policy,
// caps depth at 3, and runtime-validates the replacement shape.
import { describe, expect, it } from "vitest";
import type { ToolCall } from "../src/index.js";
import { dispatchToolCall } from "../src/index.js";
import { echoTool, makeRegistry, testDispatchOptions } from "./helpers.js";

const call = (): ToolCall => ({ id: "orig-id", name: "echo", args: { value: "raw" } });

describe("replace-call semantics (D015)", () => {
  it("executes the replacement and stamps the original call id", async () => {
    const seen: ToolCall[] = [];
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        echoTool({
          name: "safe-echo",
          handler: (args) => ({ ok: true, content: `safe:${args.value}` }),
        }),
      ),
      hooks: [
        {
          name: "rewriter",
          run: (c) =>
            c.name === "echo"
              ? { decision: "replace", call: { name: "safe-echo", args: { value: "rewritten" } } }
              : void seen.push(c),
        },
      ],
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.callId).toBe("orig-id");
    expect(result.ok).toBe(true);
    expect(result.content).toBe("safe:rewritten");
    // Re-entry: the hook saw the replacement on the second pass.
    expect(seen.map((c) => c.name)).toEqual(["safe-echo"]);
    expect(seen[0]?.id).toBe("orig-id");
  });

  it("re-enters policy for the replacement — a rewrite cannot skip policy", async () => {
    const policySaw: string[] = [];
    const { opts } = testDispatchOptions({
      registry: makeRegistry(echoTool(), echoTool({ name: "sneaky" })),
      hooks: [
        {
          name: "rewriter",
          run: (c) =>
            c.name === "echo"
              ? { decision: "replace", call: { name: "sneaky", args: {} } }
              : undefined,
        },
      ],
      policy: (c) => {
        policySaw.push(c.name);
        return c.name === "sneaky" ? "deny" : "allow";
      },
    });
    const result = await dispatchToolCall(call(), opts);
    expect(policySaw).toEqual(["sneaky"]); // policy evaluated the replacement
    expect(result.error?.category).toBe("permission");
    expect(result.callId).toBe("orig-id");
  });

  it("caps substitution depth at 3 and yields a validation result", async () => {
    let rewrites = 0;
    const { opts } = testDispatchOptions({
      hooks: [
        {
          name: "looper",
          run: () => {
            rewrites += 1;
            return { decision: "replace", call: { name: "echo", args: { n: rewrites } } };
          },
        },
      ],
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.error?.category).toBe("validation");
    expect(result.callId).toBe("orig-id");
    expect(rewrites).toBe(4); // 3 accepted substitutions + the one over the cap
  });

  it("rejects a malformed replacement at runtime without running the handler", async () => {
    let ran = false;
    const { opts } = testDispatchOptions({
      registry: makeRegistry(echoTool({ handler: () => ((ran = true), { ok: true, content: "" }) })),
      hooks: [
        {
          name: "bad-hook",
          // Cast simulates an ill-behaved hook returning a junk shape.
          run: () => ({ decision: "replace", call: { args: "not-an-object" } }) as never,
        },
      ],
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.error?.category).toBe("validation");
    expect(result.callId).toBe("orig-id");
    expect(ran).toBe(false);
  });

  it("emits a hook-fired replace event per substitution for auditability", async () => {
    const { opts, events } = testDispatchOptions({
      registry: makeRegistry(echoTool(), echoTool({ name: "other" })),
      hooks: [
        {
          name: "rewriter",
          run: (c) =>
            c.name === "echo"
              ? { decision: "replace", call: { name: "other", args: {} } }
              : undefined,
        },
      ],
    });
    await dispatchToolCall(call(), opts);
    const replaceEvents = events.filter((e) => e.type === "hook-fired" && e.decision === "replace");
    expect(replaceEvents).toHaveLength(1);
  });
});
