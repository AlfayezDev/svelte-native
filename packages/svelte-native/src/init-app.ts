import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { patchFiles, patchKey, type PatchFile } from "./doctor/patches.ts";
import { compareVersions, parseVersion } from "./doctor/semver.ts";
import { requiredSvelte } from "./svelte-build.ts";

/**
 * `svelte-native init`: turns a SvelteKit project (what `npx sv create` makes) into a Svelte Native one, after the library is installed in it with
 * `pnpm add`. It adds what the library needs to the files the project already has and writes the files it does not have; a file the project has and
 * the library cannot change safely is left alone and the change is printed. Running it again changes nothing.
 *
 * The plan is made first (`planInit`, no writes) and then carried out (`applyPlan`), so `--dry-run` is the plan and the tests can read it. Nothing here
 * loads Svelte's compiler, Metro or Expo: the command has to run in a project that is not set up yet (its Svelte is still the registry's).
 */

/** The dependencies of a Svelte Native app, at the versions the library was exercised on (`examples/minimal`; a test keeps the two equal and inside the peer ranges). */
export const appDependencies: Readonly<Record<string, string>> = {
  expo: "57.0.30",
  "expo-constants": "57.0.22",
  "hermes-intl": "^0.1.2",
  react: "19.2.7",
  "react-native": "0.86.3",
  "react-native-gesture-handler": "2.32.0",
  "react-native-reanimated": "4.5.1",
  "react-native-worklets": "0.10.1",
};

/** Packages whose patch every app needs; the others are declared when the app has the package (SvelteKit) or lists it at the patch's version (the view libraries). */
const alwaysPatched = ["expo-modules-core", "react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"];
const plugin = "@rasheed/svelte-native/expo";
const scripts: Readonly<Record<string, string>> = { native: "svelte-native dev", android: "svelte-native android", ios: "svelte-native ios", "check-setup": "svelte-native doctor" };
const gitignore = [".svelte-native", ".expo", "/android", "/ios"];

export type InitOptions = {
  dryRun?: boolean;
  /** Replace a file or an entry the project has and the library would have written differently. */
  force?: boolean;
  /** Run `pnpm install` and `svelte-native doctor` after the files are written. Default true. */
  install?: boolean;
  /** The app's display name, and the identifiers of the Android and iOS builds; derived from `package.json`'s name when not given. */
  name?: string;
  androidPackage?: string;
  iosBundleId?: string;
};

export type Change = {
  /** Relative to the project. */
  path: string;
  action: "create" | "edit" | "keep" | "manual";
  summary: string;
  /** The file's new content (a `create` or an `edit`). */
  text?: string | Buffer;
  /** What the person has to do (a `manual`), shown as it is. */
  instructions?: string;
};

export type Plan = {
  root: string;
  changes: Change[];
  warnings: string[];
  /** Reasons the command cannot go on at all. */
  problems: string[];
};

// ---- small helpers -----------------------------------------------------------------------------------------------------------------------

const read = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
const plural = (count: number, word: string) => `${count} ${word.endsWith("y") ? (count === 1 ? word : `${word.slice(0, -1)}ies`) : count === 1 ? word : `${word}s`}`;
const quoteOf = (text: string) => (/from\s+"/.test(text) ? '"' : "'");

/** The indentation a JSON file uses (its first indented line), a tab when it has none. */
function indentOf(text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "\t";
}

/** Sets an entry of a dependency list in place. A new entry goes where it sorts when the list was sorted (the ones `sv create` writes are), else at the end. */
function setEntry(map: Record<string, string>, name: string, value: string): void {
  if (name in map) {
    map[name] = value;
    return;
  }
  const keys = Object.keys(map);
  const sorted = keys.every((key, index) => index === 0 || (keys[index - 1] ?? "") <= key);
  const entries = Object.entries({ ...map, [name]: value });
  if (sorted) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) delete map[key];
  for (const [key, entry] of entries) map[key] = entry;
}

/** The names a project's `package.json` gives an app: a slug for Expo (`my-app`), the id the identifiers are made of (`myapp`) and a title. */
export function appNames(packageName: string | undefined, options: InitOptions = {}): { title: string; slug: string; androidPackage: string; iosBundleId: string } {
  const bare = (packageName ?? "app").replace(/^@[^/]+\//, "");
  let slug = bare.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
  if (!/^[a-z]/.test(slug)) slug = `app-${slug}`;
  const id = slug.replaceAll("-", "");
  const title = options.name ?? (/^[A-Za-z0-9 ._-]+$/.test(bare) ? bare : slug);
  return { title, slug, androidPackage: options.androidPackage ?? `dev.example.${id}`, iosBundleId: options.iosBundleId ?? `dev.example.${id}` };
}

// ---- package.json ------------------------------------------------------------------------------------------------------------------------

type Manifest = Record<string, unknown> & { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };

/** The version of an installed package, or undefined. */
function installedVersion(root: string, name: string): string | undefined {
  const text = read(join(root, "node_modules", name, "package.json"));
  if (text === undefined) return undefined;
  try {
    return (JSON.parse(text) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** The version a spec names exactly (`3.1.1`; `^3.0.0` is not one), or undefined. */
const exactVersion = (spec: string | undefined): string | undefined => (spec !== undefined && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec) ? spec : undefined);

/** The newest version a patch exists for (a prerelease is older than its release). */
function newestKitVersion(kitPatches: readonly PatchFile[]): string | undefined {
  const parsed = kitPatches.flatMap((patch) => {
    const version = parseVersion(patch.version);
    return version ? [{ patch, version }] : [];
  });
  return parsed.sort((a, b) => compareVersions(a.version, b.version)).at(-1)?.patch.version;
}

type PackagePlan = { text: string; summary: string[]; warnings: string[]; kitVersion: string | undefined; hasKit: boolean; changed: boolean; name: string | undefined };

function planPackageJson(root: string, original: string, patches: readonly PatchFile[], options: InitOptions): PackagePlan {
  const manifest = JSON.parse(original) as Manifest;
  const summary: string[] = [];
  const warnings: string[] = [];
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const devDependencies = { ...(manifest.devDependencies ?? {}) };
  /** Sets a dependency in the list it is in, or in `preferred`; true when that changed something. */
  const setDependency = (name: string, value: string, preferred: "dependencies" | "devDependencies") => {
    const list = name in dependencies ? dependencies : name in devDependencies ? devDependencies : preferred === "dependencies" ? dependencies : devDependencies;
    if (list[name] === value) return false;
    setEntry(list, name, value);
    return true;
  };
  const has = (name: string) => name in dependencies || name in devDependencies;

  const next: Manifest = { ...manifest };
  if (next.main !== ".svelte-native/entry.ts") {
    if (next.main === undefined || options.force) {
      next.main = ".svelte-native/entry.ts";
      summary.push('"main"');
    } else {
      warnings.push(`package.json: "main" is "${String(next.main)}", and Svelte Native needs ".svelte-native/entry.ts" (the generated entry); change it or run again with --force.`);
    }
  }

  // Svelte: the custom-renderer build. A `file:` tarball (the library's own vendored copy) and the preview build are both that build.
  const svelteSpec = dependencies.svelte ?? devDependencies.svelte;
  if (svelteSpec === undefined || !(svelteSpec.startsWith("file:") || svelteSpec.startsWith("https://pkg.pr.new/svelte@"))) {
    setDependency("svelte", requiredSvelte.preview, "devDependencies");
    summary.push("svelte (the custom-renderer build)");
  }

  // SvelteKit: kept, at the exact version that has a patch (the installed one when it does, else the newest that does).
  const hasKit = has("@sveltejs/kit");
  const kitPatches = patches.filter((patch) => patch.package === "@sveltejs/kit");
  let kitVersion: string | undefined;
  if (hasKit) {
    const installed = installedVersion(root, "@sveltejs/kit");
    const wanted = exactVersion(dependencies["@sveltejs/kit"] ?? devDependencies["@sveltejs/kit"]);
    kitVersion = [installed, wanted].find((version) => version !== undefined && kitPatches.some((patch) => patch.version === version)) ?? newestKitVersion(kitPatches);
    if (kitVersion !== undefined && setDependency("@sveltejs/kit", kitVersion, "devDependencies")) summary.push(`@sveltejs/kit ${kitVersion} (exact: the library patches that version)`);
  }

  // The packages the app needs next to the library, at the versions it was exercised on.
  let changedPeers = 0;
  for (const [name, version] of Object.entries(appDependencies)) if (setDependency(name, version, "dependencies")) changedPeers++;
  // `expo-modules-core` comes with `expo` and `svelte` is the custom-renderer build (a `file:` tarball or the preview URL): neither is a dependency init pins by version.
  for (const patch of patches.filter((entry) => alwaysPatched.includes(entry.package) && entry.package !== "expo-modules-core")) {
    if (appDependencies[patch.package] !== patch.version) warnings.push(`${patch.package}: the library's patch is for ${patch.version}, and init's version is ${appDependencies[patch.package] ?? "none"}; this is a bug in the library.`);
  }
  if (changedPeers > 0) summary.push(`${plural(changedPeers, "dependency")} (the versions the library was exercised on)`);

  // The scripts: the project's own (`dev`, `build`, `check`) stay. A script of the same name that does something else stays too.
  const nextScripts = { ...(manifest.scripts ?? {}) };
  const addedScripts: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    const current = nextScripts[name];
    if (current === undefined) {
      nextScripts[name] = command;
      addedScripts.push(name);
    } else if (current !== command) {
      warnings.push(`package.json: the script "${name}" is "${current}", not "${command}"; left as it is.`);
    }
  }
  if (addedScripts.length > 0) {
    next.scripts = nextScripts;
    summary.push(`scripts ${addedScripts.join(", ")}`);
  }

  // Reanimated's flag: the patched Android update is reached only through the synchronous update it turns on.
  const reanimated = (typeof next.reanimated === "object" && next.reanimated !== null ? next.reanimated : {}) as { staticFeatureFlags?: Record<string, unknown> };
  if (reanimated.staticFeatureFlags?.ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS !== true) {
    next.reanimated = { ...reanimated, staticFeatureFlags: { ...(reanimated.staticFeatureFlags ?? {}), ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS: true } };
    summary.push("the Reanimated flag");
  }

  next.dependencies = dependencies;
  if (Object.keys(devDependencies).length > 0 || manifest.devDependencies !== undefined) next.devDependencies = devDependencies;
  // `dependencies` goes right before `devDependencies` (`pnpm add` appends it after); the other keys keep their places and new ones come last.
  const ordered: Manifest = {};
  for (const key of Object.keys(next)) {
    if (key === "dependencies") continue;
    if (key === "devDependencies") ordered.dependencies = dependencies;
    ordered[key] = next[key];
  }
  if (!("dependencies" in ordered)) ordered.dependencies = dependencies;
  const text = `${JSON.stringify(ordered, null, indentOf(original))}${original.endsWith("\n") ? "\n" : ""}`;
  return { text, summary, warnings, kitVersion, hasKit, changed: text !== original, name: typeof manifest.name === "string" ? manifest.name : undefined };
}

// ---- pnpm-workspace.yaml -----------------------------------------------------------------------------------------------------------------

const keyOf = (key: string) => (key.startsWith("@") || key.includes(":") ? `"${key}"` : key);

/**
 * Adds entries to the top-level blocks of a pnpm-workspace.yaml and leaves everything else as it is (comments, order, the keys of other tools). An entry that is
 * there with the same value stays; with another value it is replaced and said so; a block written in flow style (`allowBuilds: { esbuild: true }`) is not edited
 * and comes back in `manual`.
 */
export function mergeWorkspaceYaml(text: string, blocks: Readonly<Record<string, Readonly<Record<string, string>>>>): { text: string; changes: string[]; manual: string[] } {
  const crlf = text.includes("\r\n");
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const changes: string[] = [];
  const manual: string[] = [];
  let separated = false;
  for (const [block, wanted] of Object.entries(blocks)) {
    const start = lines.findIndex((line) => new RegExp(`^${block}:\\s*(?:#.*)?$`).test(line));
    if (start < 0) {
      if (lines.some((line) => new RegExp(`^${block}:\\s*\\S`).test(line))) {
        manual.push(`${block}: ${Object.entries(wanted).map(([key, value]) => `${keyOf(key)}: ${value}`).join(", ")}`);
        continue;
      }
      // A blank line before the first block init adds to a file that has others, none between its own.
      if (!separated && lines.length > 0 && lines.at(-1) !== "") lines.push("");
      separated = true;
      lines.push(`${block}:`, ...Object.entries(wanted).map(([key, value]) => `  ${keyOf(key)}: ${value}`));
      changes.push(`${block}: ${Object.keys(wanted).join(", ")}`);
      continue;
    }
    let end = start + 1;
    while (end < lines.length && /^(?:\s+\S.*|\s*)$/.test(lines[end] ?? "")) end++;
    let last = end - 1;
    while (last > start && /^\s*$/.test(lines[last] ?? "")) last--;
    const existing = new Map<string, { index: number; value: string | undefined }>();
    let indent = "  ";
    for (let index = start + 1; index <= last; index++) {
      const entry = /^(\s+)(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))?/.exec(lines[index] ?? "");
      if (entry) {
        indent = entry[1] ?? indent;
        existing.set(entry[2] ?? entry[3] ?? entry[4] ?? "", { index, value: entry[5] ?? entry[6] ?? entry[7] });
      }
    }
    const inserted: string[] = [];
    for (const [key, value] of Object.entries(wanted)) {
      const at = existing.get(key);
      const line = `${indent}${keyOf(key)}: ${value}`;
      if (at === undefined) {
        inserted.push(line);
        changes.push(`${block}: ${key}`);
      } else if (at.value !== value) {
        lines[at.index] = line;
        changes.push(`${block}: ${key} (was ${at.value ?? "empty"})`);
      }
    }
    lines.splice(last + 1, 0, ...inserted);
  }
  const merged = `${lines.join("\n")}\n`;
  return { text: crlf ? merged.replaceAll("\n", "\r\n") : merged, changes, manual };
}

// ---- vite.config -------------------------------------------------------------------------------------------------------------------------

/** The index of the bracket that closes the one at `open`, skipping strings, template literals and comments; -1 when there is none. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let index = open; index < text.length; index++) {
    const char = text[index] ?? "";
    if (char === "/" && text[index + 1] === "/") { index = text.indexOf("\n", index); if (index < 0) return -1; continue; }
    if (char === "/" && text[index + 1] === "*") { index = text.indexOf("*/", index + 2); if (index < 0) return -1; index++; continue; }
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < text.length && text[index] !== char; index++) if (text[index] === "\\") index++;
      continue;
    }
    if (char in pairs) stack.push(pairs[char] ?? "");
    else if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

/**
 * SvelteKit's plugin becomes the library's, which wraps it: `sveltekit(options)` is `svelteNative({ target, kit: options })`, and the config is a function of the
 * mode so that `vite build --mode native` can ask for the native target. Returns undefined when the file is not in a shape this can edit safely (the caller prints
 * the change instead).
 */
export function svelteNativeViteConfig(text: string): string | undefined {
  const quote = quoteOf(text);
  const importLine = /import\s*\{\s*sveltekit\s*\}\s*from\s*['"]@sveltejs\/kit\/vite['"];?/;
  const callAt = /\bsveltekit\s*\(/.exec(text.replace(importLine, (line) => " ".repeat(line.length)));
  if (!importLine.test(text) || !callAt || !/\bdefineConfig\s*\(/.test(text)) return undefined;
  const unit = /^\t/m.test(text) ? "\t" : "  ";
  const open = callAt.index + callAt[0].length - 1;
  const close = closing(text, open);
  if (close < 0) return undefined;
  const args = text.slice(open + 1, close);
  const lineStart = text.lastIndexOf("\n", callAt.index) + 1;
  const indent = /^\s*/.exec(text.slice(lineStart, callAt.index))?.[0] ?? "";
  const target = `target: mode === ${quote}native${quote} ? ${quote}native${quote} : ${quote}web${quote}`;
  const replacement = args.trim() === ""
    ? `svelteNative({ ${target} })`
    : `svelteNative({\n${indent}${unit}${target},\n${indent}${unit}kit: ${args.trim().replace(/\n(?=[^\n])/g, `\n${unit}`)}\n${indent}})`;
  let edited = `${text.slice(0, callAt.index)}${replacement}${text.slice(close + 1)}`;
  edited = edited.replace(importLine, `import { svelteNative } from ${quote}@rasheed/svelte-native/vite${quote};`);
  const define = /\bdefineConfig\s*\(/.exec(edited);
  if (!define) return undefined;
  // `defineConfig({ ... })` becomes `defineConfig(({ mode }) => ({ ... }))`. A config that is already a function must already take `mode`.
  const afterDefine = edited.slice(define.index + define[0].length);
  const defineOpen = define.index + define[0].length - 1;
  const firstArgument = /^\s*/.exec(afterDefine)?.[0].length ?? 0;
  if (afterDefine[firstArgument] === "{") {
    const braceAt = defineOpen + 1 + firstArgument;
    const braceClose = closing(edited, braceAt);
    if (braceClose < 0) return undefined;
    edited = `${edited.slice(0, braceAt)}({ mode }) => (${edited.slice(braceAt, braceClose + 1)})${edited.slice(braceClose + 1)}`;
  } else if (!/^\s*(?:async\s*)?\(\s*\{[^)]*\bmode\b[^)]*\}\s*\)\s*=>/.test(afterDefine)) {
    return undefined;
  }
  return edited;
}

/** What to tell the person to write when the file cannot be edited. */
const viteInstructions = (file: string, quote = "'") => [
  `In ${file}: import { svelteNative } from ${quote}@rasheed/svelte-native/vite${quote}, make the config a function of the mode, and replace SvelteKit's plugin`,
  "with the library's, which wraps it and takes what you passed to sveltekit() as `kit`:",
  "",
  "  export default defineConfig(({ mode }) => ({",
  "    plugins: [svelteNative({ target: mode === 'native' ? 'native' : 'web', kit: { /* what you passed to sveltekit() */ } })]",
  "  }));",
].join("\n");

// ---- the files init writes ---------------------------------------------------------------------------------------------------------------

const metroConfig = `const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");

module.exports = withSvelteNative(getDefaultConfig(__dirname));
`;

const themeModule = `import { colorScheme } from '@rasheed/svelte-native';

// The colours of the native screens, in the system's light and dark mode. A template that reads \`theme.colors\` draws again when the
// user switches, because \`colorScheme.current\` is reactive.
const light = {
	background: '#f2f2f7',
	surface: '#ffffff',
	text: '#000000',
	secondaryText: '#6c6c70',
	accent: '#007aff',
	onAccent: '#ffffff'
};
const dark: typeof light = {
	background: '#000000',
	surface: '#1c1c1e',
	text: '#ffffff',
	secondaryText: '#98989f',
	accent: '#0a84ff',
	onAccent: '#ffffff'
};

export const theme = {
	get colors() {
		return colorScheme.current === 'dark' ? dark : light;
	}
};
`;

const layoutRoute = (theme: string) => `<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack } from '@rasheed/svelte-native';
	import { theme } from '${theme}';

	let { children }: { children: Snippet } = $props();
</script>

<!--
	The app shell: children is the root navigator, a native stack of the screens under src/routes. The options of <Stack> are the
	defaults of every screen: an opaque background in the system's light or dark mode, so a pushed screen covers the one below it,
	and a status bar that follows the mode.
-->
<Stack statusBar={{ style: 'auto' }} style={{ backgroundColor: theme.colors.background }}>
	{@render children()}
</Stack>
`;

const homeRoute = (title: string, theme: string) => `<script lang="ts">
	import { Pressable, Screen, Text, View, useRouter } from '@rasheed/svelte-native';
	import { theme } from '${theme}';

	const router = useRouter();
	let taps = $state(0);
</script>

<Screen title=${JSON.stringify(title)} header={{ large: true }}>
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}>Svelte Native</Text>
		<Text style={{ color: theme.colors.secondaryText, fontSize: 16 }}>Tapped {taps} {taps === 1 ? 'time' : 'times'}.</Text>
		<Pressable onPress={() => taps++} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.accent }}>
			<Text style={{ color: theme.colors.onAccent, fontSize: 16, fontWeight: '600' }}>Tap</Text>
		</Pressable>
		<Pressable onPress={() => router.goto('/details')} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface }}>
			<Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>Open details</Text>
		</Pressable>
	</View>
</Screen>
`;

const detailsRoute = (theme: string) => `<script lang="ts">
	import { Pressable, Screen, Text, View, useRouter } from '@rasheed/svelte-native';
	import { theme } from '${theme}';

	const router = useRouter();
</script>

<Screen title="Details">
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text style={{ color: theme.colors.text, fontSize: 16 }}>A second screen, pushed onto the stack. The header's back button, the edge swipe and Android's back return to the home screen.</Text>
		<Pressable onPress={() => router.back()} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface }}>
			<Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>Back</Text>
		</Pressable>
	</View>
</Screen>
`;

/**
 * Where the starter's theme goes and how a route imports it: \`#lib/…\` when package.json maps \`#lib/*\` (as \`sv\` writes it), a relative
 * path otherwise. A \`src/lib/theme.ts\` of the app's own is left alone; the starter's is then \`native-theme.ts\`.
 */
function starterTheme(root: string, manifest: Manifest): { path: string; exists: boolean; from: (directory: string) => string } {
  const own = read(join(root, "src/lib/theme.ts"));
  const name = own !== undefined && !own.includes("@rasheed/svelte-native") ? "native-theme.ts" : "theme.ts";
  const path = `src/lib/${name}`;
  const imports = manifest.imports;
  const mapped = typeof imports === "object" && imports !== null && "#lib/*" in imports;
  return {
    path,
    exists: existsSync(join(root, path)),
    from: (directory) => (mapped ? `#lib/${name}` : relative(directory, path).split("\\").join("/")),
  };
}

/** The `.mobile.svelte` route files of a project. */
function mobileRoutes(routes: string): string[] {
  if (!existsSync(routes)) return [];
  return (readdirSync(routes, { recursive: true, encoding: "utf8" }) as string[]).filter((file) => /(^|[\\/])\+(?:mobile|layout\.mobile)\.svelte$/.test(file));
}

// ---- the plan ----------------------------------------------------------------------------------------------------------------------------

export function planInit(root: string, options: InitOptions = {}): Plan {
  const plan: Plan = { root, changes: [], warnings: [], problems: [] };
  const packageText = read(join(root, "package.json"));
  if (packageText === undefined) {
    plan.problems.push(`${root} has no package.json: run \`svelte-native init\` in the directory of your project (after \`npx sv create\`).`);
    return plan;
  }
  if (!existsSync(join(root, "pnpm-lock.yaml")) && !existsSync(join(root, "pnpm-workspace.yaml")) && (existsSync(join(root, "package-lock.json")) || existsSync(join(root, "yarn.lock")) || existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb")))) {
    plan.problems.push("This project uses another package manager than pnpm. The library's patches are pnpm's (`patchedDependencies`): create the project with pnpm (`npx sv create`, then choose pnpm) or move it to pnpm first.");
    return plan;
  }
  let manifestText = packageText;
  const patches = patchFiles();
  let pkg: PackagePlan;
  try {
    pkg = planPackageJson(root, manifestText, patches, options);
  } catch (error) {
    plan.problems.push(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return plan;
  }
  manifestText = pkg.text;
  plan.warnings.push(...pkg.warnings);
  plan.changes.push(pkg.changed ? { path: "package.json", action: "edit", summary: pkg.summary.join(", "), text: pkg.text } : { path: "package.json", action: "keep", summary: "has everything" });

  const names = appNames(pkg.name, options);
  const manifest = JSON.parse(manifestText) as Manifest;
  const declared = { ...(manifest.devDependencies ?? {}), ...(manifest.dependencies ?? {}) };

  // The patches this app needs: the always-needed, SvelteKit's (the version the app is pinned to), and a view library's when the app lists it at the patch's version.
  const needed: PatchFile[] = [];
  for (const patch of patches) {
    if (alwaysPatched.includes(patch.package)) needed.push(patch);
    else if (patch.package === "@sveltejs/kit") {
      if (pkg.hasKit && patch.version === pkg.kitVersion) needed.push(patch);
    } else if (patch.package in declared) {
      if (declared[patch.package] === patch.version) needed.push(patch);
      else plan.warnings.push(`${patch.package}: package.json asks for ${declared[patch.package]}, and the library's patch is for ${patch.version} (it is declared only for that version); pin it with \`pnpm add ${patch.package}@${patch.version}\` and run init again.`);
    }
  }

  // pnpm-workspace.yaml: allowBuilds, overrides, patchedDependencies.
  const workspacePath = join(root, "pnpm-workspace.yaml");
  const workspaceText = read(workspacePath);
  // Packages that come with another one and are asked for by a range, so a fresh install takes the newest: pinned for the whole install, as `overrides`.
  // `expo-modules-core` (the patch is for one version) and `@react-native/metro-config` (React Native asks for it by a range, so a fresh install takes 0.88 beside
  // React Native 0.86.3, with Metro 0.87 and tools that exclude Node 25; the pin is the React Native version, as in this repository's lockfile).
  const overrides: Record<string, string> = {};
  const expoModules = patches.find((patch) => patch.package === "expo-modules-core");
  if (expoModules) overrides["expo-modules-core"] = expoModules.version;
  const reactNative = appDependencies["react-native"];
  if (reactNative !== undefined) overrides["@react-native/metro-config"] = reactNative;
  const patched: Record<string, string> = Object.fromEntries(needed.map((patch) => [patchKey(patch), `patches/svelte-native/${patch.file}`]));
  const merged = mergeWorkspaceYaml(workspaceText ?? "", { allowBuilds: { esbuild: "true" }, overrides, patchedDependencies: patched });
  if (merged.manual.length > 0) {
    plan.changes.push({
      path: "pnpm-workspace.yaml",
      action: "manual",
      summary: "a block is written in a style init does not edit",
      instructions: `Add these to pnpm-workspace.yaml:\n${merged.manual.map((line) => `  ${line}`).join("\n")}`,
    });
  } else if (merged.changes.length > 0) {
    plan.changes.push({ path: "pnpm-workspace.yaml", action: workspaceText === undefined ? "create" : "edit", summary: merged.changes.join("; "), text: merged.text });
  } else plan.changes.push({ path: "pnpm-workspace.yaml", action: "keep", summary: "has everything" });
  if (workspaceText !== undefined) {
    for (const key of patchedKeys(workspaceText)) {
      const at = key.lastIndexOf("@");
      const same = needed.find((patch) => patch.package === key.slice(0, at) && patch.version !== key.slice(at + 1));
      if (same) plan.warnings.push(`pnpm-workspace.yaml declares a patch for ${key}, and the library's is for ${same.version}: remove the entry, or pnpm stops with ERR_PNPM_UNUSED_PATCH.`);
    }
  }

  // The patch files, copied into the project: pnpm reads them from there, and before anything is fetched.
  const copied: string[] = [];
  const replaced: string[] = [];
  for (const patch of needed) {
    const target = join(root, "patches/svelte-native", patch.file);
    const content = readFileSync(patch.path);
    const current = existsSync(target) ? readFileSync(target) : undefined;
    if (current?.equals(content)) continue;
    plan.changes.push({ path: relative(root, target), action: current === undefined ? "create" : "edit", summary: current === undefined ? "the library's patch" : "differs from the installed library's copy: replaced", text: content });
    (current === undefined ? copied : replaced).push(patch.file);
  }
  if (copied.length === 0 && replaced.length === 0) plan.changes.push({ path: "patches/svelte-native", action: "keep", summary: `${plural(needed.length, "patch")} up to date` });

  // metro.config.cjs
  const metroPath = join(root, "metro.config.cjs");
  const metroText = read(metroPath) ?? read(join(root, "metro.config.js"));
  if (metroText === undefined) plan.changes.push({ path: "metro.config.cjs", action: "create", summary: "withSvelteNative(getDefaultConfig(__dirname))", text: metroConfig });
  else if (metroText.includes("withSvelteNative")) plan.changes.push({ path: "metro.config.cjs", action: "keep", summary: "uses withSvelteNative" });
  else plan.changes.push({ path: "metro.config.cjs", action: "manual", summary: "exists and does not use withSvelteNative", instructions: `Wrap the config you export:\n  const { withSvelteNative } = require("@rasheed/svelte-native/metro");\n  module.exports = withSvelteNative(<your config>);` });

  // app.json
  planAppJson(root, names, plan);

  // vite.config
  const viteName = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"].find((file) => existsSync(join(root, file)));
  if (pkg.hasKit && viteName === undefined) {
    plan.changes.push({ path: "vite.config.ts", action: "manual", summary: "none found", instructions: viteInstructions("vite.config.ts") });
  } else if (viteName !== undefined) {
    const viteText = read(join(root, viteName)) ?? "";
    if (viteText.includes("svelteNative(")) plan.changes.push({ path: viteName, action: "keep", summary: "uses svelteNative()" });
    else {
      const edited = svelteNativeViteConfig(viteText);
      if (edited !== undefined && syntaxOk(edited, viteName)) plan.changes.push({ path: viteName, action: "edit", summary: "svelteNative() around SvelteKit's plugin, as a function of the mode", text: edited });
      else plan.changes.push({ path: viteName, action: "manual", summary: "not in a shape init edits safely", instructions: viteInstructions(viteName, quoteOf(viteText)) });
    }
  }

  // The first routes: the root layout if there is none, a home screen and a second one when the app has no native screen yet.
  const routes = join(root, "src/routes");
  const existing = mobileRoutes(routes);
  const createLayout = !existing.some((file) => file === "+layout.mobile.svelte");
  const createScreens = !existing.some((file) => /\+mobile\.svelte$/.test(file) && !/layout\.mobile/.test(file));
  // The starter's routes share a theme that follows the system's light or dark mode.
  const theme = starterTheme(root, manifest);
  if ((createLayout || createScreens) && !theme.exists) plan.changes.push({ path: theme.path, action: "create", summary: "light and dark colours for the native screens", text: themeModule });
  if (createLayout) plan.changes.push({ path: "src/routes/+layout.mobile.svelte", action: "create", summary: "the app shell", text: layoutRoute(theme.from("src/routes")) });
  else plan.changes.push({ path: "src/routes/+layout.mobile.svelte", action: "keep", summary: "exists" });
  if (createScreens) {
    plan.changes.push({ path: "src/routes/+mobile.svelte", action: "create", summary: "a home screen", text: homeRoute(names.title, theme.from("src/routes")) });
    plan.changes.push({ path: "src/routes/details/+mobile.svelte", action: "create", summary: "a second screen", text: detailsRoute(theme.from("src/routes/details")) });
  } else plan.changes.push({ path: "src/routes", action: "keep", summary: `${plural(existing.filter((file) => !/layout/.test(file)).length, "native screen")} already` });

  // .gitignore
  const ignorePath = join(root, ".gitignore");
  const ignoreText = read(ignorePath);
  const lines = new Set((ignoreText ?? "").split(/\r?\n/).map((line) => line.trim().replace(/^\//, "").replace(/\/$/, "")));
  const missing = gitignore.filter((line) => !lines.has(line.replace(/^\//, "")));
  if (missing.length > 0) {
    const base = ignoreText ?? "";
    plan.changes.push({ path: ".gitignore", action: ignoreText === undefined ? "create" : "edit", summary: missing.join(", "), text: `${base}${base === "" || base.endsWith("\n") ? "" : "\n"}${base === "" ? "" : "\n"}# Svelte Native\n${missing.join("\n")}\n` });
  } else plan.changes.push({ path: ".gitignore", action: "keep", summary: "has the generated folders" });

  return plan;
}

function patchedKeys(workspace: string): string[] {
  const keys: string[] = [];
  let inside = false;
  for (const line of workspace.split(/\r?\n/)) {
    if (/^patchedDependencies:/.test(line)) { inside = true; continue; }
    if (!inside || /^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const key = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:/.exec(line);
    keys.push(key?.[1] ?? key?.[2] ?? key?.[3] ?? "");
  }
  return keys.filter((key) => key !== "");
}

/** Whether a TypeScript or JavaScript source parses: the edited vite config is checked before it is written. esbuild is the library's own dependency. */
function syntaxOk(source: string, file: string): boolean {
  try {
    // Loaded here, not at the top of the file: most runs of the command never reach this.
    const esbuild = createRequire(import.meta.url)("esbuild") as { transformSync(code: string, options: { loader: string }): unknown };
    esbuild.transformSync(source, { loader: file.endsWith("ts") ? "ts" : "js" });
    return true;
  } catch {
    return false;
  }
}

function planAppJson(root: string, names: ReturnType<typeof appNames>, plan: Plan): void {
  const path = join(root, "app.json");
  const text = read(path);
  const wanted = (): Record<string, unknown> => ({
    name: names.title,
    slug: names.slug,
    scheme: names.slug,
    version: "1.0.0",
    android: { package: names.androidPackage },
    ios: { bundleIdentifier: names.iosBundleId },
    plugins: [plugin],
  });
  if (text === undefined) {
    const config = ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"].find((file) => existsSync(join(root, file)));
    if (config !== undefined) {
      plan.changes.push({ path: config, action: "manual", summary: "the app is configured in code", instructions: `Add the library's plugin to \`plugins\` in ${config}:\n  plugins: ["${plugin}"]\nand give the app an \`android.package\` and \`ios.bundleIdentifier\`.` });
      return;
    }
    plan.changes.push({ path: "app.json", action: "create", summary: `${names.title}, ${names.androidPackage}`, text: `${JSON.stringify({ expo: wanted() }, null, "\t")}\n` });
    return;
  }
  let json: { expo?: Record<string, unknown> };
  try {
    json = JSON.parse(text) as { expo?: Record<string, unknown> };
  } catch {
    plan.changes.push({ path: "app.json", action: "manual", summary: "is not valid JSON", instructions: `Add "${plugin}" to expo.plugins in app.json.` });
    return;
  }
  const expo = json.expo ?? (json as Record<string, unknown>);
  const done: string[] = [];
  const configured = wanted();
  for (const key of ["name", "slug", "scheme", "version"]) {
    if (expo[key] === undefined) { expo[key] = configured[key]; done.push(key); }
  }
  for (const [block, key] of [["android", "package"], ["ios", "bundleIdentifier"]] as const) {
    const value = (typeof expo[block] === "object" && expo[block] !== null ? expo[block] : {}) as Record<string, unknown>;
    if (value[key] === undefined) {
      expo[block] = { ...value, [key]: (configured[block] as Record<string, unknown>)[key] };
      done.push(`${block}.${key}`);
    }
  }
  const plugins = Array.isArray(expo.plugins) ? (expo.plugins as unknown[]) : [];
  const has = plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === plugin || (Array.isArray(entry) ? entry[0] : entry) === "@rasheed/svelte-native");
  if (!has) {
    expo.plugins = [...plugins, plugin];
    done.push("the plugin");
  }
  if (done.length === 0) plan.changes.push({ path: "app.json", action: "keep", summary: "lists the plugin" });
  else plan.changes.push({ path: "app.json", action: "edit", summary: done.join(", "), text: `${JSON.stringify(json, null, indentOf(text))}${text.endsWith("\n") ? "\n" : ""}` });
}

// ---- carrying it out -----------------------------------------------------------------------------------------------------------------------

export function applyPlan(plan: Plan): void {
  for (const change of plan.changes) {
    if (change.text === undefined || (change.action !== "create" && change.action !== "edit")) continue;
    const file = join(plan.root, change.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, change.text);
  }
}

const USAGE = `Usage: svelte-native init [options]

Turns a SvelteKit project (npx sv create) into a Svelte Native app, from the project's directory, after the library is installed in it. It adds the
dependencies, pnpm's settings and patches, the Metro and Expo config, the Vite plugin and a first native screen, then runs pnpm install and
\`svelte-native doctor\`. Running it again changes nothing. A file it cannot change safely is left alone and the change is printed.

  --dry-run               print what it would do and write nothing
  --force                 replace a "main" or an entry the project has, where init would have written another
  --no-install            write the files; do not run pnpm install and the doctor
  --name <name>           the app's display name (default: the package name)
  --android-package <id>  the Android application id (default: dev.example.<package name>)
  --ios-bundle-id <id>    the iOS bundle identifier (default: the same)
`;

export type InitIo = { out(text: string): void; err(text: string): void };
const processIo: InitIo = { out: (text) => process.stdout.write(`${text}\n`), err: (text) => process.stderr.write(`${text}\n`) };

/** Parses the flags; undefined (with a message) when one is wrong. */
export function parseInitArguments(args: readonly string[]): InitOptions | string {
  const options: InitOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const value = () => {
      const next = args[++index];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    try {
      if (arg === "--dry-run") options.dryRun = true;
      else if (arg === "--force") options.force = true;
      else if (arg === "--no-install") options.install = false;
      else if (arg === "--name") options.name = value();
      else if (arg === "--android-package") options.androidPackage = value();
      else if (arg === "--ios-bundle-id") options.iosBundleId = value();
      else if (arg === "--help" || arg === "-h") return USAGE;
      else return `Unknown option ${arg}.\n\n${USAGE}`;
    } catch (error) {
      return `${error instanceof Error ? error.message : String(error)}.\n\n${USAGE}`;
    }
  }
  return options;
}

const WORD: Record<Change["action"], string> = { create: "create", edit: "edit  ", keep: "keep  ", manual: "YOU   " };

/** The plan as text: one line per file (the patch files together), then what the person has to do by hand and the warnings. */
export function formatPlan(plan: Plan, dryRun: boolean): string {
  const lines = [`svelte-native init: ${plan.root}${dryRun ? " (dry run)" : ""}`, ""];
  const patchDirectory = "patches/svelte-native/";
  const patches = plan.changes.filter((change) => change.path.startsWith(patchDirectory));
  const rows: { action: Change["action"]; path: string; summary: string }[] = [];
  for (const change of plan.changes) {
    if (!change.path.startsWith(patchDirectory)) rows.push(change);
    else if (change === patches[0]) rows.push({ action: patches.every((entry) => entry.action === "create") ? "create" : "edit", path: patchDirectory, summary: `${plural(patches.length, "patch file")} from the installed library` });
  }
  const width = Math.max(...rows.map((row) => row.path.length), 10);
  for (const row of rows) lines.push(`  ${WORD[row.action]}  ${row.path.padEnd(width)}  ${row.summary}`);
  for (const change of plan.changes.filter((entry) => entry.action === "manual")) lines.push("", `${change.path}:`, ...(change.instructions ?? "").split("\n").map((line) => `  ${line}`));
  if (plan.warnings.length > 0) lines.push("", "warnings:", ...plan.warnings.map((warning) => `  ${warning}`));
  return lines.join("\n");
}

/** The command. Returns the exit status. */
export function runInit(root: string, args: readonly string[], io: InitIo = processIo): number {
  const options = parseInitArguments(args);
  if (typeof options === "string") {
    (options.startsWith("Usage") ? io.out : io.err)(options.trimEnd());
    return options.startsWith("Usage") ? 0 : 2;
  }
  const plan = planInit(root, options);
  if (plan.problems.length > 0) {
    for (const problem of plan.problems) io.err(`svelte-native init: ${problem}`);
    return 1;
  }
  io.out(formatPlan(plan, options.dryRun === true));
  const manual = plan.changes.filter((change) => change.action === "manual").length;
  if (options.dryRun) {
    io.out("\nNothing was written (--dry-run).");
    return 0;
  }
  const written = plan.changes.filter((change) => change.action === "create" || change.action === "edit").length;
  applyPlan(plan);
  io.out(written === 0 ? "\nNothing to change: the project is already set up." : `\nWrote ${plural(written, "file")}.`);
  if (options.install === false) return manual > 0 ? 1 : 0;
  io.out("\n==> pnpm install");
  const install = spawnSync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) {
    io.err("svelte-native init: pnpm install failed; fix what it says and run `pnpm install` and `pnpm exec svelte-native doctor`.");
    return install.status ?? 1;
  }
  io.out("\n==> svelte-native doctor");
  const doctor = spawnSync("pnpm", ["exec", "svelte-native", "doctor"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (doctor.status !== 0) return doctor.status ?? 1;
  io.out(`\nNext: the first \`pnpm android\` (or \`pnpm ios\`, on a Mac) builds the native app, which takes a while; after that \`pnpm native\` starts the dev server for it.${manual > 0 ? `\nFirst, the ${plural(manual, "change")} listed above for you to make.` : ""}`);
  return manual > 0 ? 1 : 0;
}
