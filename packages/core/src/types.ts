/**
 * Core types for the Otter agent loop.
 *
 * The two closed sets in this file — ERROR_CATEGORIES and
 * TRAJECTORY_EVENT_TYPES — are fixed by decision D014. Do not add members;
 * map new failure modes onto the nearest existing category and carry detail
 * in free-text fields.
 */

export const ERROR_CATEGORIES = [
  "validation",
  "permission",
  "transient",
  "business-rule",
  "network",
  "server",
  "timeout",
  "cancelled",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface ToolError {
  category: ErrorCategory;
  /** Written as a retry instruction for the model, not just a diagnosis. */
  message: string;
}

export interface ToolCall {
  /** Id emitted by the model. Exactly one ToolResult is produced on it. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  /** Always the id of the call the model emitted (invariant 7). */
  callId: string;
  ok: boolean;
  /** Raw text for the model, returned alongside any structured fields. */
  content: string;
  /** Optional structured payload for surfaces and programmatic consumers. */
  data?: unknown;
  error?: ToolError;
}

/** What a tool handler returns; the dispatcher stamps the callId. */
export interface ToolHandlerResult {
  ok: boolean;
  content: string;
  data?: unknown;
  error?: ToolError;
  /** Ignored: overwritten with the original call id by the dispatcher. */
  callId?: string;
}

export interface ToolContext {
  runId: string;
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments, passed through to the adapter. */
  inputSchema: Record<string, unknown>;
  /** Per-tool execution timeout; falls back to the run's default. */
  timeoutMs?: number;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => ToolHandlerResult | Promise<ToolHandlerResult>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  /**
   * Opaque provider diagnostic. Carried for trajectory only — no code may
   * branch on it (D013). Loop continuation is toolCalls.length > 0.
   */
  finishReason: string;
  usage?: ModelUsage;
}

// ── Transcript ──────────────────────────────────────────────────────────────

export interface UserMessage {
  role: "user";
  text: string;
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  toolCalls: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  results: ToolResult[];
}

export type TranscriptMessage = UserMessage | AssistantMessage | ToolMessage;

export type Transcript = TranscriptMessage[];

// ── Run state ───────────────────────────────────────────────────────────────

export type RunEndState = "completed" | "cancelled" | "failed" | "budget-exceeded";
export type RunState = "running" | RunEndState;

// ── Trajectory events (closed set, D014) ────────────────────────────────────

export const TRAJECTORY_EVENT_TYPES = [
  "model-turn-received",
  "transcript-appended",
  "hook-fired",
  "permission-decided",
  "invocation-started",
  "error-raised",
  "invocation-completed",
  "run-state-changed",
] as const;

export type TrajectoryEventType = (typeof TRAJECTORY_EVENT_TYPES)[number];

interface TrajectoryEventBase {
  runId: string;
  /** Monotonic per run; lets consumers order and detect gaps. */
  seq: number;
  timestamp: number;
}

export type TrajectoryEvent = TrajectoryEventBase &
  (
    | { type: "model-turn-received"; turn: ModelTurn }
    | { type: "transcript-appended"; message: TranscriptMessage }
    | {
        type: "hook-fired";
        hook: string;
        callId: string;
        decision: "allow" | "block" | "replace";
      }
    | {
        type: "permission-decided";
        callId: string;
        policy: "allow" | "deny" | "ask";
        outcome: "allow" | "deny";
      }
    | { type: "invocation-started"; call: ToolCall }
    | { type: "error-raised"; callId?: string; error: ToolError }
    | { type: "invocation-completed"; result: ToolResult }
    | { type: "run-state-changed"; state: RunState; reason?: string }
  );

export type TrajectorySink = (event: TrajectoryEvent) => void;
