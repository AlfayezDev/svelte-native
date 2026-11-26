import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./resolve.ts";

/**
 * What a look at a config file can say: it names the library's entry (`found`, and `name`, how it names it), it names the path `<library>/expo` that no longer resolves
 * (`removed`), it does not name the entry and nothing else could add it (`absent`), or it is code and the answer depends on running it (`unclear`).
 */
export type Finding = { state: "found" | "removed" | "absent" | "unclear" | "no-file"; file?: string; name?: string };

const METRO_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts", "metro.config.mts", "metro.config.cts"];
const APP_CONFIG_FILES = ["app.config.ts", "app.config.js", "app.config.cjs", "app.config.mjs", "app.config.mts", "app.config.cts"];

/** Config source without comments, so a line that was commented out is not taken for one that is in use (a `//` after a colon is a URL). */
export function withoutJsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

const firstExisting = (root: string, names: string[]) => names.find((name) => existsSync(join(root, name)));

/** Whether the app's Metro config uses `withExpoSvelte` (from `<library>/metro`). */
export function metroFinding(appRoot: string): Finding {
  const file = firstExisting(appRoot, METRO_FILES);
  if (!file) return { state: "no-file" };
  const code = withoutJsComments(readFileSync(join(appRoot, file), "utf8"));
  return { state: /\bwithExpoSvelte\b/.test(code) ? "found" : "unclear", file };
}

const pluginName = (entry: unknown): string | undefined => (typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : undefined);

/**
 * Whether the app's Expo config lists the library's config plugin, by any of its names: the package's own name (its `app.plugin.js`, which Expo finds for a bare
 * package name), or that file's path `<library>/app.plugin` or its file name `<library>/app.plugin.js`. In `app.json`'s `plugins`, or by name in an `app.config.*`. `<library>/expo` was a third name up to 0.4.0-rc.6;
 * it is not in the package's `exports` any more, so a config that lists it is `removed`, whatever else it lists.
 */
export function expoPluginFinding(appRoot: string, library: string): Finding {
  const names = [library, `${library}/app.plugin`, `${library}/app.plugin.js`];
  const removed = `${library}/expo`;
  const json = firstExisting(appRoot, ["app.json"]);
  const code = firstExisting(appRoot, APP_CONFIG_FILES);
  const parsed = json ? readJson(join(appRoot, json)) : undefined;
  const expo = (parsed?.expo ?? parsed) as { plugins?: unknown } | undefined;
  const plugins = Array.isArray(expo?.plugins) ? expo.plugins : [];
  const listedInJson = (name: string) => plugins.some((entry) => pluginName(entry) === name);
  // The name in the file, however the list is built: a dynamic config may add it in a way the doctor cannot see, so a miss is unclear. A name is a whole string, not the start of
  // `<library>/app.plugin` or of another package.
  const source = code ? withoutJsComments(readFileSync(join(appRoot, code), "utf8")) : "";
  const namedInCode = (name: string) => ["\"", "'", "`"].some((quote) => source.includes(`${quote}${name}${quote}`));
  if (json && listedInJson(removed)) return { state: "removed", file: json, name: removed };
  if (code && namedInCode(removed)) return { state: "removed", file: code, name: removed };
  const listed = json ? names.find(listedInJson) : undefined;
  if (listed) return { state: "found", file: json, name: listed };
  if (code) {
    const named = names.find(namedInCode);
    return named ? { state: "found", file: code, name: named } : { state: "unclear", file: code };
  }
  return json ? { state: "absent", file: json } : { state: "no-file" };
}

/** `value` as a plain object, or `{}` for anything else: a section of a JSON file that is missing or of another shape reads as empty. */
export const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * What `app.json` says, for the checks that need more than the plugin's name: its `expo` object (the file's top level when it has no `expo`, as Expo reads it), and the
 * options the app gives the library's plugin there (`undefined` when `app.json` does not list it; `{}` when it lists it by name alone). `undefined` when there is no
 * `app.json`, or it is not JSON. An `app.config.*` is code, so what it adds is not here: `codeConfig` says whether there is one.
 */
export function appJson(appRoot: string, library: string): { file: string; expo: Record<string, unknown>; plugin: Record<string, unknown> | undefined } | undefined {
  const file = firstExisting(appRoot, ["app.json"]);
  const parsed = file ? readJson(join(appRoot, file)) : undefined;
  if (!file || !parsed) return undefined;
  const expo = record(parsed.expo ?? parsed);
  const names = [library, `${library}/app.plugin`, `${library}/app.plugin.js`];
  const entry = (Array.isArray(expo.plugins) ? expo.plugins : []).find((candidate) => names.includes(pluginName(candidate) ?? ""));
  return { file, expo, plugin: entry === undefined ? undefined : record(Array.isArray(entry) ? entry[1] : undefined) };
}

/** The app's `app.config.*` (code the doctor does not run), if it has one. */
export const codeConfig = (appRoot: string): string | undefined => firstExisting(appRoot, APP_CONFIG_FILES);
