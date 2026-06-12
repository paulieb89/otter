import type { TrajectoryEvent } from "@otter/core";

const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function truncate(text: string, max = 400): string {
  return text.length > max ? text.slice(0, max) + " …" : text;
}

/**
 * One line (or short block) per trajectory event, so a CLI run shows the
 * same legibility the web inspector will: every call, every gate decision.
 * Returns undefined for events the terminal doesn't need to show.
 */
export function renderEvent(event: TrajectoryEvent): string | undefined {
  switch (event.type) {
    case "invocation-started":
      return `${YELLOW}> ${event.call.name}${RESET} ${DIM}${truncate(JSON.stringify(event.call.args), 160)}${RESET}`;
    case "invocation-completed":
      return event.result.ok
        ? DIM + truncate(event.result.content) + RESET
        : `${RED}✗ ${truncate(event.result.content)}${RESET}`;
    case "permission-decided":
      return `${DIM}  permission: ${event.policy} → ${event.outcome}${RESET}`;
    case "hook-fired":
      return `${DIM}  hook ${event.hook}: ${event.decision}${RESET}`;
    case "run-state-changed":
      return event.state === "running"
        ? undefined
        : `${DIM}run ${event.state}${event.reason ? ` — ${event.reason}` : ""}${RESET}`;
    case "error-raised":
    case "model-turn-received":
    case "transcript-appended":
      return undefined; // text and results are rendered via the events above
  }
}
