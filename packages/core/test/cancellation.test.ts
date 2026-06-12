// Conformance: invariant 6.
// Non-cooperative cancellation: abort → grace timer → settle-in-grace is the
// normal path, else a synthetic `cancelled` result; the late handler is
// absorbed silently. gracePeriodMs 0 is valid; Infinity is rejected at run
// start.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAdapter, dispatchToolCall, runAgent } from "../src/index.js";
import { echoTool, makeRegistry, sleep, testDispatchOptions } from "./helpers.js";

const call = { id: "c1", name: "echo", args: {} };

describe("non-cooperative cancellation (invariant 6)", () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it("a handler that settles within the grace period takes the normal path", async () => {
    const { opts, controller } = testDispatchOptions({
      gracePeriodMs: 100,
      registry: makeRegistry(
        echoTool({
          handler: (_args, ctx) =>
            new Promise((resolve) => {
              ctx.signal.addEventListener("abort", () =>
                setTimeout(() => resolve({ ok: true, content: "made it in grace" }), 10),
              );
            }),
        }),
      ),
    });
    const pending = dispatchToolCall(call, opts);
    await sleep(10);
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.content).toBe("made it in grace");
  });

  it("a handler that outlives the grace period yields a synthetic cancelled result", async () => {
    const { opts, controller } = testDispatchOptions({
      gracePeriodMs: 20,
      registry: makeRegistry(echoTool({ handler: () => new Promise(() => {}) })),
    });
    const pending = dispatchToolCall(call, opts);
    await sleep(5);
    controller.abort();
    const result = await pending;
    expect(result.error?.category).toBe("cancelled");
    expect(result.callId).toBe("c1");
  });

  it("a late-rejecting handler is absorbed silently — no unhandled rejection", async () => {
    const { opts, controller } = testDispatchOptions({
      gracePeriodMs: 0,
      registry: makeRegistry(
        echoTool({
          handler: () =>
            new Promise((_resolve, reject) =>
              setTimeout(() => reject(new Error("late failure")), 30),
            ),
        }),
      ),
    });
    const pending = dispatchToolCall(call, opts);
    await sleep(5);
    controller.abort();
    const result = await pending;
    expect(result.error?.category).toBe("cancelled");
    await sleep(60); // let the late rejection fire
    expect(unhandled).toEqual([]);
  });

  it("gracePeriodMs 0 cancels immediately on abort", async () => {
    const { opts, controller } = testDispatchOptions({
      gracePeriodMs: 0,
      registry: makeRegistry(echoTool({ handler: () => new Promise(() => {}) })),
    });
    const pending = dispatchToolCall(call, opts);
    await sleep(5);
    controller.abort();
    expect((await pending).error?.category).toBe("cancelled");
  });

  it("gracePeriodMs Infinity is rejected at run start, before any model call", async () => {
    const adapter = new FakeAdapter([]);
    await expect(
      runAgent({
        adapter,
        registry: makeRegistry(),
        prompt: "go",
        gracePeriodMs: Infinity,
      }),
    ).rejects.toThrow(TypeError);
    expect(adapter.inputs).toHaveLength(0);
  });

  it("an already-aborted signal cancels the run without calling the model", async () => {
    const adapter = new FakeAdapter([]);
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent({
      adapter,
      registry: makeRegistry(),
      prompt: "go",
      signal: controller.signal,
    });
    expect(result.state).toBe("cancelled");
    expect(adapter.inputs).toHaveLength(0);
  });

  it("a call dispatched after abort is cancelled without invoking the handler", async () => {
    let ran = false;
    const { opts, controller } = testDispatchOptions({
      registry: makeRegistry(echoTool({ handler: () => ((ran = true), { ok: true, content: "" }) })),
    });
    controller.abort();
    const result = await dispatchToolCall(call, opts);
    expect(result.error?.category).toBe("cancelled");
    expect(ran).toBe(false);
  });
});
