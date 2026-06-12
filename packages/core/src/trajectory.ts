import type { TrajectoryEvent, TrajectorySink } from "./types.js";

/** Omit that distributes over union members. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type TrajectoryEventInput = DistributiveOmit<
  TrajectoryEvent,
  "runId" | "seq" | "timestamp"
>;

export type EmitFn = (event: TrajectoryEventInput) => void;

/**
 * Stamps runId/seq/timestamp and forwards to the sink. A throwing sink is
 * swallowed: observability must never alter run behaviour.
 */
export function createEmitter(runId: string, sink?: TrajectorySink): EmitFn {
  let seq = 0;
  return (event) => {
    const full: TrajectoryEvent = { ...event, runId, seq: seq++, timestamp: Date.now() };
    try {
      sink?.(full);
    } catch {
      // Sinks are observers only; their failures never reach the loop.
    }
  };
}
