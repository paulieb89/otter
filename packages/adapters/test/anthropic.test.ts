import { describe, expect, it } from "vitest";
import type { Transcript } from "@otter/core";
import { AnthropicAdapter, toAnthropicMessages } from "../src/index.js";

describe("transcript mapping", () => {
  it("maps user/assistant/tool messages onto Anthropic format", () => {
    const transcript: Transcript = [
      { role: "user", text: "hi" },
      {
        role: "assistant",
        text: "let me check",
        toolCalls: [{ id: "t1", name: "read_file", args: { path: "a.txt" } }],
      },
      {
        role: "tool",
        results: [{ callId: "t1", ok: false, content: "not found", error: { category: "validation", message: "not found" } }],
      },
    ];
    const messages = toAnthropicMessages(transcript);
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.txt" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "not found", is_error: true }],
      },
    ]);
  });
});

describe("AnthropicAdapter", () => {
  const fakeResponse = {
    content: [
      { type: "text", text: "checking " },
      { type: "tool_use", id: "call-1", name: "bash", input: { command: "ls" } },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 12, output_tokens: 34 },
  };

  it("parses content blocks into a ModelTurn", async () => {
    const requests: unknown[] = [];
    const adapter = new AnthropicAdapter({
      model: "claude-sonnet-4-6",
      client: {
        messages: {
          create: async (body: unknown) => {
            requests.push(body);
            return fakeResponse;
          },
        },
      } as never,
    });
    const turn = await adapter.complete({
      transcript: [{ role: "user", text: "list files" }],
      tools: [
        { name: "bash", description: "run", inputSchema: { type: "object" }, handler: () => ({ ok: true, content: "" }) },
      ],
      system: "be brief",
    });
    expect(turn.text).toBe("checking ");
    expect(turn.toolCalls).toEqual([{ id: "call-1", name: "bash", args: { command: "ls" } }]);
    expect(turn.finishReason).toBe("tool_use");
    expect(turn.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
    expect(requests[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      system: "be brief",
      tools: [{ name: "bash", description: "run" }],
    });
  });

  it("classifies thrown failures with an error category for the loop", async () => {
    const adapter = new AnthropicAdapter({
      model: "m",
      client: {
        messages: {
          create: async () => {
            throw new Error("ECONNRESET");
          },
        },
      } as never,
    });
    await expect(
      adapter.complete({ transcript: [{ role: "user", text: "x" }], tools: [] }),
    ).rejects.toMatchObject({ category: "server" });
  });
});
