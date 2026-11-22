import type { Reader } from "./resolve.ts";

/** One hunk: the lines it finds in the file (context and removed lines) and the lines it leaves there (context and added lines), in order. */
export type Hunk = { before: string[]; after: string[] };

/** One file of a unified diff. */
export type PatchedFile = { path: string; created: boolean; removed: boolean; hunks: Hunk[] };

/**
 * Reads the files and hunks of a patch file (the `git diff` format pnpm applies). A hunk's length comes from its `@@ -a,b +c,d @@`
 * header, so a removed line that starts with `-- ` is not taken for a file header.
 */
export function parsePatch(text: string): PatchedFile[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const files: PatchedFile[] = [];
  let current: PatchedFile | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff --git ")) {
      current = { path: (/ b\/(.+)$/.exec(line)?.[1] ?? "").trim(), created: false, removed: false, hunks: [] };
      files.push(current);
    } else if (current && line.startsWith("new file mode")) {
      current.created = true;
    } else if (current && line.startsWith("deleted file mode")) {
      current.removed = true;
    } else if (current && line.startsWith("@@")) {
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      let before = Number(header?.[1] ?? 1);
      let after = Number(header?.[2] ?? 1);
      const hunk: Hunk = { before: [], after: [] };
      while ((before > 0 || after > 0) && index + 1 < lines.length) {
        const body = lines[++index] ?? "";
        const mark = body[0] ?? " ";
        if (mark === "\\") continue;
        if (mark === " " || body === "") { hunk.before.push(body.slice(1)); hunk.after.push(body.slice(1)); before--; after--; }
        else if (mark === "+") { hunk.after.push(body.slice(1)); after--; }
        else if (mark === "-") { hunk.before.push(body.slice(1)); before--; }
        else throw new Error(`patch line ${index + 1} is not part of a hunk: ${body}`);
      }
      current.hunks.push(hunk);
    }
  }
  return files;
}

/** Where `block` starts in `haystack` (lines), or -1. */
export function indexOfBlock(haystack: readonly string[], block: readonly string[]): number {
  if (block.length === 0) return 0;
  for (let start = haystack.indexOf(block[0] ?? ""); start >= 0 && start + block.length <= haystack.length; start = haystack.indexOf(block[0] ?? "", start + 1)) {
    if (block.every((line, offset) => haystack[start + offset] === line)) return start;
  }
  return -1;
}

/**
 * What of a patch is not in the package it is meant for: one entry per file that is missing and per hunk whose result (its context and
 * added lines, contiguous and in order) is not in the installed file. An empty list means every hunk is there, which is what applying the patch leaves.
 * A package patched by another version of the patch, or not at all, fails here.
 */
export function missingFromPackage(patch: string, installed: Reader): string[] {
  const missing: string[] = [];
  for (const file of parsePatch(patch)) {
    const text = installed.read(file.path);
    if (file.removed) {
      if (text !== undefined) missing.push(`${file.path} should be gone`);
      continue;
    }
    if (text === undefined) { missing.push(`${file.path} is not there`); continue; }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    file.hunks.forEach((hunk, index) => {
      if (indexOfBlock(lines, hunk.after) < 0) missing.push(`${file.path}: hunk ${index + 1} of ${file.hunks.length} of the patch is not in the installed file`);
    });
  }
  return missing;
}
