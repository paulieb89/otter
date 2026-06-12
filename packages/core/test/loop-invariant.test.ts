// Conformance: invariant 1 (D013).
// Continuation is decided by toolCalls.length > 0 and nothing else.
// finishReason is an open diagnostic string and must never drive control flow.
import { describe, expect, it } from "vitest";
import { FakeAdapter, runAgent } from "../src/index.js";
import { makeRegistry } from "./helpers.js";

describe("loop invariant (D013)", () => {
  it("continues when tool calls are present, even if finishReason claims the turn ended", async () => {
    const adapter = new FakeAdapter([
      {
        text: "calling a tool",
        toolCalls: [{ id: "c1", name: "echo", args: { value: "hi" } }],
        finishReason: "end_turn", // adversarial: claims completion
      },
      { text: "done", toolCalls: [], finishReason: "end_turn" },
    ]);
    const result = await runAgent({ adapter, registry: makeRegistry(), prompt: "go" });
    expect(adapter.inputs).toHaveLength(2); // loop continued past the lie
    expect(result.state).toBe("completed");
  });

  it("stops when there are no tool calls, even if finishReason claims tool use", async () => {
    const adapter = new FakeAdapter([
      { text: "no calls", toolCalls: [], finishReason: "tool_use" }, // adversarial
    ]);
    const result = await runAgent({ adapter, registry: makeRegistry(), prompt: "go" });
    expect(adapter.inputs).toHaveLength(1);
    expect(result.state).toBe("completed");
  });

  it("is inert to unknown finishReason values", async () => {
    for (const finishReason of ["pause_turn", "refusal", "gateway_burp", ""]) {
      const adapter = new FakeAdapter([
        {
          text: "",
          toolCalls: [{ id: "c1", name: "echo", args: {} }],
          finishReason,
        },
        { text: "done", toolCalls: [], finishReason },
      ]);
      const result = await runAgent({ adapter, registry: makeRegistry(), prompt: "go" });
      expect(result.state).toBe("completed");
      expect(adapter.inputs).toHaveLength(2);
    }
  });

  it("appends one tool result per call before the next model turn", async () => {
    const adapter = new FakeAdapter([
      {
        toolCalls: [
          { id: "a", name: "echo", args: { value: "1" } },
          { id: "b", name: "echo", args: { value: "2" } },
        ],
      },
      {},
    ]);
    await runAgent({ adapter, registry: makeRegistry(), prompt: "go" });
    const second = adapter.inputs[1]!;
    const toolMessage = second.transcript.findLast((m) => m.role === "tool");
    expect(toolMessage?.role).toBe("tool");
    expect(toolMessage && toolMessage.role === "tool" ? toolMessage.results.map((r) => r.callId) : []).toEqual(["a", "b"]);
  });
});
