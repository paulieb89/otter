import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition, ToolHandlerResult } from "@otter/core";
import { safePath } from "./paths.js";

function validationError(message: string): ToolHandlerResult {
  return { ok: false, content: message, error: { category: "validation", message } };
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Argument "${name}" must be a string. Fix the argument and retry.`);
  }
  return value;
}

export function createReadFileTool(workdir: string): ToolDefinition {
  return {
    name: "read_file",
    description:
      "Read a file inside the workspace. Optionally limit the number of lines returned.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root" },
        limit: { type: "integer", description: "Maximum lines to return" },
      },
      required: ["path"],
    },
    handler: async (args) => {
      try {
        const path = safePath(workdir, asString(args.path, "path"));
        const text = await readFile(path, "utf8");
        const lines = text.split("\n");
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const body =
          limit !== undefined && limit < lines.length
            ? [...lines.slice(0, limit), `... (${lines.length - limit} more lines; raise "limit" to see them)`].join("\n")
            : text;
        return { ok: true, content: body, data: { path: String(args.path), lines: lines.length } };
      } catch (e) {
        return validationError(
          `Could not read "${String(args.path)}": ${e instanceof Error ? e.message : e}. Check the path (try a directory listing first) and retry.`,
        );
      }
    },
  };
}

export function createWriteFileTool(workdir: string): ToolDefinition {
  return {
    name: "write_file",
    description: "Write content to a file inside the workspace, creating parent directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    handler: async (args) => {
      try {
        const path = safePath(workdir, asString(args.path, "path"));
        const content = asString(args.content, "content");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
        return {
          ok: true,
          content: `Wrote ${content.length} bytes to ${String(args.path)}`,
          data: { path: String(args.path), bytes: content.length },
        };
      } catch (e) {
        return validationError(
          `Could not write "${String(args.path)}": ${e instanceof Error ? e.message : e}. Fix the path or content and retry.`,
        );
      }
    },
  };
}

export function createEditFileTool(workdir: string): ToolDefinition {
  return {
    name: "edit_file",
    description:
      "Replace text in a file. old_text must appear exactly once; include enough surrounding context to make it unique.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
    handler: async (args) => {
      try {
        const path = safePath(workdir, asString(args.path, "path"));
        const oldText = asString(args.old_text, "old_text");
        const newText = asString(args.new_text, "new_text");
        const text = await readFile(path, "utf8");
        const first = text.indexOf(oldText);
        if (first === -1) {
          return validationError(
            `old_text not found in ${String(args.path)}. Read the file again and copy the exact text, including whitespace, then retry.`,
          );
        }
        if (text.indexOf(oldText, first + 1) !== -1) {
          return validationError(
            `old_text appears more than once in ${String(args.path)}. Add surrounding lines to make it unique, then retry.`,
          );
        }
        await writeFile(path, text.slice(0, first) + newText + text.slice(first + oldText.length), "utf8");
        return { ok: true, content: `Edited ${String(args.path)}`, data: { path: String(args.path) } };
      } catch (e) {
        return validationError(
          `Could not edit "${String(args.path)}": ${e instanceof Error ? e.message : e}. Check the path and retry.`,
        );
      }
    },
  };
}
