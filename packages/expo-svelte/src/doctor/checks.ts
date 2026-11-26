import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { declaredPatches } from "./declared.ts";
import { expoPluginFinding, metroFinding, record, type Finding } from "./integration.ts";
import { missingFromPackage } from "./hunks.ts";
import { patchFiles, patchKey, patchSpecs } from "./patches.ts";
import { pushChecks } from "./push.ts";
import { nodeAdvice, requirements } from "./requirements.ts";
import { findPackage, readerFor, readJson, type InstalledPackage } from "./resolve.ts";
import { satisfies } from "./semver.ts";
import { appPluginOptions, checkLibraries, LibrariesConfigError } from "../libraries.ts";
import { requiredSvelte } from "../svelte-build.ts";
import { collisionMessage, declaredVendored, vendoredPackages, vendoredRoot } from "../vendored.ts";

export type Status = "pass" | "fail" | "skip" | "unknown";
export type Check = {
  group: "environment" | "svelte" | "peer dependencies" | "vendored packages" | "patches" | "build integration" | "push" | "push server";
  status: Status;
  message: string;
  /** More lines under the message (what exactly is missing). */
  details?: string[];
  /** What to do about a failure, or about a check that could not tell. */
  fix?: string;
};

export type Context = {
  /** The app's directory: where its package.json, node_modules, Metro and Expo configs are. */
  appRoot: string;
  /** The library's directory: its package.json (the peers) and its `patches/`. */
  packageRoot: string;
  /** The version of the Node the app's tools run on, or undefined when it cannot be found out (the doctor runs on Bun and `node` is not on the PATH). */
  node: string | undefined;
  /** The version `pnpm --version` prints in the app's directory, or undefined when pnpm cannot be run. */
  pnpm: () => string | undefined;
  /** The app is a member of this repository's workspace (`apps/qa`, `apps/example`), so it is judged by the repository's Node; default false, an app outside it. */
  repository?: boolean;
};

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function environment(context: Context): Check[] {
  const checks: Check[] = [];
  const scope = context.repository ? "repository" : "app";
  const range = requirements.node[scope];
  if (context.node === undefined) {
    checks.push({ group: "environment", status: "unknown", message: `could not run node (needs ${range})`, fix: nodeAdvice[scope] });
  } else {
    const ok = satisfies(context.node, range);
    checks.push(ok
      ? { group: "environment", status: "pass", message: `node ${context.node} (needs ${range})` }
      : { group: "environment", status: "fail", message: `node ${context.node} does not satisfy ${range}`, fix: nodeAdvice[scope] });
  }
  const pnpm = context.pnpm();
  if (pnpm === undefined) {
    checks.push({ group: "environment", status: "unknown", message: `could not run pnpm (needs ${requirements.pnpm})`, fix: `install pnpm ${requirements.pnpm.slice(2)} or newer (corepack enable pnpm); the patches are applied by pnpm` });
  } else if (satisfies(pnpm, requirements.pnpm)) {
    checks.push({ group: "environment", status: "pass", message: `pnpm ${pnpm} (needs ${requirements.pnpm})` });
  } else {
    checks.push({ group: "environment", status: "fail", message: `pnpm ${pnpm} does not satisfy ${requirements.pnpm}`, fix: `use pnpm ${requirements.pnpm.slice(2)} or newer (corepack use pnpm@${requirements.pnpm.slice(2)})` });
  }
  return checks;
}

function library(context: Context, name: string, version: string, appPackage: Record<string, unknown>): Check {
  const dependencies = { ...record(appPackage.dependencies), ...record(appPackage.devDependencies), ...record(appPackage.optionalDependencies) };
  return name in dependencies
    ? { group: "build integration", status: "pass", message: `${name} ${version} is a dependency of the app` }
    : { group: "build integration", status: "fail", message: `${name} is not a dependency of the app (${join(context.appRoot, "package.json")})`, fix: `add it to the app's dependencies (README: "Install in an app"), or run \`pnpm exec expo-svelte init\`` };
}

/** Svelte with custom renderers (5.59.0 or newer): the `./renderer` export and the compiler option the library compiles with. */
function svelte(context: Context, peers: Record<string, unknown>): Check {
  const installed = findPackage("svelte", context.appRoot);
  const fix = `install svelte ${requiredSvelte.version} from the registry: \`pnpm exec expo-svelte init\` does it (docs/10-getting-started/20-creating-a-project.md), or by hand, README "Install in an app"`;
  if (!installed) return { group: "svelte", status: "fail", message: "svelte is not installed", fix };
  const entry = record(installed.json.exports)["./renderer"];
  const target = text(entry) ?? text(record(entry).default);
  const exported = target !== undefined && existsSync(join(installed.directory, target));
  const compiler = ["src/compiler/validate-options.js", "compiler/index.js"].some((file) => {
    try {
      return readFileSync(join(installed.directory, file), "utf8").includes("customRenderer");
    } catch {
      return false;
    }
  });
  if (!exported || !compiler) {
    return {
      group: "svelte",
      status: "fail",
      message: `svelte ${installed.version} has no custom renderers: ${!exported ? "it has no ./renderer export" : "its compiler has no customRenderer option"} (${installed.directory})`,
      fix,
    };
  }
  const range = text(peers.svelte);
  if (range !== undefined && satisfies(installed.version, range) === false) {
    return { group: "svelte", status: "fail", message: `svelte ${installed.version} has ./renderer but does not satisfy ${range}`, fix };
  }
  return { group: "svelte", status: "pass", message: `svelte ${installed.version} has the ./renderer export and the customRenderer compiler option` };
}

function peerDependencies(context: Context, peers: Record<string, unknown>, optional: ReadonlySet<string>): Check[] {
  const checks: Check[] = [];
  const absent: string[] = [];
  for (const [name, wanted] of Object.entries(peers).sort(([a], [b]) => a.localeCompare(b))) {
    const range = text(wanted);
    // Svelte is judged on its own, by what it exports.
    if (range === undefined || name === "svelte") continue;
    const installed = findPackage(name, context.appRoot);
    if (!installed) {
      if (optional.has(name)) absent.push(name);
      else checks.push({ group: "peer dependencies", status: "fail", message: `${name} is not installed (needs ${range})`, fix: `pnpm add ${name}@${range}` });
      continue;
    }
    const ok = satisfies(installed.version, range);
    if (ok === true) checks.push({ group: "peer dependencies", status: "pass", message: `${name} ${installed.version} satisfies ${range}` });
    else if (ok === false) checks.push({ group: "peer dependencies", status: "fail", message: `${name} ${installed.version} does not satisfy ${range}`, fix: `pnpm add ${name}@${range}` });
    else checks.push({ group: "peer dependencies", status: "unknown", message: `${name} ${installed.version}: could not compare it with ${range}` });
  }
  if (absent.length > 0) checks.push({ group: "peer dependencies", status: "skip", message: `optional peer dependencies not installed, nothing to check: ${absent.join(", ")}` });
  return checks;
}

/**
 * What `polyfills.ts` imports from `expo` by path: `expo/src/winter`, Expo's WinterCG runtime (a standard `URL` and `URLSearchParams`, `fetch`, `TextDecoder`, ...). The router builds
 * every location as a `SvelteURL`, which React Native's own `URL` cannot construct, so without the runtime an app starts blank with `TypeError: undefined is not a function`. `expo`'s
 * `exports` map serves that path from `build/winter` (the sources here under the `expo-source` condition), and the package ships both; Metro picks `runtime.native` on a device.
 */
const EXPO_RUNTIME_FILES = ["src/winter/index.ts", "src/winter/runtime.native.ts"] as const;

function expoRuntime(context: Context): Check[] {
  const expo = findPackage("expo", context.appRoot);
  // Not installed: the peer dependency check already fails it.
  if (!expo) return [];
  const missing = EXPO_RUNTIME_FILES.filter((file) => !existsSync(join(expo.directory, file)));
  if (missing.length === 0) return [{ group: "peer dependencies", status: "pass", message: `expo ${expo.version} has src/winter, the runtime (URL, fetch, TextDecoder) that the library's polyfills import` }];
  return [{
    group: "peer dependencies",
    status: "fail",
    message: `expo ${expo.version} has no ${missing.join(", ")} (${expo.directory}): the library's polyfills import expo/src/winter for the standard URL, and the router starts blank without it`,
    fix: `npx expo install expo (the version this library was exercised on is in its peerDependencies)`,
  }];
}

/**
 * The packages the library carries (`vendored.ts`): present in the installed library at the version it pins, and not among the app's own dependencies. An app that lists one
 * links it twice (its own native module beside the library's copy), which the config plugin and the autolinking command refuse as well. React Native's autolinking links a native
 * module only from the app's own dependencies, which is why the library adds its copies to the config itself (`autolinking.ts`) and why an app has nothing to install for
 * `crypto` (react-native-quick-crypto and the base64 module it asks for), the `Intl` constructors Hermes lacks (`hermes-intl`) or `localStorage` (MMKV and the Nitro runtime). The optional
 * libraries (`libraries.ts`) are summed up in one line when all is well, and `libraries` of the app's config is read and reported: the libraries that are on, or why the option cannot be read.
 */
function vendored(context: Context, libraryName: string): Check[] {
  const declared = new Set(declaredVendored(context.appRoot));
  const checks: Check[] = [];
  const optionalCopies: string[] = [];
  for (const { name, version, optional } of vendoredPackages) {
    const directory = vendoredRoot(name, context.packageRoot);
    const copy = readJson(join(directory, "package.json"));
    if (copy === undefined || copy.version !== version) {
      checks.push({
        group: "vendored packages",
        status: "fail",
        message: copy === undefined ? `${libraryName} has no copy of ${name} (${directory}): the installed library is incomplete` : `${directory} is ${name} ${String(copy.version)}, the library pins ${version}`,
        fix: `install ${libraryName} again (a package manager that dropped the library's vendor/ folder, or a stale cache, leaves it incomplete)`,
      });
    } else if (declared.has(name)) {
      checks.push({ group: "vendored packages", status: "fail", message: `${name} is a dependency of the app (${join(context.appRoot, "package.json")}): ${collisionMessage([name], libraryName)}`, fix: `pnpm remove ${name}, then npx expo prebuild` });
    } else if (optional === undefined) {
      checks.push({ group: "vendored packages", status: "pass", message: `${name} ${version} comes with ${libraryName} (vendor/${name}); the app does not list it` });
    } else optionalCopies.push(name);
  }
  if (optionalCopies.length > 0) checks.push({ group: "vendored packages", status: "pass", message: `the ${optionalCopies.length} optional libraries come with ${libraryName} (vendor/), at the versions it pins; the app lists none of them` });
  checks.push(libraries(context, libraryName));
  return checks;
}

/** The libraries the app's config turns on (`libraries` of the plugin options): which they are, or what is wrong with the option or why it could not be read. */
function libraries(context: Context, libraryName: string): Check {
  const group = "vendored packages";
  const fix = `fix \`libraries\` in the ${libraryName} plugin's options (app.json or app.config.*), then prebuild again`;
  const read = appPluginOptions(context.appRoot, join(context.appRoot, "package.json"));
  // The plugin checks `libraries` while Expo reads the config, so an invalid one is what made the config unreadable.
  if ("error" in read && read.error instanceof Error && read.error.name === "LibrariesConfigError") {
    return { group, status: "fail", message: read.error.message, fix };
  }
  if ("unknown" in read) return { group, status: "skip", message: `${read.unknown}, so the optional libraries it turns on were not checked (\`npx expo config\` shows the config)` };
  try {
    const { enabled, listed } = checkLibraries(read.options?.libraries);
    if (enabled.length === 0) return { group, status: "pass", message: "no optional library is turned on (libraries): none of their native code is in the app" };
    const implied = enabled.filter((name) => !listed.has(name));
    return { group, status: "pass", message: `libraries turned on: ${enabled.join(", ")}${implied.length > 0 ? ` (${implied.join(", ")}: needed by another)` : ""}; the others are not linked, and Metro stubs them` };
  } catch (error) {
    if (!(error instanceof LibrariesConfigError)) throw error;
    return { group, status: "fail", message: error.message, fix };
  }
}

/**
 * The patches the library applied to its own copies (`vendor/<name>`, `vendor-patches/`): the shape each patch leaves is looked for in the copy, so an installed library that is not
 * the one that was built (a stale copy, a package manager that rewrote a file) is told apart. The app has nothing to do about a failure but install the library again.
 */
function vendoredPatches(context: Context, libraryName: string): Check[] {
  const checks: Check[] = [];
  for (const spec of patchSpecs) {
    if (!spec.vendored) continue;
    const directory = vendoredRoot(spec.package, context.packageRoot);
    if (readJson(join(directory, "package.json")) === undefined) continue;
    const problems = spec.inspect(readerFor(directory), "");
    checks.push(problems.length === 0
      ? { group: "vendored packages", status: "pass", message: `${spec.package}: ${spec.does} (in ${libraryName}'s copy)` }
      : { group: "vendored packages", status: "fail", message: `${spec.package} in ${libraryName}'s copy is not patched: ${spec.does}`, details: problems.slice(0, 4), fix: `install ${libraryName} again: the copy in vendor/${spec.package} is not the one the library was built with` });
  }
  return checks;
}

function patches(context: Context, libraryName: string, optional: ReadonlySet<string>): Check[] {
  const declared = declaredPatches(context.appRoot);
  const checks: Check[] = [];
  for (const patch of patchFiles(join(context.packageRoot, "patches"))) {
    const key = patchKey(patch);
    const spec = patchSpecs.find((candidate) => candidate.package === patch.package);
    if (!spec) continue;
    const parent = spec.via ? findPackage(spec.via, context.appRoot) : undefined;
    const installed: InstalledPackage | undefined = findPackage(patch.package, parent?.directory ?? context.appRoot);
    if (!installed) {
      checks.push(optional.has(patch.package)
        ? { group: "patches", status: "skip", message: `${key}: ${patch.package} is not installed (optional), nothing to patch` }
        : { group: "patches", status: "fail", message: `${key}: ${patch.package} is not installed${spec.via && !parent ? ` (${spec.via} is not either)` : ""}`, fix: `pnpm add ${patch.package}@${patch.version}` });
      continue;
    }
    if (installed.version !== patch.version) {
      // A package that comes with another one (`expo-modules-core` with `expo`) is asked for by a range there, so a fresh install takes the newest version in it, and the
      // app does not depend on it: pin it for the whole install, as an override, instead of adding a dependency that nothing in the app uses.
      const fix = spec.via
        ? `pin ${patch.package} for the install: \`overrides:\` with \`${patch.package}: ${patch.version}\` in pnpm-workspace.yaml (${spec.via} asks for it by a range, so a fresh install takes a newer version and pnpm reports ERR_PNPM_UNUSED_PATCH), then pnpm install (README: "Install in an app")`
        : `pnpm add ${patch.package}@${patch.version}`;
      checks.push({ group: "patches", status: "fail", message: `${patch.package} ${installed.version} is installed, the patch is for exactly ${patch.version}: pnpm would not apply it`, fix });
      continue;
    }
    const reader = readerFor(installed.directory);
    const patchText = readFileSync(patch.path, "utf8");
    const changed = spec.inspect(reader, patchText);
    const differing = changed.length === 0 ? missingFromPackage(patchText, reader) : [];
    if (changed.length === 0 && differing.length === 0) {
      checks.push({ group: "patches", status: "pass", message: `${key} applied: ${spec.does}` });
      continue;
    }
    const entry = declared.get(key);
    const copy = `node_modules/${libraryName}/patches/${patch.file}`;
    const fix = !entry
      ? `copy ${copy} into your repository (patches/expo-svelte/), declare "${key}: patches/expo-svelte/${patch.file}" under patchedDependencies in pnpm-workspace.yaml, then pnpm install (README: "Apply the patches")`
      : !existsSync(entry.file)
        ? `${entry.source} declares ${key} at ${entry.path}, which does not exist: copy ${copy} there, then pnpm install`
        : `${entry.source} declares ${key} (${entry.path}); run pnpm install, and if the package is still not patched copy ${copy} over that file (an older copy of the patch does not match this version of the library)`;
    const problems = changed.length > 0 ? changed : differing;
    checks.push({
      group: "patches",
      status: "fail",
      message: changed.length > 0 ? `${key} is not applied: ${spec.does}` : `${key} is patched, but not with this version of the library's patch`,
      details: problems.slice(0, 4).concat(problems.length > 4 ? [`and ${problems.length - 4} more`] : []),
      fix,
    });
  }
  return checks;
}

function integration(context: Context, name: string): Check[] {
  const metro = (finding: Finding): Check => {
    const file = finding.file ?? "";
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} uses withExpoSvelte` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not mention withExpoSvelte (a config that applies it from a file it imports is fine)`, fix: `module.exports = withExpoSvelte(getDefaultConfig(__dirname)), with withExpoSvelte from require("${name}/metro")` };
    return { group: "build integration", status: "fail", message: "no metro.config.js in the app: Expo's default Metro config does not know the library", fix: `create metro.config.js: module.exports = withExpoSvelte(getDefaultConfig(__dirname)), with withExpoSvelte from require("${name}/metro")` };
  };
  const plugin = (finding: Finding): Check => {
    const file = finding.file ?? "";
    // The package's own name finds `app.plugin.js`, which is the plugin (`<name>/app.plugin` is the same file). `<name>/expo` was removed in 0.4.0-rc.7: expo prebuild cannot resolve it.
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} lists the ${finding.name ?? name} plugin` };
    if (finding.state === "removed") return { group: "build integration", status: "fail", message: `${file} lists ${finding.name}, a path removed in 0.4.0-rc.7 that no longer resolves: expo prebuild fails on it`, fix: `write "${name}" in plugins in ${file}, in place of "${finding.name}"` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not name ${name} (a config that builds its plugins in code may add it)`, fix: `plugins: ["${name}"] in the Expo config` };
    if (finding.state === "absent") return { group: "build integration", status: "fail", message: `${file} does not list the ${name} plugin`, fix: `add "${name}" to plugins in ${file}` };
    return { group: "build integration", status: "fail", message: "no app.json or app.config.* in the app", fix: `create an Expo config with plugins: ["${name}"]` };
  };
  return [metro(metroFinding(context.appRoot)), plugin(expoPluginFinding(context.appRoot, name))];
}

/** Whether the app builds for Android: its `app.json` does not name `platforms` without it (an Expo config in code is not read: it is taken to). */
function targetsAndroid(appRoot: string): boolean {
  const expo = readJson(join(appRoot, "app.json"))?.expo;
  const platforms = typeof expo === "object" && expo !== null ? (expo as { platforms?: unknown }).platforms : undefined;
  return !Array.isArray(platforms) || platforms.includes("android");
}

/**
 * Android's prefab tool, which the native libraries the package carries (react-native-mmkv, react-native-reanimated: they link the prefab packages of the package's Nitro and Worklets copies, whose
 * folders are inside the package's own) are built with, reads a package path with an "=" in it as an option: `no such option /.../expo-svelte@..._patch_hash` (CXX1429). Every prefab package the
 * package links is in its own folder (its `vendor/` and `native/`), so its path is the one that counts. Two places give it an "=":
 * - pnpm's folder for it, `node_modules/.pnpm/expo-svelte@<version>_<peers>_patch_hash=<hash>`, when a peer of it is patched (the SvelteKit patch `init` declares). `depPathToFilename` (pnpm's
 *   `@pnpm/dependency-path`) leaves a name no longer than `virtualStoreDirMaxLength` and with no uppercase letter as it is, and cuts a longer one, or one with an uppercase letter (unless it starts with `file+`), to `limit - 33` characters and adds `_<hash>`: at the default, 120, 87
 *   characters stay and the "=" with them, at 60, 27 stay and it goes. `init` writes 60.
 * - the path of the project itself (`/ci/job=7/app`), which no pnpm setting changes, or a folder of a virtual store that is not `node_modules/.pnpm` (pnpm's `virtualStoreDir`).
 * Only the library's folder in `node_modules/.pnpm` (the last `.pnpm` of the path) is a failure: an "=" anywhere else is `unknown`, with both ways out, because the doctor cannot tell those two apart and has
 * not seen the build fail on either; and nothing is reported for an app that does not build for Android, or for a path without one: the checks of a set-up app stay as they were.
 */
export function storePath(context: Pick<Context, "appRoot" | "packageRoot">, name: string): Check[] {
  let path: string;
  try {
    path = realpathSync(context.packageRoot);
  } catch {
    return [];
  }
  if (!path.includes("=")) return [];
  const segments = path.split(/[\\/]/);
  // The folder after the last `.pnpm` under a `node_modules`: the library's folder in pnpm's virtual store (a path that has it twice is the inner one's).
  let store = -1;
  for (let at = segments.length - 1; at > 0 && store < 0; at--) if (segments[at] === ".pnpm" && segments[at - 1] === "node_modules") store = at;
  const folder = store < 0 ? undefined : segments[store + 1];
  if (!targetsAndroid(context.appRoot)) {
    return [{ group: "build integration", status: "skip", message: `${name} is installed at ${path}, a path with an "=" in it, which Android's prefab tool cannot take: not checked, app.json's platforms has no android` }];
  }
  if (folder?.includes("=")) {
    return [{
      group: "build integration",
      status: "fail",
      message: `${name} is installed in pnpm's folder ${folder}, a name with an "=" in it: Android's prefab tool reads the path as an option and the CMake build of ${name}'s native libraries stops with CXX1429 ("no such option")`,
      fix: `set \`virtualStoreDirMaxLength: 60\` in pnpm-workspace.yaml (\`pnpm exec expo-svelte init\` writes it) and install again: pnpm cuts a folder name longer than the limit, or with an uppercase letter, to \`limit - 33\` characters and adds a hash, which at the default of 120 keeps the "=" of \`patch_hash=\` and at 60 does not; pnpm removes node_modules and installs again (\`pnpm install --config.confirmModulesPurge=false\` when there is no terminal to ask)`,
    }];
  }
  // An "=" somewhere else in the path: the project's own folder (`/ci/job=7/app`), or the store folder of a virtual store that is not `node_modules/.pnpm` (`virtualStoreDir`), which this cannot tell
  // apart. The prefab tool is given paths in it either way, but the doctor has not seen the build fail on one, so it says it could not tell instead of failing, and names both remedies.
  const marked = segments.filter((segment) => segment.includes("="));
  return [{
    group: "build integration",
    status: "unknown",
    message: `${name} is installed at ${path}, a path with an "=" in it outside pnpm's folder for it (${marked.map((segment) => `"${segment}"`).join(", ")}): Android's prefab tool reads a package path with an "=" as an option and the CMake build of ${name}'s native libraries may stop with CXX1429 ("no such option")`,
    fix: "if the \"=\" is in the project's own path, move the project; if it is in the name of a folder of a virtual store that is not node_modules/.pnpm (pnpm's virtualStoreDir), pnpm's virtualStoreDirMaxLength cuts the name before it (`virtualStoreDirMaxLength: 60`, as `pnpm exec expo-svelte init` writes it)",
  }];
}

/** Every check, in the order they are printed. */
export function runChecks(context: Context): Check[] {
  const own = readJson(join(context.packageRoot, "package.json")) ?? {};
  const name = text(own.name) ?? "expo-svelte";
  const appPackage = readJson(join(context.appRoot, "package.json"));
  if (!appPackage) {
    return [{ group: "environment", status: "fail", message: `${context.appRoot} has no package.json: this is not an app directory`, fix: "run expo-svelte doctor from the app's directory" }];
  }
  const peers = record(own.peerDependencies);
  const optional = new Set(Object.entries(record(own.peerDependenciesMeta)).filter(([, meta]) => record(meta).optional === true).map(([peer]) => peer));
  return [
    ...environment(context),
    svelte(context, peers),
    ...peerDependencies(context, peers, optional),
    ...expoRuntime(context),
    ...vendored(context, name),
    ...vendoredPatches(context, name),
    ...patches(context, name, optional),
    library(context, name, text(own.version) ?? "?", appPackage),
    ...integration(context, name),
    ...storePath(context, name),
    ...pushChecks(context, { name, version: text(own.version) ?? "?" }, appPackage),
  ];
}
