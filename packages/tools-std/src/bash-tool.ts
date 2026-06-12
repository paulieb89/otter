import { exec } from "node:child_process";
import type { ToolDefinition, ToolHandlerResult } from "@otter/core";

export interface BashToolOptions {
  workdir: string;
  /**
   * When set, only commands whose first token starts with one of these
   * prefixes may run. The chain-operator check runs FIRST: an allowlisted
   * prefix must not smuggle a second command behind `&&`, `;`, `|`, `$()`,
   * backticks or newlines.
   */
  allowPrefixes?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/** Substrings that chain or substitute commands, defeating a prefix check. */
const CHAIN_OPERATORS = ["&&", "||", ";", "|", "`", "$(", "\n", ">(", "<("];

const ALWAYS_BLOCKED = [/\brm\s+-rf\s+\//, /\bsudo\b/, /\bshutdown\b/, /\breboot\b/, /\bmkfs\b/];

export function findChainOperator(command: string): string | undefined {
  return CHAIN_OPERATORS.find((op) => command.includes(op));
}

function blocked(message: string): ToolHandlerResult {
  return { ok: false, content: message, error: { category: "permission", message } };
}

export function createBashTool(options: BashToolOptions): ToolDefinition {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 50_000;

  return {
    name: "bash",
    description:
      "Run a single shell command in the workspace. Do not chain commands with &&, ; or pipes — issue one command per call.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string", description: "The command to run" } },
      required: ["command"],
    },
    timeoutMs: timeoutMs + 1_000, // outer watchdog backstops the inner kill
    handler: (args) => {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      if (!command) {
        return {
          ok: false,
          content: 'Argument "command" must be a non-empty string. Provide a command and retry.',
          error: { category: "validation", message: "command must be a non-empty string" },
        };
      }

      for (const pattern of ALWAYS_BLOCKED) {
        if (pattern.test(command)) {
          return blocked(
            `Command blocked: it matches a destructive pattern (${pattern}). Choose a safer command.`,
          );
        }
      }

      if (options.allowPrefixes) {
        // Order matters: chain operators are checked BEFORE the prefix
        // allowlist, otherwise "git status && <anything>" rides the "git"
        // prefix straight past the check.
        const op = findChainOperator(command);
        if (op !== undefined) {
          return blocked(
            `Command contains "${op}", which chains or substitutes commands. Issue a single command per call and retry.`,
          );
        }
        if (!options.allowPrefixes.some((p) => command === p || command.startsWith(p + " "))) {
          return blocked(
            `Command not in the allowed set. Allowed prefixes: ${options.allowPrefixes.join(", ")}. Retry with one of these.`,
          );
        }
      }

      return new Promise<ToolHandlerResult>((resolve) => {
        exec(
          command,
          { cwd: options.workdir, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            const out = (stdout + stderr).trim();
            const truncated =
              out.length > maxOutputBytes
                ? out.slice(0, maxOutputBytes) + "\n... (output truncated)"
                : out;
            if (error && error.killed) {
              const message = `Command timed out after ${timeoutMs}ms. Retry with a faster command or narrower scope.`;
              resolve({ ok: false, content: message, error: { category: "timeout", message } });
            } else if (error) {
              resolve({
                ok: false,
                content:
                  (truncated || error.message) +
                  `\n(exit code ${error.code ?? "?"}; fix the command and retry)`,
                error: {
                  category: "business-rule",
                  message: `exit code ${error.code ?? "?"}`,
                },
              });
            } else {
              resolve({ ok: true, content: truncated || "(no output)", data: { exitCode: 0 } });
            }
          },
        );
      });
    },
  };
}
