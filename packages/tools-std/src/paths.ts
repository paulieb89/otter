import { resolve, sep } from "node:path";

/**
 * Resolves a path and confines it to the workspace. Throws on escape; file
 * tools turn that into a validation result with a retry instruction.
 */
export function safePath(workdir: string, p: string): string {
  const root = resolve(workdir);
  const full = resolve(root, p);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(
      `Path "${p}" escapes the workspace. Use a path inside the workspace root and retry.`,
    );
  }
  return full;
}
