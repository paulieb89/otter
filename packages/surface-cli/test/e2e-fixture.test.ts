// Phase 2 gate fixture: an end-to-end run through the CLI surface's wiring —
// the agent reads a repo file, plans with todo, edits a file under
// interactive approval — recorded as assertions on the trajectory, the
// approval prompts, and the bytes on disk.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolCall, TrajectoryEvent } from "@otter/core";
import { FakeAdapter, runAgent } from "@otter/core";
import { createWorkspaceAgent } from "../src/index.js";

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "otter-e2e-"));
  await writeFile(
    join(workdir, "README.md"),
    "# demo\n\nVersion: 0.1.0\n",
  );
});

describe("CLI surface end-to-end (Phase 2 gate)", () => {
  it("reads the repo, plans with todo, edits a file under interactive approval", async () => {
    const adapter = new FakeAdapter([
      {
        text: "Planning the version bump.",
        toolCalls: [
          {
            id: "t1",
            name: "todo",
            args: {
              todos: [
                { content: "read README.md", status: "in_progress" },
                { content: "bump version to 0.2.0", status: "pending" },
              ],
            },
          },
        ],
      },
      {
        toolCalls: [{ id: "t2", name: "read_file", args: { path: "README.md" } }],
      },
      {
        toolCalls: [
          {
            id: "t3",
            name: "edit_file",
            args: { path: "README.md", old_text: "Version: 0.1.0", new_text: "Version: 0.2.0" },
          },
          {
            id: "t4",
            name: "todo",
            args: {
              todos: [
                { content: "read README.md", status: "completed" },
                { content: "bump version to 0.2.0", status: "completed" },
              ],
            },
          },
        ],
      },
      { text: "Bumped the version to 0.2.0.", toolCalls: [] },
    ]);

    const agent = await createWorkspaceAgent({ workdir });
    const approvalsAsked: ToolCall[] = [];
    const events: TrajectoryEvent[] = [];

    const result = await runAgent({
      adapter,
      registry: agent.registry,
      prompt: "bump the version in the readme",
      policy: agent.policy,
      approval: {
        mode: "interactive",
        approve: (call) => {
          approvalsAsked.push(call);
          return true;
        },
      },
      onEvent: (e) => events.push(e),
    });

    // The run completed and the edit landed on disk.
    expect(result.state).toBe("completed");
    expect(await readFile(join(workdir, "README.md"), "utf8")).toContain("Version: 0.2.0");

    // Interactive approval was asked exactly for the mutating call —
    // read-only tools (todo, read_file) ran without a prompt.
    expect(approvalsAsked.map((c) => c.name)).toEqual(["edit_file"]);

    // The plan finished fully checked off.
    expect(agent.getTodos()).toEqual([
      { content: "read README.md", status: "completed" },
      { content: "bump version to 0.2.0", status: "completed" },
    ]);

    // Recorded trajectory fixture: the gate decisions are all visible.
    const invocations = events
      .filter((e) => e.type === "invocation-started")
      .map((e) => (e.type === "invocation-started" ? e.call.name : ""));
    expect(invocations).toEqual(["todo", "read_file", "edit_file", "todo"]);

    const decisions = events
      .filter((e) => e.type === "permission-decided")
      .map((e) => (e.type === "permission-decided" ? `${e.policy}:${e.outcome}` : ""));
    expect(decisions).toEqual(["allow:allow", "allow:allow", "ask:allow", "allow:allow"]);

    const states = events
      .filter((e) => e.type === "run-state-changed")
      .map((e) => (e.type === "run-state-changed" ? e.state : ""));
    expect(states).toEqual(["running", "completed"]);

    // Every tool call got exactly one result on its own id (invariants 2+7).
    const completedIds = events
      .filter((e) => e.type === "invocation-completed")
      .map((e) => (e.type === "invocation-completed" ? e.result.callId : ""));
    expect(completedIds).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("a declined approval becomes a permission result and the run still completes", async () => {
    const adapter = new FakeAdapter([
      {
        toolCalls: [
          { id: "w1", name: "write_file", args: { path: "x.txt", content: "data" } },
        ],
      },
      { text: "Understood, not writing the file.", toolCalls: [] },
    ]);
    const agent = await createWorkspaceAgent({ workdir });
    const result = await runAgent({
      adapter,
      registry: agent.registry,
      prompt: "write a file",
      policy: agent.policy,
      approval: { mode: "interactive", approve: () => false },
    });
    expect(result.state).toBe("completed");
    const toolMessage = result.transcript.find((m) => m.role === "tool");
    const denial = toolMessage && toolMessage.role === "tool" ? toolMessage.results[0] : undefined;
    expect(denial?.error?.category).toBe("permission");
    await expect(readFile(join(workdir, "x.txt"), "utf8")).rejects.toThrow();
  });
});
