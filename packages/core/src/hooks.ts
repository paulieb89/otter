import type { ToolCall, ToolContext } from "./types.js";

export type HookDecision =
  | { decision: "allow" }
  | { decision: "block"; reason: string }
  | { decision: "replace"; call: Omit<ToolCall, "id"> & { id?: string } };

/**
 * PreToolUse hooks run before policy for every tool call. Returning nothing
 * means allow. Replace decisions follow D015: the original call id is
 * preserved, the replacement re-enters hook+policy from the top, substitution
 * depth is capped at 3, and the returned shape is validated at runtime.
 */
export interface PreToolUseHook {
  name: string;
  run: (
    call: ToolCall,
    ctx: ToolContext,
  ) => HookDecision | void | Promise<HookDecision | void>;
}
