import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { patchFiles } from "../../src/doctor/patches.ts";

/**
 * The versions the package itself names, for a test that checks what a version does and not which one it is: a dependency bump is then not an edit of the tests. The peer
 * ranges are the package's `peerDependencies` and the patch versions are those of the files in `patches/` (the doctor checks an installed package against the same).
 */
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version: string; peerDependencies: Record<string, string> };

/** The version of this package. */
export const libraryVersion: string = manifest.version;

/** The range the package asks of a peer, as written (`~57.0.27`, `0.86.3`). */
export function peerRange(name: string): string {
  const range = manifest.peerDependencies[name];
  if (range === undefined) throw new Error(`${name} is not a peer dependency of the package`);
  return range;
}

/** The version a peer's range names: the range without its `~` or `^`. */
export const peerVersion = (name: string): string => peerRange(name).replace(/^[~^]/, "");

/** The version of the package a patch in `patches/` is for. */
export function patchVersion(name: string): string {
  const patch = patchFiles().find((file) => file.package === name);
  if (patch === undefined) throw new Error(`no patch for ${name}`);
  return patch.version;
}
