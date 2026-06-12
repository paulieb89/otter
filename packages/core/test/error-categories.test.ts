// Conformance: invariant 3 (D014).
// Error categories and trajectory event types are fixed, closed sets.
import { describe, expect, it } from "vitest";
import { ERROR_CATEGORIES, TRAJECTORY_EVENT_TYPES } from "../src/index.js";

describe("fixed taxonomies (D014)", () => {
  it("error categories are exactly the eight from D014", () => {
    expect([...ERROR_CATEGORIES].sort()).toEqual(
      [
        "validation",
        "permission",
        "transient",
        "business-rule",
        "network",
        "server",
        "timeout",
        "cancelled",
      ].sort(),
    );
    expect(ERROR_CATEGORIES).toHaveLength(8);
  });

  it("trajectory event types are exactly the eight from D014", () => {
    expect([...TRAJECTORY_EVENT_TYPES].sort()).toEqual(
      [
        "model-turn-received",
        "transcript-appended",
        "hook-fired",
        "permission-decided",
        "invocation-started",
        "error-raised",
        "invocation-completed",
        "run-state-changed",
      ].sort(),
    );
    expect(TRAJECTORY_EVENT_TYPES).toHaveLength(8);
  });
});
