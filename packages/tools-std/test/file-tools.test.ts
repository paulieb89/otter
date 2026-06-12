import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from "../src/index.js";

const ctx = { runId: "t", signal: new AbortController().signal };
let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "otter-files-"));
});

describe("file tools", () => {
  it("read/write round-trips inside the workspace", async () => {
    const write = createWriteFileTool(workdir);
    const read = createReadFileTool(workdir);
    await write.handler({ path: "a/b.txt", content: "hello" }, ctx);
    const result = await read.handler({ path: "a/b.txt" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("hello");
  });

  it("rejects path escapes with a validation result", async () => {
    for (const tool of [createReadFileTool(workdir), createWriteFileTool(workdir)]) {
      const result = await tool.handler({ path: "../../etc/passwd", content: "x" }, ctx);
      expect(result.ok).toBe(false);
      expect(result.error?.category).toBe("validation");
      expect(result.content).toContain("retry"); // written as a retry instruction
    }
  });

  it("edit replaces unique text and refuses ambiguous matches", async () => {
    await writeFile(join(workdir, "f.txt"), "one two one");
    const edit = createEditFileTool(workdir);

    const ambiguous = await edit.handler(
      { path: "f.txt", old_text: "one", new_text: "1" },
      ctx,
    );
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.content).toContain("unique");

    const ok = await edit.handler(
      { path: "f.txt", old_text: "two", new_text: "2" },
      ctx,
    );
    expect(ok.ok).toBe(true);
    expect(await readFile(join(workdir, "f.txt"), "utf8")).toBe("one 2 one");
  });

  it("edit on missing text tells the model to re-read the file", async () => {
    await writeFile(join(workdir, "f.txt"), "content");
    const edit = createEditFileTool(workdir);
    const result = await edit.handler(
      { path: "f.txt", old_text: "absent", new_text: "x" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Read the file again");
  });
});
