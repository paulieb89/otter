// Conformance: invariant 5.
// Three-tier permissions: ApprovalConfig → PermissionPolicy → ApprovalCallback.
// Checks and audit events live in the dispatch wrapper — a tool cannot opt out.
import { describe, expect, it } from "vitest";
import { dispatchToolCall } from "../src/index.js";
import { echoTool, makeRegistry, testDispatchOptions } from "./helpers.js";

const call = { id: "p1", name: "echo", args: { value: "x" } };

describe("three-tier permissions (invariant 5)", () => {
  it("ask + interactive approval=yes runs the tool", async () => {
    const asked: string[] = [];
    const { opts } = testDispatchOptions({
      policy: () => "ask",
      approval: {
        mode: "interactive",
        approve: (c) => {
          asked.push(c.name);
          return true;
        },
      },
    });
    const result = await dispatchToolCall(call, opts);
    expect(asked).toEqual(["echo"]);
    expect(result.ok).toBe(true);
  });

  it("ask + interactive approval=no denies", async () => {
    const { opts } = testDispatchOptions({
      policy: () => "ask",
      approval: { mode: "interactive", approve: () => false },
    });
    const result = await dispatchToolCall(call, opts);
    expect(result.error?.category).toBe("permission");
  });

  it("ask in background mode denies — there is nobody to ask", async () => {
    const { opts } = testDispatchOptions({
      policy: () => "ask",
      approval: { mode: "background" },
    });
    const result = await dispatchToolCall(call, opts);
    expect(result.error?.category).toBe("permission");
  });

  it("ask in delegated mode resolves via trust derivation", async () => {
    for (const trusted of [true, false]) {
      const { opts } = testDispatchOptions({
        policy: () => "ask",
        approval: { mode: "delegated", isTrusted: () => trusted },
      });
      const result = await dispatchToolCall(call, opts);
      expect(result.ok).toBe(trusted);
    }
  });

  it("deny carries the policy reason as a retry instruction", async () => {
    const { opts } = testDispatchOptions({
      policy: () => ({ decision: "deny", reason: "write tools are disabled on this surface" }),
    });
    const result = await dispatchToolCall(call, opts);
    expect(result.content).toContain("write tools are disabled on this surface");
  });

  it("emits a permission-decided audit event from the wrapper on every decision", async () => {
    for (const policy of ["allow", "deny", "ask"] as const) {
      const { opts, events } = testDispatchOptions({
        policy: () => policy,
        approval: { mode: "background" },
      });
      await dispatchToolCall(call, opts);
      const decided = events.filter((e) => e.type === "permission-decided");
      expect(decided).toHaveLength(1);
      expect(decided[0]).toMatchObject({
        policy,
        outcome: policy === "allow" ? "allow" : "deny",
        callId: "p1",
      });
    }
  });

  it("a tool has no channel to bypass the permission gate", async () => {
    // The handler only runs after the wrapper's gates; a denied call must
    // never reach it, whatever the tool does.
    let ran = false;
    const { opts } = testDispatchOptions({
      registry: makeRegistry(echoTool({ handler: () => ((ran = true), { ok: true, content: "" }) })),
      policy: () => "deny",
    });
    await dispatchToolCall(call, opts);
    expect(ran).toBe(false);
  });
});
