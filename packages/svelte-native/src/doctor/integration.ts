import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./resolve.ts";

/**
 * What a look at a config file can say: it names the library's entry (`found`, and `name`, how it names it), it does not and nothing else could add it (`absent`), or it is
 * code and the answer depends on running it (`unclear`).
 */
export type Finding = { state: "found" | "absent" | "unclear" | "no-file"; file?: string; name?: string };

const METRO_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts", "metro.config.mts", "metro.config.cts"];
const APP_CONFIG_FILES = ["app.config.ts", "app.config.js", "app.config.cjs", "app.config.mjs", "app.config.mts", "app.config.cts"];

/** Config source without comments, so a line that was commented out is not taken for one that is in use (a `//` after a colon is a URL). */
export function withoutJsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

const firstExisting = (root: string, names: string[]) => names.find((name) => existsSync(join(root, name)));

/** Whether the app's Metro config uses `withSvelteNative` (from `<library>/metro`). */
export function metroFinding(appRoot: string): Finding {
  const file = firstExisting(appRoot, METRO_FILES);
  if (!file) return { state: "no-file" };
  const code = withoutJsComments(readFileSync(join(appRoot, file), "utf8"));
  return { state: /\bwithSvelteNative\b/.test(code) ? "found" : "unclear", file };
}

const pluginName = (entry: unknown): string | undefined => (typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : undefined);

/**
 * Whether the app's Expo config lists the library's config plugin, by either name: `<library>/expo`, or the package's own name (its `app.plugin.js`, which Expo
 * finds for a bare package name). In `app.json`'s `plugins`, or by name in an `app.config.*`.
 */
export function expoPluginFinding(appRoot: string, library: string): Finding {
  const names = [`${library}/expo`, library];
  const json = firstExisting(appRoot, ["app.json"]);
  const code = firstExisting(appRoot, APP_CONFIG_FILES);
  if (json) {
    const parsed = readJson(join(appRoot, json));
    const expo = (parsed?.expo ?? parsed) as { plugins?: unknown } | undefined;
    const plugins = Array.isArray(expo?.plugins) ? expo.plugins : [];
    const listed = names.find((name) => plugins.some((entry) => pluginName(entry) === name));
    if (listed) return { state: "found", file: json, name: listed };
  }
  if (code) {
    // The name in the file, however the list is built: a dynamic config may add it in a way the doctor cannot see, so a miss is unclear. The bare name is a whole string, not the start of `<library>/expo` or of another package.
    const source = withoutJsComments(readFileSync(join(appRoot, code), "utf8"));
    const named = names.find((name) => ["\"", "'", "`"].some((quote) => source.includes(`${quote}${name}${quote}`)));
    return named ? { state: "found", file: code, name: named } : { state: "unclear", file: code };
  }
  return json ? { state: "absent", file: json } : { state: "no-file" };
}
