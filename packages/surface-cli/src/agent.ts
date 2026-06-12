import type { PermissionPolicy, ToolRegistry as Registry } from "@otter/core";
import { ToolRegistry } from "@otter/core";
import {
  createBashTool,
  createEditFileTool,
  createReadFileTool,
  createSkillTool,
  createTodoTool,
  createWriteFileTool,
} from "@otter/tools-std";
import type { TodoItem } from "@otter/tools-std";

export interface WorkspaceAgentOptions {
  workdir: string;
  /** Directory containing skills/<name>/SKILL.md; omit for no skills. */
  skillsDir?: string;
  /** Restrict bash to these command prefixes; omit for unrestricted. */
  allowPrefixes?: string[];
}

export interface WorkspaceAgent {
  registry: Registry;
  getTodos: () => TodoItem[];
  /** Read-only tools run freely; anything that mutates asks (CLI = interactive). */
  policy: PermissionPolicy;
}

const READ_ONLY_TOOLS = new Set(["read_file", "skill", "todo"]);

export async function createWorkspaceAgent(
  options: WorkspaceAgentOptions,
): Promise<WorkspaceAgent> {
  const registry = new ToolRegistry();
  const todo = createTodoTool();

  registry
    .register(createReadFileTool(options.workdir))
    .register(createWriteFileTool(options.workdir))
    .register(createEditFileTool(options.workdir))
    .register(
      createBashTool({
        workdir: options.workdir,
        ...(options.allowPrefixes ? { allowPrefixes: options.allowPrefixes } : {}),
      }),
    )
    .register(todo.tool);

  if (options.skillsDir !== undefined) {
    registry.register(await createSkillTool(options.skillsDir));
  }

  const policy: PermissionPolicy = (call) =>
    READ_ONLY_TOOLS.has(call.name)
      ? "allow"
      : { decision: "ask", reason: `"${call.name}" can change the workspace` };

  return { registry, getTodos: todo.getTodos, policy };
}
