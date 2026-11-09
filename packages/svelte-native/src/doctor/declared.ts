import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findUp, readJson } from "./resolve.ts";

export type DeclaredPatch = {
  /** The path as written, and the file it names (relative paths are the workspace root's, or the package.json's). */
  path: string;
  file: string;
  /** Where it is declared, for the message. */
  source: string;
};

/** The `patchedDependencies` entries of a pnpm-workspace.yaml (its top-level block, `key: path` lines, keys quoted or not). */
export function patchedDependenciesOfYaml(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^patchedDependencies:\s*(#.*)?$/.test(line)) { inside = true; continue; }
    if (!inside || /^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const entry = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/.exec(line);
    if (entry) entries.set(entry[1] ?? entry[2] ?? entry[3] ?? "", entry[4] ?? entry[5] ?? entry[6] ?? "");
  }
  return entries;
}

/**
 * The patches the app declares, by key (`react-native-pdf@7.0.3`): `patchedDependencies` of the pnpm-workspace.yaml at or above the app
 * (the workspace root's, for an app in a monorepo) and `pnpm.patchedDependencies` of its package.json. Reading these only tells the doctor
 * what to say when a patch is not applied; whether it is applied is decided from the installed files.
 */
export function declaredPatches(appRoot: string): Map<string, DeclaredPatch> {
  const declared = new Map<string, DeclaredPatch>();
  const add = (entries: Iterable<[string, string]>, base: string, source: string) => {
    for (const [key, path] of entries) if (!declared.has(key)) declared.set(key, { path, file: resolve(base, path), source });
  };
  const fromJson = (json: Record<string, unknown> | undefined): [string, string][] => {
    const pnpm = json?.pnpm;
    const patched = typeof pnpm === "object" && pnpm !== null ? (pnpm as Record<string, unknown>).patchedDependencies : undefined;
    return typeof patched === "object" && patched !== null ? Object.entries(patched).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [];
  };
  const workspace = findUp("pnpm-workspace.yaml", appRoot);
  if (workspace) {
    try {
      add(patchedDependenciesOfYaml(readFileSync(join(workspace, "pnpm-workspace.yaml"), "utf8")), workspace, "pnpm-workspace.yaml");
    } catch {
      // unreadable: nothing declared as far as the doctor can tell
    }
  }
  const top = workspace ?? resolve(appRoot);
  for (let directory = resolve(appRoot); ; directory = dirname(directory)) {
    add(fromJson(readJson(join(directory, "package.json"))), directory, "package.json");
    if (directory === top || dirname(directory) === directory) break;
  }
  return declared;
}
