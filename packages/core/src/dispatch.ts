import type { PreToolUseHook } from "./hooks.js";
import type { ApprovalConfig, PermissionPolicy } from "./permissions.js";
import { resolveAsk } from "./permissions.js";
import type { ToolRegistry } from "./registry.js";
import type { EmitFn } from "./trajectory.js";
import type {
  ErrorCategory,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolHandlerResult,
  ToolResult,
} from "./types.js";

/** D015: a hook may substitute a call at most this many times per original. */
export const MAX_REPLACE_DEPTH = 3;

export const DEFAULT_GRACE_PERIOD_MS = 100;
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

export interface DispatchOptions {
  registry: ToolRegistry;
  approval: ApprovalConfig;
  emit: EmitFn;
  runId: string;
  signal: AbortSignal;
  hooks?: PreToolUseHook[];
  policy?: PermissionPolicy;
  /** Validated at run start: 0 is valid, Infinity is rejected (invariant 6). */
  gracePeriodMs?: number;
  defaultToolTimeoutMs?: number;
}

function syntheticError(
  category: ErrorCategory,
  message: string,
): ToolHandlerResult {
  return { ok: false, content: message, error: { category, message } };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isValidReplacement(value: unknown): value is Omit<ToolCall, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const call = value as Record<string, unknown>;
  return (
    typeof call.name === "string" &&
    call.name.length > 0 &&
    typeof call.args === "object" &&
    call.args !== null &&
    !Array.isArray(call.args)
  );
}

/**
 * The gate pipeline (invariant 2):
 *
 *   PreToolUse hooks → PermissionPolicy → Registry resolve → Handler →
 *   cancellation watchdog
 *
 * Every path — hook block, policy deny, unknown tool, handler throw, timeout,
 * cancellation — produces exactly one ToolResult on the id the model emitted.
 * Nothing thrown in here escapes to the loop.
 */
export async function dispatchToolCall(
  originalCall: ToolCall,
  opts: DispatchOptions,
): Promise<ToolResult> {
  const { registry, approval, emit, runId, signal } = opts;
  const hooks = opts.hooks ?? [];
  const gracePeriodMs = opts.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const ctx: ToolContext = { runId, signal };

  emit({ type: "invocation-started", call: originalCall });

  const finish = (raw: ToolHandlerResult): ToolResult => {
    // Invariant 7: stamp the original call id regardless of what the handler
    // (or any synthetic path) put there.
    const result: ToolResult = { ...raw, callId: originalCall.id };
    if (result.error) {
      emit({ type: "error-raised", callId: result.callId, error: result.error });
    }
    emit({ type: "invocation-completed", result });
    return result;
  };

  if (signal.aborted) {
    return finish(
      syntheticError("cancelled", `Tool call "${originalCall.name}" was cancelled before it started.`),
    );
  }

  let call: ToolCall = originalCall;
  let replaceDepth = 0;

  // Re-entered from the top each time a hook substitutes the call (D015).
  gates: for (;;) {
    // ── Gate 1: PreToolUse hooks ──────────────────────────────────────────
    for (const hook of hooks) {
      let decision;
      try {
        decision = await hook.run(call, ctx);
      } catch (e) {
        return finish(
          syntheticError(
            "server",
            `Hook "${hook.name}" failed while screening tool "${call.name}": ${errorMessage(e)}. The call was not executed; you may retry it.`,
          ),
        );
      }
      if (!decision || decision.decision === "allow") {
        emit({ type: "hook-fired", hook: hook.name, callId: originalCall.id, decision: "allow" });
        continue;
      }
      if (decision.decision === "block") {
        emit({ type: "hook-fired", hook: hook.name, callId: originalCall.id, decision: "block" });
        return finish(
          syntheticError(
            "permission",
            `Tool call "${call.name}" was blocked: ${decision.reason}. Adjust the call to satisfy this constraint and retry, or use a different tool.`,
          ),
        );
      }
      // Replace (D015).
      emit({ type: "hook-fired", hook: hook.name, callId: originalCall.id, decision: "replace" });
      if (!isValidReplacement(decision.call)) {
        return finish(
          syntheticError(
            "validation",
            `Hook "${hook.name}" returned a malformed replacement for tool "${call.name}". The call was not executed; you may retry it.`,
          ),
        );
      }
      replaceDepth += 1;
      if (replaceDepth > MAX_REPLACE_DEPTH) {
        return finish(
          syntheticError(
            "validation",
            `Tool call "${originalCall.name}" was rewritten more than ${MAX_REPLACE_DEPTH} times by hooks and was not executed. Simplify the call and retry.`,
          ),
        );
      }
      call = { name: decision.call.name, args: decision.call.args, id: originalCall.id };
      continue gates; // full re-entry: hooks, then policy, for the replacement
    }

    // ── Gate 2: PermissionPolicy + approval (three-tier, invariant 5) ─────
    let policyDecision: "allow" | "deny" | "ask" = "allow";
    let policyReason: string | undefined;
    if (opts.policy) {
      try {
        const raw = await opts.policy(call, ctx);
        if (typeof raw === "string") policyDecision = raw;
        else {
          policyDecision = raw.decision;
          policyReason = raw.reason;
        }
      } catch (e) {
        return finish(
          syntheticError(
            "server",
            `Permission policy failed while evaluating tool "${call.name}": ${errorMessage(e)}. The call was not executed; you may retry it.`,
          ),
        );
      }
    }

    let outcome: "allow" | "deny";
    if (policyDecision === "ask") {
      try {
        outcome = (await resolveAsk(approval, call, ctx)) ? "allow" : "deny";
      } catch (e) {
        emit({ type: "permission-decided", callId: originalCall.id, policy: policyDecision, outcome: "deny" });
        return finish(
          syntheticError(
            "server",
            `Approval for tool "${call.name}" could not be obtained: ${errorMessage(e)}. The call was not executed; you may retry it.`,
          ),
        );
      }
    } else {
      outcome = policyDecision;
    }
    emit({ type: "permission-decided", callId: originalCall.id, policy: policyDecision, outcome });

    if (outcome === "deny") {
      const detail = policyReason ? ` (${policyReason})` : "";
      return finish(
        syntheticError(
          "permission",
          `Permission to run tool "${call.name}" was denied${detail}. Do not retry the same call; choose a permitted tool or ask the user how to proceed.`,
        ),
      );
    }

    // ── Gate 3: Registry resolve ──────────────────────────────────────────
    const def = registry.resolve(call.name);
    if (!def) {
      const available = registry.names().join(", ") || "(none)";
      return finish(
        syntheticError(
          "validation",
          `Unknown tool "${call.name}". Available tools: ${available}. Retry with one of these.`,
        ),
      );
    }

    // ── Gate 4 + 5: Handler under the cancellation watchdog ──────────────
    const timeoutMs = def.timeoutMs ?? opts.defaultToolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const settled = await executeWithWatchdog(def, call, ctx, timeoutMs, gracePeriodMs);
    return finish(settled);
  }
}

function normalizeHandlerResult(raw: unknown, toolName: string): ToolHandlerResult {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as ToolHandlerResult).ok === "boolean" &&
    typeof (raw as ToolHandlerResult).content === "string"
  ) {
    return raw as ToolHandlerResult;
  }
  return syntheticError(
    "server",
    `Tool "${toolName}" returned a malformed result. Retry the call; if this repeats, use a different tool.`,
  );
}

/**
 * Non-cooperative cancellation (invariant 6): when the signal aborts, a grace
 * timer starts. A handler that settles within the grace period is the normal
 * path; otherwise a synthetic `cancelled` result is produced and the late
 * handler is absorbed silently. Timeouts use the same settle-once machinery.
 */
function executeWithWatchdog(
  def: ToolDefinition,
  call: ToolCall,
  ctx: ToolContext,
  timeoutMs: number,
  gracePeriodMs: number,
): Promise<ToolHandlerResult> {
  return new Promise((resolve) => {
    let done = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: ToolHandlerResult) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      ctx.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      const cancel = () =>
        settle(
          syntheticError(
            "cancelled",
            `Tool call "${call.name}" was cancelled while running.`,
          ),
        );
      if (gracePeriodMs === 0) cancel();
      else graceTimer = setTimeout(cancel, gracePeriodMs);
    };

    // The .then below attaches both fulfilment and rejection handlers
    // immediately, so a handler that settles after cancellation is absorbed —
    // it can never surface as an unhandled rejection (absorbers are attached
    // before this function returns).
    Promise.resolve()
      .then(() => def.handler(call.args, ctx))
      .then(
        (result) => settle(normalizeHandlerResult(result, call.name)),
        (e) =>
          settle(
            syntheticError(
              "server",
              `Tool "${call.name}" failed: ${errorMessage(e)}. Check the arguments and retry, or use a different tool.`,
            ),
          ),
      );

    if (Number.isFinite(timeoutMs)) {
      timeoutTimer = setTimeout(
        () =>
          settle(
            syntheticError(
              "timeout",
              `Tool call "${call.name}" timed out after ${timeoutMs}ms. Retry with a smaller or simpler request.`,
            ),
          ),
        timeoutMs,
      );
    }

    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort, { once: true });
  });
}
