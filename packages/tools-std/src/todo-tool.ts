import type { ToolDefinition } from "@otter/core";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

const MARKS: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

export function renderTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "(todo list is empty)";
  return todos.map((t) => `${MARKS[t.status]} ${t.content}`).join("\n");
}

export interface TodoToolHandle {
  tool: ToolDefinition;
  /** Surfaces read the current plan from here to render it live. */
  getTodos: () => TodoItem[];
}

const VALID_STATUS: TodoStatus[] = ["pending", "in_progress", "completed"];

/**
 * LCC s03: the todo tool. The model writes the whole list each time; the
 * surface renders it as the visible plan.
 */
export function createTodoTool(): TodoToolHandle {
  let todos: TodoItem[] = [];
  const tool: ToolDefinition = {
    name: "todo",
    description:
      "Write your task plan. Pass the full list every time (it replaces the previous list). Keep exactly one item in_progress while working.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: VALID_STATUS },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    handler: (args) => {
      const raw = args.todos;
      if (!Array.isArray(raw)) {
        const message = 'Argument "todos" must be an array of {content, status}. Retry with the full list.';
        return { ok: false, content: message, error: { category: "validation", message } };
      }
      const next: TodoItem[] = [];
      for (const item of raw) {
        const content = (item as TodoItem)?.content;
        const status = (item as TodoItem)?.status;
        if (typeof content !== "string" || !VALID_STATUS.includes(status)) {
          const message = `Each todo needs string "content" and status one of ${VALID_STATUS.join("/")}. Fix the malformed item and retry with the full list.`;
          return { ok: false, content: message, error: { category: "validation", message } };
        }
        next.push({ content, status });
      }
      todos = next;
      return { ok: true, content: renderTodos(todos), data: { todos } };
    },
  };
  return { tool, getTodos: () => [...todos] };
}
