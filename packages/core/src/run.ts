import type { ModelAdapter } from "./adapter.js";
import { DEFAULT_GRACE_PERIOD_MS, dispatchToolCall } from "./dispatch.js";
import type { PreToolUseHook } from "./hooks.js";
import type { ApprovalConfig, PermissionPolicy } from "./permissions.js";
import type { ToolRegistry } from "./registry.js";
import { createEmitter } from "./trajectory.js";
import type {
  ErrorCategory,
  ModelUsage,
  RunEndState,
  ToolResult,
  Transcript,
  TrajectorySink,
} from "./types.js";
import { ERROR_CATEGORIES } from "./types.js";

export interface RunBudgets {
  /** Maximum model calls. Shell-counted (invariant 8). */
  maxSteps?: number;
  /** Maximum cumulative input+output tokens, as reported by the adapter. */
  maxTokens?: number;
  /** Wall-clock ceiling for the whole run. */
  wallClockMs?: number;
}

export const DEFAULT_MAX_STEPS = 50;

export interface RunOptions {
  adapter: ModelAdapter;
  registry: ToolRegistry;
  /** Seed transcript; `prompt` (if given) is appended as a user message. */
  transcript?: Transcript;
  prompt?: string;
  system?: string;
  hooks?: PreToolUseHook[];
  policy?: PermissionPolicy;
  /** Defaults to background: "ask" resolves to deny unless a surface says otherwise. */
  approval?: ApprovalConfig;
  budgets?: RunBudgets;
  signal?: AbortSignal;
  /** 0 is valid; Infinity is rejected at run start (invariant 6). */
  gracePeriodMs?: number;
  defaultToolTimeoutMs?: number;
  onEvent?: TrajectorySink;
  runId?: string;
}

export interface RunResult {
  runId: string;
  state: RunEndState;
  /** Human-readable explanation of why the run stopped. */
  stopReason: string;
  transcript: Transcript;
  steps: number;
  usage: ModelUsage;
}

function adapterErrorCategory(e: unknown): ErrorCategory {
  const category = (e as { category?: unknown })?.category;
  return typeof category === "string" &&
    (ERROR_CATEGORIES as readonly string[]).includes(category)
    ? (category as ErrorCategory)
    : "server";
}

let runCounter = 0;

/**
 * The agent loop. Continuation is decided by toolCalls.length > 0 and nothing
 * else (D013). Budgets are counted here, in the deterministic shell — never
 * delegated to the model.
 */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  if (
    typeof gracePeriodMs !== "number" ||
    Number.isNaN(gracePeriodMs) ||
    gracePeriodMs < 0 ||
    !Number.isFinite(gracePeriodMs)
  ) {
    throw new TypeError(
      `gracePeriodMs must be a finite number >= 0 (got ${gracePeriodMs})`,
    );
  }

  const runId = options.runId ?? `run-${Date.now()}-${++runCounter}`;
  const emit = createEmitter(runId, options.onEvent);
  const approval = options.approval ?? { mode: "background" };
  const signal = options.signal ?? new AbortController().signal;
  const transcript: Transcript = [...(options.transcript ?? [])];
  if (options.prompt !== undefined) {
    transcript.push({ role: "user", text: options.prompt });
    emit({ type: "transcript-appended", message: transcript[transcript.length - 1]! });
  }

  const maxSteps = options.budgets?.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxTokens = options.budgets?.maxTokens;
  const wallClockMs = options.budgets?.wallClockMs;
  const startedAt = Date.now();

  let steps = 0;
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };

  emit({ type: "run-state-changed", state: "running" });

  const end = (state: RunEndState, stopReason: string): RunResult => {
    emit({ type: "run-state-changed", state, reason: stopReason });
    return { runId, state, stopReason, transcript, steps, usage };
  };

  for (;;) {
    if (signal.aborted) {
      return end("cancelled", "Run cancelled by caller.");
    }
    if (steps >= maxSteps) {
      return end("budget-exceeded", `Step budget exhausted (${maxSteps} model calls).`);
    }
    if (maxTokens !== undefined && usage.inputTokens + usage.outputTokens >= maxTokens) {
      return end("budget-exceeded", `Token budget exhausted (${maxTokens} tokens).`);
    }
    if (wallClockMs !== undefined && Date.now() - startedAt >= wallClockMs) {
      return end("budget-exceeded", `Wall-clock budget exhausted (${wallClockMs}ms).`);
    }

    let turn;
    try {
      turn = await options.adapter.complete({
        transcript,
        tools: options.registry.list(),
        ...(options.system !== undefined ? { system: options.system } : {}),
        signal,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit({
        type: "error-raised",
        error: { category: adapterErrorCategory(e), message },
      });
      return end("failed", `Model call failed: ${message}`);
    }

    steps += 1;
    if (turn.usage) {
      usage.inputTokens += turn.usage.inputTokens;
      usage.outputTokens += turn.usage.outputTokens;
    }
    emit({ type: "model-turn-received", turn });

    const assistant = {
      role: "assistant",
      text: turn.text,
      toolCalls: turn.toolCalls,
    } as const;
    transcript.push(assistant);
    emit({ type: "transcript-appended", message: assistant });

    // D013: the sole continuation test. finishReason is never consulted.
    if (turn.toolCalls.length === 0) {
      return end("completed", "Model produced a final answer.");
    }

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      results.push(
        await dispatchToolCall(call, {
          registry: options.registry,
          approval,
          emit,
          runId,
          signal,
          gracePeriodMs,
          ...(options.hooks ? { hooks: options.hooks } : {}),
          ...(options.policy ? { policy: options.policy } : {}),
          ...(options.defaultToolTimeoutMs !== undefined
            ? { defaultToolTimeoutMs: options.defaultToolTimeoutMs }
            : {}),
        }),
      );
    }
    const toolMessage = { role: "tool", results } as const;
    transcript.push(toolMessage);
    emit({ type: "transcript-appended", message: toolMessage });
  }
}
