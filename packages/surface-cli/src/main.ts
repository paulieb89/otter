#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import type { Transcript } from "@otter/core";
import { runAgent } from "@otter/core";
import { AnthropicAdapter } from "@otter/adapters";
import { createWorkspaceAgent } from "./agent.js";
import { renderEvent } from "./render.js";

const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

async function main(): Promise<void> {
  const workdir = process.cwd();
  try {
    // Auto-load .env from the launch directory. Already-set variables win,
    // so shell exports and --env-file still take precedence.
    process.loadEnvFile(`${workdir}/.env`);
  } catch {
    // No .env file — environment variables alone are fine.
  }
  const adapter = new AnthropicAdapter({
    model: process.env.OTTER_MODEL ?? "claude-sonnet-4-6",
    ...(process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : {}),
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });
  const agent = await createWorkspaceAgent({
    workdir,
    skillsDir: `${workdir}/skills`,
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`otter — workspace agent at ${workdir} (q to quit)`);

  let transcript: Transcript = [];
  for (;;) {
    const query = (await rl.question(`${CYAN}otter >> ${RESET}`)).trim();
    if (query === "" || query.toLowerCase() === "q") break;

    const result = await runAgent({
      adapter,
      registry: agent.registry,
      transcript,
      prompt: query,
      system: `You are a coding agent working at ${workdir}. Use tools to solve tasks; plan with the todo tool first on multi-step work.`,
      policy: agent.policy,
      approval: {
        mode: "interactive",
        approve: async (call) => {
          const answer = await rl.question(
            `allow ${call.name} ${JSON.stringify(call.args).slice(0, 120)}? [y/N] `,
          );
          return answer.trim().toLowerCase().startsWith("y");
        },
      },
      onEvent: (event) => {
        const line = renderEvent(event);
        if (line !== undefined) console.log(line);
      },
    });

    transcript = result.transcript;
    const lastAssistant = transcript.findLast((m) => m.role === "assistant");
    if (lastAssistant?.role === "assistant" && lastAssistant.text) {
      console.log(`\n${lastAssistant.text}\n`);
    }
    if (result.state !== "completed") {
      console.log(`(run ${result.state}: ${result.stopReason})\n`);
    }
  }
  rl.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
