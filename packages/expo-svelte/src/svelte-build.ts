import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The Svelte this library compiles with: the registry's `svelte` 5.59.1. Custom renderers came with Svelte 5.59.0, so a release before it has no `./renderer` export
 * (`svelte/renderer`, which `expo-svelte/renderer` imports and the compiler's `customRenderer` option names) and cannot compile for this library.
 */
export const requiredSvelte = {
  version: "5.59.1",
  /** The first release with custom renderers. */
  firstWithRenderer: "5.59.0",
} as const;

export type SvelteInspection =
  | { ok: true; version: string; directory: string }
  | { ok: false; version: string | null; directory: string | null; reason: "missing" | "no-renderer" | "before-release" };

/** Whether `version` (major.minor.patch, a pre-release counting as before its release) comes before `release`. */
function before(version: string, release: string): boolean {
  const parse = (v: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(-)?/.exec(v);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? 0 : 1] : null;
  };
  const a = parse(version);
  const b = parse(release)!;
  if (!a) return true;
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/** Whether the Svelte that `from` resolves (a `package.json` path, by default the one this library resolves) has custom renderers. */
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
  if (!exported || !existsSync(join(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "no-renderer" };
  // The pull-request build earlier versions of this library installed (5.56.7 from pkg.pr.new or a tarball) has `./renderer` too, with other method names.
  if (version === null || before(version, requiredSvelte.firstWithRenderer)) return { ok: false, version, directory, reason: "before-release" };
  return { ok: true, version: version ?? "unknown", directory };
}

/** The message of a Svelte that cannot compile for this library, with the fix. `what` is what was about to need it. */
export function customRendererMessage(inspection: Extract<SvelteInspection, { ok: false }>, what: string): string {
  const installed = `The installed svelte${inspection.version ? ` ${inspection.version}` : ""} (${inspection.directory})`;
  const found =
    inspection.reason === "missing"
      ? "No `svelte` package can be resolved from it."
      : inspection.reason === "no-renderer"
        ? `${installed} has no \`./renderer\` export: custom renderers came with Svelte ${requiredSvelte.firstWithRenderer}.`
        : `${installed} is from before Svelte ${requiredSvelte.firstWithRenderer}, the release with custom renderers: a build of the pull request (pkg.pr.new or a tarball) has a \`./renderer\` export with other method names.`;
  return [`${what} needs Svelte ${requiredSvelte.version}, with custom renderers. ${found}`, "Install it from the registry:", `  pnpm add svelte@${requiredSvelte.version}`].join("\n");
}

/** Throws, naming the fix, when the Svelte this library resolves lacks `./renderer` or is from before its release. Cheap: one `package.json` read. */
export function assertCustomRenderer(what: string, from?: string): void {
  const inspection = inspectSvelte(from);
  if (!inspection.ok) throw new Error(customRendererMessage(inspection, what));
}
