// Invariant 8 (partial): budgets are shell-counted, not model-promised.
import { describe, expect, it } from "vitest";
import type { TrajectoryEvent } from "../src/index.js";
import { FakeAdapter, runAgent } from "../src/index.js";
import { makeRegistry } from "./helpers.js";

const endlessToolUser = () =>
  new FakeAdapter(
    Array.from({ length: 100 }, (_, i) => ({
      toolCalls: [{ id: `c${i}`, name: "echo", args: {} }],
    })),
  );

describe("run budgets", () => {
  it("stops at maxSteps with an explained budget-exceeded state", async () => {
    const adapter = endlessToolUser();
    const result = await runAgent({
      adapter,
      registry: makeRegistry(),
      prompt: "go",
      budgets: { maxSteps: 3 },
    });
    expect(result.state).toBe("budget-exceeded");
    expect(result.steps).toBe(3);
    expect(adapter.inputs).toHaveLength(3);
    expect(result.stopReason).toContain("3");
  });

  it("stops when the adapter-reported token budget is exhausted", async () => {
    const adapter = new FakeAdapter(
      Array.from({ length: 10 }, (_, i) => ({
        toolCalls: [{ id: `c${i}`, name: "echo", args: {} }],
        usage: { inputTokens: 40, outputTokens: 10 },
      })),
    );
    const result = await runAgent({
      adapter,
      registry: makeRegistry(),
      prompt: "go",
      budgets: { maxTokens: 100 },
    });
    expect(result.state).toBe("budget-exceeded");
    expect(result.usage.inputTokens + result.usage.outputTokens).toBe(100);
  });

  it("emits run-state-changed events for start and stop", async () => {
    const events: TrajectoryEvent[] = [];
    await runAgent({
      adapter: new FakeAdapter([]),
      registry: makeRegistry(),
      prompt: "go",
      onEvent: (e) => events.push(e),
    });
    const states = events.filter((e) => e.type === "run-state-changed");
    expect(states.map((e) => (e.type === "run-state-changed" ? e.state : ""))).toEqual([
      "running",
      "completed",
    ]);
  });

  it("a failing adapter ends the run as failed, not as a thrown exception", async () => {
    const adapter = {
      complete: async () => {
        throw new Error("socket hang up");
      },
    };
    const result = await runAgent({ adapter, registry: makeRegistry(), prompt: "go" });
    expect(result.state).toBe("failed");
    expect(result.stopReason).toContain("socket hang up");
  });
});
