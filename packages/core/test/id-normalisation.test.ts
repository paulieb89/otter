// Conformance: invariant 7.
// Handler-returned results are stamped with the original call id:
// { ...result, callId: originalCall.id }.
import { describe, expect, it } from "vitest";
import { dispatchToolCall } from "../src/index.js";
import { echoTool, makeRegistry, testDispatchOptions } from "./helpers.js";

describe("id normalisation (invariant 7)", () => {
  it("overwrites a wrong callId returned by the handler", async () => {
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        echoTool({ handler: () => ({ ok: true, content: "x", callId: "bogus-id" }) }),
      ),
    });
    const result = await dispatchToolCall({ id: "real-id", name: "echo", args: {} }, opts);
    expect(result.callId).toBe("real-id");
  });

  it("stamps the id when the handler returns none", async () => {
    const { opts } = testDispatchOptions();
    const result = await dispatchToolCall({ id: "the-id", name: "echo", args: { value: "v" } }, opts);
    expect(result.callId).toBe("the-id");
  });

  it("preserves the rest of the handler result untouched", async () => {
    const { opts } = testDispatchOptions({
      registry: makeRegistry(
        echoTool({
          handler: () => ({ ok: true, content: "text", data: { rows: [1, 2] }, callId: "junk" }),
        }),
      ),
    });
    const result = await dispatchToolCall({ id: "id-9", name: "echo", args: {} }, opts);
    expect(result).toEqual({ ok: true, content: "text", data: { rows: [1, 2] }, callId: "id-9" });
  });
});
