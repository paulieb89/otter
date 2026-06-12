#!/usr/bin/env node
// Lints docs/decisions/*.md: every decision record must have YAML frontmatter
// with title, status, category, tags, and the Problem / Decision / Consequences
// sections. Mirrors the governance model of awesome-agentic-patterns.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../docs/decisions", import.meta.url).pathname;
const REQUIRED_KEYS = ["title", "status", "category", "tags"];
const REQUIRED_SECTIONS = ["## Problem", "## Decision", "## Consequences"];
const VALID_STATUS = ["proposed", "accepted", "superseded"];

let failures = 0;
const fail = (file, msg) => {
  failures++;
  console.error(`✗ ${file}: ${msg}`);
};

const files = readdirSync(DIR).filter((f) => f.endsWith(".md") && /^D\d{3}/.test(f));
if (files.length === 0) {
  console.error("✗ no decision records found in docs/decisions/");
  process.exit(1);
}

for (const file of files) {
  const text = readFileSync(join(DIR, file), "utf8");
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    fail(file, "missing YAML frontmatter");
    continue;
  }
  for (const key of REQUIRED_KEYS) {
    if (!new RegExp(`^${key}:`, "m").test(fm[1])) fail(file, `frontmatter missing "${key}"`);
  }
  const status = fm[1].match(/^status:\s*(\S+)/m)?.[1];
  if (status && !VALID_STATUS.includes(status)) {
    fail(file, `status "${status}" not one of ${VALID_STATUS.join("/")}`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(section)) fail(file, `missing "${section}" section`);
  }
}

if (failures > 0) process.exit(1);
console.log(`✓ ${files.length} decision records pass frontmatter lint`);
