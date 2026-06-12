import type { ToolCall, ToolContext } from "./types.js";

export type PolicyDecision = "allow" | "deny" | "ask";

/**
 * Per-call allow/deny/ask. The middle tier of the three-tier permission
 * model. Runs inside the dispatch wrapper — tools can never opt out
 * (invariant 5).
 */
export type PermissionPolicy = (
  call: ToolCall,
  ctx: ToolContext,
) =>
  | PolicyDecision
  | { decision: PolicyDecision; reason?: string }
  | Promise<PolicyDecision | { decision: PolicyDecision; reason?: string }>;

/** Human-in-the-loop resolution for "ask" decisions. */
export type ApprovalCallback = (call: ToolCall) => boolean | Promise<boolean>;

/**
 * Static tier of the permission model. Decides how an "ask" from the policy
 * is resolved:
 *  - background: nobody to ask — "ask" resolves to deny.
 *  - interactive: a human resolves it (CLI surface).
 *  - delegated: a trust derivation resolves it (Slack channel trust).
 */
export type ApprovalConfig =
  | { mode: "background" }
  | { mode: "interactive"; approve: ApprovalCallback }
  | {
      mode: "delegated";
      isTrusted: (call: ToolCall, ctx: ToolContext) => boolean | Promise<boolean>;
    };

export async function resolveAsk(
  config: ApprovalConfig,
  call: ToolCall,
  ctx: ToolContext,
): Promise<boolean> {
  switch (config.mode) {
    case "background":
      return false;
    case "interactive":
      return await config.approve(call);
    case "delegated":
      return await config.isTrusted(call, ctx);
  }
}
