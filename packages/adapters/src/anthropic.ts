import Anthropic from "@anthropic-ai/sdk";
import type {
  ErrorCategory,
  ModelAdapter,
  ModelInput,
  ModelTurn,
  ToolCall,
  Transcript,
} from "@otter/core";

export interface AnthropicAdapterOptions {
  model: string;
  apiKey?: string;
  /** Point at a gateway/proxy instead of api.anthropic.com. */
  baseURL?: string;
  maxTokens?: number;
  /** Injection point for tests. */
  client?: Pick<Anthropic, "messages">;
}

type AnthropicMessage = Anthropic.MessageParam;

/** Maps the surface-neutral transcript onto Anthropic's message format. */
export function toAnthropicMessages(transcript: Transcript): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  for (const message of transcript) {
    switch (message.role) {
      case "user":
        messages.push({ role: "user", content: message.text });
        break;
      case "assistant": {
        const content: Anthropic.ContentBlockParam[] = [];
        if (message.text) content.push({ type: "text", text: message.text });
        for (const call of message.toolCalls) {
          content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
        }
        // Anthropic rejects empty content; an empty assistant turn cannot
        // occur mid-run (it would have ended the loop) but guard anyway.
        if (content.length === 0) content.push({ type: "text", text: "(no output)" });
        messages.push({ role: "assistant", content });
        break;
      }
      case "tool":
        messages.push({
          role: "user",
          content: message.results.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.callId,
            content: r.content,
            is_error: !r.ok,
          })),
        });
        break;
    }
  }
  return messages;
}

function classifyError(e: unknown): ErrorCategory {
  if (e instanceof Anthropic.APIConnectionError) return "network";
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    if (status === 429 || status === 529) return "transient";
    if (status !== undefined && status >= 500) return "server";
    if (status === 401 || status === 403) return "permission";
    return "server";
  }
  return "server";
}

export class AnthropicAdapter implements ModelAdapter {
  #client: Pick<Anthropic, "messages">;
  #model: string;
  #maxTokens: number;

  constructor(options: AnthropicAdapterOptions) {
    this.#model = options.model;
    this.#maxTokens = options.maxTokens ?? 8_000;
    this.#client =
      options.client ??
      new Anthropic({
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
      });
  }

  async complete(input: ModelInput): Promise<ModelTurn> {
    let response: Anthropic.Message;
    try {
      response = await this.#client.messages.create(
        {
          model: this.#model,
          max_tokens: this.#maxTokens,
          messages: toAnthropicMessages(input.transcript),
          tools: input.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
          })),
          ...(input.system !== undefined ? { system: input.system } : {}),
        },
        { ...(input.signal ? { signal: input.signal } : {}) },
      );
    } catch (e) {
      const error = new Error(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      ) as Error & { category: ErrorCategory };
      error.category = classifyError(e);
      throw error;
    }

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      finishReason: response.stop_reason ?? "",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
