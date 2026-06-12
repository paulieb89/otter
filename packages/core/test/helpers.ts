import type {
  DispatchOptions,
  ToolDefinition,
  ToolHandlerResult,
  TrajectoryEvent,
} from "../src/index.js";
import { ToolRegistry, createEmitter } from "../src/index.js";

export function echoTool(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "echo",
    description: "Echoes its input back.",
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
    handler: (args): ToolHandlerResult => ({
      ok: true,
      content: String(args.value ?? ""),
    }),
    ...over,
  };
}

export function makeRegistry(...tools: ToolDefinition[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools.length ? tools : [echoTool()]) registry.register(tool);
  return registry;
}

export interface TestDispatch {
  opts: DispatchOptions;
  events: TrajectoryEvent[];
  controller: AbortController;
}

export function testDispatchOptions(
  over: Partial<DispatchOptions> = {},
): TestDispatch {
  const events: TrajectoryEvent[] = [];
  const controller = new AbortController();
  const opts: DispatchOptions = {
    registry: makeRegistry(),
    approval: { mode: "background" },
    emit: createEmitter("test-run", (e) => events.push(e)),
    runId: "test-run",
    signal: controller.signal,
    ...over,
  };
  return { opts, events, controller };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
