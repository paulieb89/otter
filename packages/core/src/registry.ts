import type { ToolDefinition } from "./types.js";

export class ToolRegistry {
  #tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): this {
    if (this.#tools.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this.#tools.set(def.name, def);
    return this;
  }

  resolve(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.#tools.values()];
  }

  names(): string[] {
    return [...this.#tools.keys()];
  }
}
