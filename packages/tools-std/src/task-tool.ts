import type { ModelAdapter, RunBudgets, ToolDefinition, ToolRegistry } from "@otter/core";
import { runAgent } from "@otter/core";

export interface SubagentRole {
  adapter: ModelAdapter;
  /**
   * Must not contain the task tool itself — subagents cannot spawn
   * subagents. Enforced at construction.
   */
  registry: ToolRegistry;
  system?: string;
  budgets?: RunBudgets;
}

export interface TaskToolOptions {
  /**
   * Typically: explorer = cheap model + read-only tools, executor = capable
   * model + delegated bash.
   */
  roles: Record<string, SubagentRole>;
}

/**
 * LCC s04: the task/subagent tool. The parent model delegates a prompt to a
 * role-scoped subagent and gets the subagent's final text back. Subagent
 * failures come back as strings, never as exceptions.
 */
export function createTaskTool(options: TaskToolOptions): ToolDefinition {
  const roleNames = Object.keys(options.roles);
  for (const [role, def] of Object.entries(options.roles)) {
    if (def.registry.resolve("task")) {
      throw new Error(
        `Role "${role}" includes the task tool in its registry; subagents must not spawn subagents.`,
      );
    }
  }

  return {
    name: "task",
    description: `Delegate a self-contained task to a subagent. Roles: ${roleNames.join(", ")}. The subagent sees only your prompt — include all needed context.`,
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", enum: roleNames },
        prompt: { type: "string", description: "Complete instructions for the subagent" },
      },
      required: ["role", "prompt"],
    },
    handler: async (args, ctx) => {
      const role = typeof args.role === "string" ? args.role : "";
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      const roleDef = options.roles[role];
      if (!roleDef || !prompt) {
        const message = `task requires a role (one of: ${roleNames.join(", ")}) and a non-empty prompt. Fix the arguments and retry.`;
        return { ok: false, content: message, error: { category: "validation", message } };
      }
      try {
        const result = await runAgent({
          adapter: roleDef.adapter,
          registry: roleDef.registry,
          prompt,
          approval: { mode: "background" },
          budgets: roleDef.budgets ?? { maxSteps: 15 },
          signal: ctx.signal,
          runId: `${ctx.runId}/task-${role}`,
          ...(roleDef.system !== undefined ? { system: roleDef.system } : {}),
        });
        const lastAssistant = result.transcript.findLast((m) => m.role === "assistant");
        const text = lastAssistant && lastAssistant.role === "assistant" ? lastAssistant.text : "";
        if (result.state === "completed") {
          return { ok: true, content: text || "(subagent returned no text)", data: { state: result.state, steps: result.steps } };
        }
        // Non-completed states are reported as text the parent can act on.
        const message = `Subagent (${role}) stopped without completing: ${result.stopReason} Last output: ${text || "(none)"}. Narrow the task or do it yourself with direct tools.`;
        return { ok: false, content: message, error: { category: "business-rule", message } };
      } catch (e) {
        // Subagent errors become strings, never exceptions (LCC s04 lesson).
        const message = `Subagent (${role}) failed: ${e instanceof Error ? e.message : String(e)}. Retry with a simpler prompt or do the task yourself.`;
        return { ok: false, content: message, error: { category: "server", message } };
      }
    },
  };
}
