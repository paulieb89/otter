import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeAdapter, ToolRegistry } from "@otter/core";
import { createSkillTool, createTaskTool, createTodoTool } from "../src/index.js";

const ctx = { runId: "t", signal: new AbortController().signal };

describe("todo tool", () => {
  it("replaces the list and renders it; surfaces read via getTodos", async () => {
    const { tool, getTodos } = createTodoTool();
    const result = await tool.handler(
      {
        todos: [
          { content: "read the repo", status: "completed" },
          { content: "edit the file", status: "in_progress" },
          { content: "verify", status: "pending" },
        ],
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe("[x] read the repo\n[~] edit the file\n[ ] verify");
    expect(getTodos()).toHaveLength(3);
  });

  it("rejects malformed items with the full-list retry instruction", async () => {
    const { tool } = createTodoTool();
    const result = await tool.handler({ todos: [{ content: 1, status: "nope" }] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe("validation");
    expect(result.content).toContain("full list");
  });
});

describe("skill tool (LCC s05: load on demand)", () => {
  it("lists skills in the description, loads bodies only when asked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otter-skills-"));
    await mkdir(join(dir, "deploy"), { recursive: true });
    await writeFile(
      join(dir, "deploy", "SKILL.md"),
      "---\nname: deploy\ndescription: How to deploy the service\n---\n\nFull deploy instructions here.",
    );
    const tool = await createSkillTool(dir);
    expect(tool.description).toContain("deploy: How to deploy the service");
    expect(tool.description).not.toContain("Full deploy instructions");

    const loaded = await tool.handler({ name: "deploy" }, ctx);
    expect(loaded.ok).toBe(true);
    expect(loaded.content).toContain("Full deploy instructions here.");

    const missing = await tool.handler({ name: "ghost" }, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.content).toContain("deploy"); // retry instruction lists real skills
  });
});

describe("task tool (LCC s04: role-scoped subagents)", () => {
  const emptyRegistry = () => new ToolRegistry();

  it("runs a subagent and returns its final text", async () => {
    const tool = createTaskTool({
      roles: {
        explorer: {
          adapter: new FakeAdapter([{ text: "Found 3 usages of foo.", toolCalls: [] }]),
          registry: emptyRegistry(),
        },
      },
    });
    const result = await tool.handler({ role: "explorer", prompt: "find foo" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("Found 3 usages of foo.");
  });

  it("refuses to construct when a role could spawn subagents recursively", () => {
    const recursive = new ToolRegistry();
    recursive.register(
      createTaskTool({
        roles: { explorer: { adapter: new FakeAdapter([]), registry: emptyRegistry() } },
      }),
    );
    expect(() =>
      createTaskTool({
        roles: { executor: { adapter: new FakeAdapter([]), registry: recursive } },
      }),
    ).toThrow(/subagents must not spawn subagents/);
  });

  it("turns subagent failures into strings, never exceptions", async () => {
    const tool = createTaskTool({
      roles: {
        explorer: {
          adapter: {
            complete: async () => {
              throw new Error("model exploded");
            },
          },
          registry: emptyRegistry(),
        },
      },
    });
    const result = await tool.handler({ role: "explorer", prompt: "go" }, ctx);
    expect(result.ok).toBe(false);
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("model exploded");
  });

  it("reports an exhausted subagent budget as actionable text", async () => {
    const adapter = new FakeAdapter(
      Array.from({ length: 30 }, (_, i) => ({
        toolCalls: [{ id: `c${i}`, name: "missing", args: {} }],
      })),
    );
    const tool = createTaskTool({
      roles: { explorer: { adapter, registry: emptyRegistry(), budgets: { maxSteps: 2 } } },
    });
    const result = await tool.handler({ role: "explorer", prompt: "loop forever" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("stopped without completing");
  });
});
