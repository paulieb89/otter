import type { ModelAdapter, ModelInput } from "./adapter.js";
import type { ModelTurn } from "./types.js";

export type FakeTurn = Partial<ModelTurn> | ((input: ModelInput) => ModelTurn);

/**
 * Scripted adapter for conformance tests and surface development. Plays the
 * given turns in order; once exhausted it returns a terminal turn with no
 * tool calls so the loop ends.
 */
export class FakeAdapter implements ModelAdapter {
  readonly inputs: ModelInput[] = [];
  #turns: FakeTurn[];

  constructor(turns: FakeTurn[] = []) {
    this.#turns = [...turns];
  }

  async complete(input: ModelInput): Promise<ModelTurn> {
    this.inputs.push(input);
    const next = this.#turns.shift();
    if (next === undefined) {
      return { text: "(done)", toolCalls: [], finishReason: "end_turn" };
    }
    if (typeof next === "function") return next(input);
    return {
      text: next.text ?? "",
      toolCalls: next.toolCalls ?? [],
      finishReason: next.finishReason ?? "end_turn",
      ...(next.usage ? { usage: next.usage } : {}),
    };
  }
}
