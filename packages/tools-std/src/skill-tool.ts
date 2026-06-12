import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "@otter/core";

export interface SkillSummary {
  name: string;
  description: string;
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  if (!match) return out;
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

/**
 * LCC s05: skills live on the filesystem as skills/<name>/SKILL.md. At
 * startup only name + description are surfaced (in the tool description);
 * the body is loaded on demand when the model asks for it.
 */
export async function listSkills(skillsDir: string): Promise<SkillSummary[]> {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const text = await readFile(join(skillsDir, entry.name, "SKILL.md"), "utf8");
      const fm = parseFrontmatter(text);
      skills.push({
        name: fm.name ?? entry.name,
        description: fm.description ?? "(no description)",
      });
    } catch {
      // A directory without SKILL.md is not a skill.
    }
  }
  return skills;
}

export async function createSkillTool(skillsDir: string): Promise<ToolDefinition> {
  const skills = await listSkills(skillsDir);
  const catalogue =
    skills.length > 0
      ? skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
      : "(no skills installed)";

  return {
    name: "skill",
    description: `Load a skill's full instructions when its task comes up. Available skills:\n${catalogue}`,
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Skill name to load" } },
      required: ["name"],
    },
    handler: async (args) => {
      const name = typeof args.name === "string" ? args.name : "";
      const known = skills.find((s) => s.name === name);
      if (!known) {
        const message = `Unknown skill "${name}". Available: ${skills.map((s) => s.name).join(", ") || "(none)"}. Retry with one of these.`;
        return { ok: false, content: message, error: { category: "validation", message } };
      }
      try {
        const body = await readFile(join(skillsDir, name, "SKILL.md"), "utf8");
        return { ok: true, content: body, data: { name } };
      } catch (e) {
        const message = `Skill "${name}" could not be read: ${e instanceof Error ? e.message : e}. It may have been removed; continue without it.`;
        return { ok: false, content: message, error: { category: "server", message } };
      }
    },
  };
}
