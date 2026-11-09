import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { declaredPatches } from "./declared.ts";
import { expoPluginFinding, metroFinding, type Finding } from "./integration.ts";
import { missingFromPackage } from "./hunks.ts";
import { patchFiles, patchKey, patchSpecs } from "./patches.ts";
import { requirements } from "./requirements.ts";
import { findPackage, readerFor, readJson, type InstalledPackage } from "./resolve.ts";
import { satisfies } from "./semver.ts";

export type Status = "pass" | "fail" | "skip" | "unknown";
export type Check = {
  group: "environment" | "svelte" | "peer dependencies" | "patches" | "build integration";
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
};

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function environment(context: Context): Check[] {
  const checks: Check[] = [];
  if (context.node === undefined) {
    checks.push({ group: "environment", status: "unknown", message: `could not run node (needs ${requirements.node})`, fix: `install Node ${requirements.node.slice(2)} or newer and put it on the PATH` });
  } else {
    const ok = satisfies(context.node, requirements.node);
    checks.push(ok
      ? { group: "environment", status: "pass", message: `node ${context.node} (needs ${requirements.node})` }
      : { group: "environment", status: "fail", message: `node ${context.node} does not satisfy ${requirements.node}`, fix: `install Node ${requirements.node.slice(2)} or newer (the repository pins 25.0.0)` });
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
    : { group: "build integration", status: "fail", message: `${name} is not a dependency of the app (${join(context.appRoot, "package.json")})`, fix: `add it to the app's dependencies (README: "Set up an app")` };
}

/** The renderer build of Svelte: the `./renderer` export and the compiler option the library compiles with. */
function svelte(context: Context, peers: Record<string, unknown>): Check {
  const installed = findPackage("svelte", context.appRoot);
  const fix = "install the custom-renderer build of Svelte (sveltejs/svelte#18042, commit 216f258, 5.56.7); README: \"Set up an app\"";
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
      message: `svelte ${installed.version} is the stock Svelte: ${!exported ? "it has no ./renderer export" : "its compiler has no customRenderer option"} (${installed.directory})`,
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
  if (absent.length > 0) checks.push({ group: "peer dependencies", status: "skip", message: `optional view libraries not installed, nothing to check: ${absent.join(", ")}` });
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
      checks.push({ group: "patches", status: "fail", message: `${patch.package} ${installed.version} is installed, the patch is for exactly ${patch.version}: pnpm would not apply it`, fix: `pnpm add ${patch.package}@${patch.version}` });
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
      ? `copy ${copy} into your repository (patches/svelte-native/), declare "${key}: patches/svelte-native/${patch.file}" under patchedDependencies in pnpm-workspace.yaml, then pnpm install (README: "Apply the patches")`
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
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} uses withSvelteNative` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not mention withSvelteNative (a config that applies it from a file it imports is fine)`, fix: `module.exports = withSvelteNative(getDefaultConfig(__dirname)), with withSvelteNative from require("${name}/metro")` };
    return { group: "build integration", status: "fail", message: "no metro.config.js in the app: Expo's default Metro config does not know the library", fix: `create metro.config.js: module.exports = withSvelteNative(getDefaultConfig(__dirname)), with withSvelteNative from require("${name}/metro")` };
  };
  const plugin = (finding: Finding): Check => {
    const file = finding.file ?? "";
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} lists the ${name}/expo plugin` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not name ${name}/expo (a config that builds its plugins in code may add it)`, fix: `plugins: [["${name}/expo", {}]] in the Expo config` };
    if (finding.state === "absent") return { group: "build integration", status: "fail", message: `${file} does not list the ${name}/expo plugin`, fix: `add "${name}/expo" to plugins in ${file}` };
    return { group: "build integration", status: "fail", message: "no app.json or app.config.* in the app", fix: `create an Expo config with plugins: [["${name}/expo", {}]]` };
  };
  return [metro(metroFinding(context.appRoot)), plugin(expoPluginFinding(context.appRoot, name))];
}

/** Every check, in the order they are printed. */
export function runChecks(context: Context): Check[] {
  const own = readJson(join(context.packageRoot, "package.json")) ?? {};
  const name = text(own.name) ?? "@example/svelte-native";
  const appPackage = readJson(join(context.appRoot, "package.json"));
  if (!appPackage) {
    return [{ group: "environment", status: "fail", message: `${context.appRoot} has no package.json: this is not an app directory`, fix: "run svelte-native doctor from the app's directory" }];
  }
  const peers = record(own.peerDependencies);
  const optional = new Set(Object.entries(record(own.peerDependenciesMeta)).filter(([, meta]) => record(meta).optional === true).map(([peer]) => peer));
  return [
    ...environment(context),
    svelte(context, peers),
    ...peerDependencies(context, peers, optional),
    ...patches(context, name, optional),
    library(context, name, text(own.version) ?? "?", appPackage),
    ...integration(context, name),
  ];
}
