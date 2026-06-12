// Conformance: invariant 2.
// Gate sequence: PreToolUse hook → PermissionPolicy → Registry resolve →
// Handler → cancellation watchdog. Every path produces exactly one ToolResult
// on the id the model emitted — never an exception out of the loop.
import { describe, expect, it } from "vitest";
import { FakeAdapter, dispatchToolCall, runAgent } from "../src/index.js";
import { echoTool, makeRegistry, testDispatchOptions } from "./helpers.js";

const call = (over: Partial<{ id: string; name: string; args: Record<string, unknown> }> = {}) => ({
  id: "call-1",
  name: "echo",
  args: { value: "ok" },
  ...over,
});

describe("gate sequence (invariant 2)", () => {
  it("runs gates in order: hook, policy, resolve, handler", async () => {
    const order: string[] = [];
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        echoTool({
          handler: () => {
            order.push("handler");
            return { ok: true, content: "ran" };
          },
        }),
      ),
      hooks: [{ name: "h", run: () => void order.push("hook") }],
      policy: () => {
        order.push("policy");
        return "allow";
      },
    });
    await dispatchToolCall(call(), opts);
    expect(order).toEqual(["hook", "policy", "handler"]);
  });

  it("hook block yields one synthetic result on the model's id; handler never runs", async () => {
    let ran = false;
    const { opts } = testDispatchOptions({
      registry: makeRegistry(echoTool({ handler: () => ((ran = true), { ok: true, content: "" }) })),
      hooks: [{ name: "blocker", run: () => ({ decision: "block", reason: "not allowed here" }) }],
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.callId).toBe("call-1");
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe("permission");
    expect(ran).toBe(false);
  });

  it("policy deny yields one synthetic result; handler never runs", async () => {
    let ran = false;
    const { opts } = testDispatchOptions({
      registry: makeRegistry(echoTool({ handler: () => ((ran = true), { ok: true, content: "" }) })),
      policy: () => "deny",
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.error?.category).toBe("permission");
    expect(result.callId).toBe("call-1");
    expect(ran).toBe(false);
  });

  it("unknown tool yields a validation result listing available tools", async () => {
    const { opts } = testDispatchOptions();
    const result = await dispatchToolCall(call({ name: "nope" }), opts);
    expect(result.error?.category).toBe("validation");
    expect(result.content).toContain("echo"); // retry instruction names alternatives
    expect(result.callId).toBe("call-1");
  });

  it("handler throw becomes a result, never an exception", async () => {
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        echoTool({
          handler: () => {
            throw new Error("boom");
          },
        }),
      ),
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe("server");
    expect(result.content).toContain("boom");
  });

  it("handler timeout yields a timeout result", async () => {
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        echoTool({ timeoutMs: 20, handler: () => new Promise(() => {}) }),
      ),
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.error?.category).toBe("timeout");
    expect(result.callId).toBe("call-1");
  });

  it("a malformed handler return is normalised into a server-category result", async () => {
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        // Cast simulates an ill-behaved tool implementation.
        echoTool({ handler: () => undefined as never }),
      ),
    });
    const result = await dispatchToolCall(call(), opts);
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe("server");
  });

  it("a throwing tool inside a run never breaks the loop", async () => {
    const adapter = new FakeAdapter([
      { toolCalls: [{ id: "x", name: "echo", args: {} }] },
      {},
    ]);
    const registry = makeRegistry(
      echoTool({
        handler: () => {
          throw new Error("kaboom");
        },
      }),
    );
    const result = await runAgent({ adapter, registry, prompt: "go" });
    expect(result.state).toBe("completed");
    const toolMessage = result.transcript.find((m) => m.role === "tool");
    expect(toolMessage && toolMessage.role === "tool" ? toolMessage.results[0]?.error?.category : undefined).toBe("server");
  });

  it("emits invocation-started and invocation-completed around every path", async () => {
    const { opts, events } = testDispatchOptions({ policy: () => "deny" });
    await dispatchToolCall(call(), opts);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("invocation-started");
    expect(types).toContain("permission-decided");
    expect(types[types.length - 1]).toBe("invocation-completed");
    expect(types.filter((t) => t === "invocation-completed")).toHaveLength(1);
  });
});
