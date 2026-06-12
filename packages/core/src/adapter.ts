import type { ModelTurn, ToolDefinition, Transcript } from "./types.js";

export interface ModelInput {
  transcript: Transcript;
  tools: ToolDefinition[];
  system?: string;
  signal?: AbortSignal;
}

/**
 * The only way the core reaches a model. Provider SDKs live in
 * @otter/adapters — never in this package (invariant 9).
 *
 * Adapters are responsible for parsing provider output into toolCalls; the
 * loop trusts only that array (D013). An adapter may throw an object with a
 * `category` from ERROR_CATEGORIES to classify the failure; anything else is
 * treated as `server`.
 */
export interface ModelAdapter {
  complete(input: ModelInput): Promise<ModelTurn>;
}
