import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The Svelte build this library compiles with: the custom-renderer pull request, https://github.com/sveltejs/svelte/pull/18042, at the commit the
 * package was written against. Its version string is 5.56.7, the same as the release's, so the version cannot tell the two apart; the `./renderer`
 * export (`svelte/renderer`, which `@example/svelte-native/renderer` imports and the compiler's `customRenderer` option names) is what only this build has.
 */
export const requiredSvelte = {
  version: "5.56.7",
  commit: "216f258068d93170a927ad4d27ee6864b0b305c5",
  pullRequest: "https://github.com/sveltejs/svelte/pull/18042",
  /** The preview build pkg.pr.new publishes for the commit; byte for byte the tarball in this repository's `vendor/`. */
  preview: "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5",
  vendored: "vendor/svelte-5.56.7-216f258.tgz",
} as const;

export type SvelteInspection =
  | { ok: true; version: string; directory: string }
  | { ok: false; version: string | null; directory: string | null; reason: "missing" | "stock-release" };

/** Whether the Svelte that `from` resolves (a `package.json` path, by default the one this library resolves) has the custom renderer. */
export function inspectSvelte(from?: string): SvelteInspection {
  let manifestPath: string;
  try {
    manifestPath = from ?? createRequire(import.meta.url).resolve("svelte/package.json");
  } catch {
    return { ok: false, version: null, directory: null, reason: "missing" };
  }
  const directory = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string; exports?: Record<string, unknown> };
  const version = manifest.version ?? null;
  const exported = manifest.exports !== undefined && "./renderer" in manifest.exports;
  if (!exported || !existsSync(join(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "stock-release" };
  return { ok: true, version: version ?? "unknown", directory };
}

/** The message of a Svelte that cannot compile for this library, with the fix. `what` is what was about to need it. */
export function customRendererMessage(inspection: Extract<SvelteInspection, { ok: false }>, what: string): string {
  const found =
    inspection.reason === "missing"
      ? "No `svelte` package can be resolved from it."
      : `The installed svelte${inspection.version ? ` ${inspection.version}` : ""} (${inspection.directory}) has no \`./renderer\` export, so it is a stock release and not the custom-renderer build.`;
  return [
    `${what} needs the custom-renderer build of Svelte (${requiredSvelte.pullRequest}, commit ${requiredSvelte.commit.slice(0, 7)}, version ${requiredSvelte.version}). ${found}`,
    "Install that build in the app instead of svelte from the registry:",
    `  pnpm add svelte@${requiredSvelte.preview}`,
    `or the tarball in the library's repository (${requiredSvelte.vendored}), as \`"svelte": "file:<path to it>"\`. The same build must be the one the app's own \`svelte\` resolves to, so also drop any \`svelte\` override that points elsewhere.`,
  ].join("\n");
}

/** Throws, naming the fix, when the Svelte this library resolves lacks `./renderer`. Cheap: one `package.json` read. */
export function assertCustomRenderer(what: string, from?: string): void {
  const inspection = inspectSvelte(from);
  if (!inspection.ok) throw new Error(customRendererMessage(inspection, what));
}
