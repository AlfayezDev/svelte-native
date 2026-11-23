import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { requiredSvelte } from "../../src/svelte-build.ts";
import { repoRoot } from "./paths.ts";

/**
 * Svelte as the registry publishes it. This repository installs the same release with `patches/svelte@<version>.patch` applied (the compiler accepts the transition directives, for Bun, which
 * runs no Node hooks), so the published files are this repository's with the patch taken back out; the compiler of an app that installs `svelte` as the guide says is what these give.
 */
const patchFile = resolve(repoRoot, `patches/svelte@${requiredSvelte.version}.patch`);
export const installedSvelte = dirname(createRequire(import.meta.url).resolve("svelte/package.json"));

/** Takes the repository's patch out of `root`, a copy of Svelte's package directory or of the files the patch changes at their paths. */
function unpatch(root: string): void {
  const result = Bun.spawnSync(["patch", "-R", "-p1", "-s", "-d", root, "-i", patchFile], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`the patch could not be taken out of ${root}: ${result.stdout.toString()}${result.stderr.toString()}`);
}

/** A copy of the installed Svelte at `target`, unpatched. */
export function copyStockSvelte(target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(installedSvelte, target, { recursive: true });
  unpatch(target);
}

/** The text of the files the patch changes (by their path in the package), as the registry publishes them. */
export function stockFiles(): Record<string, string> {
  const names = [...readFileSync(patchFile, "utf8").matchAll(/^diff --git a\/(\S+) b\//gm)].map((match) => match[1] as string);
  const scratch = mkdtempSync(join(tmpdir(), "expo-svelte-stock-"));
  try {
    for (const name of names) {
      mkdirSync(dirname(join(scratch, name)), { recursive: true });
      cpSync(join(installedSvelte, name), join(scratch, name));
    }
    unpatch(scratch);
    return Object.fromEntries(names.map((name) => [name, readFileSync(join(scratch, name), "utf8")]));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
