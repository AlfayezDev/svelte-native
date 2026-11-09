#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/package-root.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function findPackageRoot(from) {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (dirname(directory) === directory) throw new Error(`No package.json above ${from}: the package's files moved`);
  }
}
var packageRoot, sourceDirectory;
var init_package_root = __esm({
  "src/package-root.ts"() {
    "use strict";
    packageRoot = findPackageRoot(import.meta.dirname);
    sourceDirectory = join(packageRoot, "src");
  }
});

// src/doctor/resolve.ts
import { existsSync as existsSync3, readdirSync as readdirSync2, readFileSync as readFileSync2, realpathSync } from "node:fs";
import { basename, dirname as dirname2, join as join2, resolve as resolve3 } from "node:path";
function readerFor(directory) {
  return {
    read(path) {
      try {
        return readFileSync2(join2(directory, path), "utf8");
      } catch {
        return void 0;
      }
    },
    list(path) {
      try {
        return readdirSync2(join2(directory, path));
      } catch {
        return [];
      }
    }
  };
}
function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync2(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function findPackage(name, from) {
  for (let directory = resolve3(from); ; directory = dirname2(directory)) {
    const candidate = join2(basename(directory) === "node_modules" ? directory : join2(directory, "node_modules"), name);
    const json = readJson(join2(candidate, "package.json"));
    if (json && typeof json.version === "string") return { name, version: json.version, directory: realpathSync(candidate), json };
    if (dirname2(directory) === directory) return void 0;
  }
}
function findUp(file, from) {
  for (let directory = resolve3(from); ; directory = dirname2(directory)) {
    if (existsSync3(join2(directory, file))) return directory;
    if (dirname2(directory) === directory) return void 0;
  }
}
var init_resolve = __esm({
  "src/doctor/resolve.ts"() {
    "use strict";
  }
});

// src/doctor/declared.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname3, join as join3, resolve as resolve4 } from "node:path";
function patchedDependenciesOfYaml(text2) {
  const entries = /* @__PURE__ */ new Map();
  let inside = false;
  for (const line of text2.split(/\r?\n/)) {
    if (/^patchedDependencies:\s*(#.*)?$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside || /^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const entry = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/.exec(line);
    if (entry) entries.set(entry[1] ?? entry[2] ?? entry[3] ?? "", entry[4] ?? entry[5] ?? entry[6] ?? "");
  }
  return entries;
}
function declaredPatches(appRoot) {
  const declared = /* @__PURE__ */ new Map();
  const add = (entries, base, source) => {
    for (const [key, path] of entries) if (!declared.has(key)) declared.set(key, { path, file: resolve4(base, path), source });
  };
  const fromJson = (json) => {
    const pnpm = json?.pnpm;
    const patched = typeof pnpm === "object" && pnpm !== null ? pnpm.patchedDependencies : void 0;
    return typeof patched === "object" && patched !== null ? Object.entries(patched).filter((entry) => typeof entry[1] === "string") : [];
  };
  const workspace = findUp("pnpm-workspace.yaml", appRoot);
  if (workspace) {
    try {
      add(patchedDependenciesOfYaml(readFileSync3(join3(workspace, "pnpm-workspace.yaml"), "utf8")), workspace, "pnpm-workspace.yaml");
    } catch {
    }
  }
  const top = workspace ?? resolve4(appRoot);
  for (let directory = resolve4(appRoot); ; directory = dirname3(directory)) {
    add(fromJson(readJson(join3(directory, "package.json"))), directory, "package.json");
    if (directory === top || dirname3(directory) === directory) break;
  }
  return declared;
}
var init_declared = __esm({
  "src/doctor/declared.ts"() {
    "use strict";
    init_resolve();
  }
});

// src/doctor/integration.ts
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
function withoutJsComments(text2) {
  return text2.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}
function metroFinding(appRoot) {
  const file = firstExisting(appRoot, METRO_FILES);
  if (!file) return { state: "no-file" };
  const code = withoutJsComments(readFileSync4(join4(appRoot, file), "utf8"));
  return { state: /\bwithSvelteNative\b/.test(code) ? "found" : "unclear", file };
}
function expoPluginFinding(appRoot, library2) {
  const names = [`${library2}/expo`, library2];
  const json = firstExisting(appRoot, ["app.json"]);
  const code = firstExisting(appRoot, APP_CONFIG_FILES);
  if (json) {
    const parsed = readJson(join4(appRoot, json));
    const expo = parsed?.expo ?? parsed;
    const plugins = Array.isArray(expo?.plugins) ? expo.plugins : [];
    const listed = names.find((name) => plugins.some((entry) => pluginName(entry) === name));
    if (listed) return { state: "found", file: json, name: listed };
  }
  if (code) {
    const source = withoutJsComments(readFileSync4(join4(appRoot, code), "utf8"));
    const named = names.find((name) => ['"', "'", "`"].some((quote) => source.includes(`${quote}${name}${quote}`)));
    return named ? { state: "found", file: code, name: named } : { state: "unclear", file: code };
  }
  return json ? { state: "absent", file: json } : { state: "no-file" };
}
var METRO_FILES, APP_CONFIG_FILES, firstExisting, pluginName;
var init_integration = __esm({
  "src/doctor/integration.ts"() {
    "use strict";
    init_resolve();
    METRO_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts", "metro.config.mts", "metro.config.cts"];
    APP_CONFIG_FILES = ["app.config.ts", "app.config.js", "app.config.cjs", "app.config.mjs", "app.config.mts", "app.config.cts"];
    firstExisting = (root2, names) => names.find((name) => existsSync4(join4(root2, name)));
    pluginName = (entry) => typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : void 0;
  }
});

// src/doctor/hunks.ts
function parsePatch(text2) {
  const lines = text2.replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let current;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff --git ")) {
      current = { path: (/ b\/(.+)$/.exec(line)?.[1] ?? "").trim(), created: false, removed: false, hunks: [] };
      files.push(current);
    } else if (current && line.startsWith("new file mode")) {
      current.created = true;
    } else if (current && line.startsWith("deleted file mode")) {
      current.removed = true;
    } else if (current && line.startsWith("@@")) {
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      let before = Number(header?.[1] ?? 1);
      let after = Number(header?.[2] ?? 1);
      const hunk = { before: [], after: [] };
      while ((before > 0 || after > 0) && index + 1 < lines.length) {
        const body = lines[++index] ?? "";
        const mark = body[0] ?? " ";
        if (mark === "\\") continue;
        if (mark === " " || body === "") {
          hunk.before.push(body.slice(1));
          hunk.after.push(body.slice(1));
          before--;
          after--;
        } else if (mark === "+") {
          hunk.after.push(body.slice(1));
          after--;
        } else if (mark === "-") {
          hunk.before.push(body.slice(1));
          before--;
        } else throw new Error(`patch line ${index + 1} is not part of a hunk: ${body}`);
      }
      current.hunks.push(hunk);
    }
  }
  return files;
}
function indexOfBlock(haystack, block2) {
  if (block2.length === 0) return 0;
  for (let start = haystack.indexOf(block2[0] ?? ""); start >= 0 && start + block2.length <= haystack.length; start = haystack.indexOf(block2[0] ?? "", start + 1)) {
    if (block2.every((line, offset) => haystack[start + offset] === line)) return start;
  }
  return -1;
}
function missingFromPackage(patch, installed) {
  const missing = [];
  for (const file of parsePatch(patch)) {
    const text2 = installed.read(file.path);
    if (file.removed) {
      if (text2 !== void 0) missing.push(`${file.path} should be gone`);
      continue;
    }
    if (text2 === void 0) {
      missing.push(`${file.path} is not there`);
      continue;
    }
    const lines = text2.replace(/\r\n/g, "\n").split("\n");
    file.hunks.forEach((hunk, index) => {
      if (indexOfBlock(lines, hunk.after) < 0) missing.push(`${file.path}: hunk ${index + 1} of ${file.hunks.length} of the patch is not in the installed file`);
    });
  }
  return missing;
}
var init_hunks = __esm({
  "src/doctor/hunks.ts"() {
    "use strict";
  }
});

// src/doctor/shapes.ts
function inFile(read, path, checks, raw = false) {
  const text2 = read.read(path);
  if (text2 === void 0) return [`${path} is not in the package`];
  const code = raw ? text2 : stripComments(text2);
  return checks.filter(([, holds2]) => !holds2(code)).map(([problem]) => `${path}: ${problem}`);
}
function kitProblems(read) {
  return [
    ...inFile(read, "src/core/sync/create_manifest_data/index.js", [["does not skip the +mobile files of a route directory", has("(?:mobile\\.|(?:layout|error)\\.mobile\\.)")]], true),
    ...inFile(read, "src/exports/vite/index.js", [["the `+page`/`+layout` warnings still look at .mobile.svelte files", count("filename.endsWith('.mobile.svelte')", 2)]], true)
  ];
}
function pdfProblems(read) {
  return inFile(read, "android/src/main/java/org/wonday/pdf/events/TopChangeEvent.java", [["canCoalesce() is not overridden to return false", neverCoalesces]]);
}
function videoEmitterProblems(emitter) {
  const code = stripComments(emitter);
  const custom = /private class VideoCustomEvent\([\s\S]*?\n {4}\}\n/.exec(code)?.[0] ?? "";
  const problems = [];
  if (!/private val coalescable: Boolean/.test(custom)) problems.push("VideoCustomEvent has no coalescable flag");
  if (!/override fun canCoalesce\(\): Boolean = coalescable/.test(custom)) problems.push("VideoCustomEvent.canCoalesce() does not answer with the flag");
  if (!/fun dispatch\(event: EventTypes, coalescable: Boolean = false, paramsSetter/.test(code)) problems.push("dispatch() does not default to an event that cannot coalesce");
  if (code.match(/: Event</g)?.length !== 1) problems.push("the emitter no longer has exactly one Event class");
  const streams = [...code.matchAll(/event\.dispatch\(EventTypes\.(\w+), coalescable = true\)/g)].map((match) => match[1]).sort();
  if (streams.join(",") !== "EVENT_BANDWIDTH,EVENT_PROGRESS") problems.push(`the events that may coalesce are ${streams.join(", ") || "none"}, not EVENT_BANDWIDTH and EVENT_PROGRESS`);
  return problems;
}
function videoProblems(read) {
  const path = "android/src/main/java/com/brentvatne/common/react/VideoEventEmitter.kt";
  const emitter = read.read(path);
  return emitter === void 0 ? [`${path} is not in the package`] : videoEmitterProblems(emitter).map((problem) => `${path}: ${problem}`);
}
function mapsProblems(read) {
  const directory = "android/src/main/java/com/rnmaps/fabric/event";
  const files = read.list(directory).filter((file) => file.endsWith(".java"));
  if (files.length === 0) return [`${directory} is not in the package`];
  const problems = [];
  for (const file of files) {
    const stream = mapsStreamEvents.includes(file.slice(0, -".java".length));
    problems.push(...inFile(read, `${directory}/${file}`, [stream ? ["a stream event no longer coalesces", (code) => !code.includes("canCoalesce")] : ["canCoalesce() is not overridden to return false", neverCoalesces]]));
  }
  return problems;
}
function lottieProblems(read) {
  const directory = "android/src/main/java/com/airbnb/android/react/lottie";
  const events = read.list(directory).filter((file) => /^On\w+Event\.kt$/.test(file));
  const android = events.length === 0 ? [`${directory} has no event classes`] : events.flatMap((file) => inFile(read, `${directory}/${file}`, [["canCoalesce() is not overridden to return false", neverCoalesces]]));
  const ios = inFile(read, "ios/Fabric/LottieAnimationViewComponentView.mm", [["does not keep events until the view has its emitter", (code) => code.includes("_eventsBeforeEmitter") && code.includes("lottieSendEvent:")]]);
  return [...android, ...ios];
}
function rnghProblems(read) {
  return Object.entries(rnghAdditions).flatMap(([path, lines]) => inFile(read, path, [
    ...lines.map((line) => [`does not have \`${line.split("\n")[0]}\``, has(line)]),
    ...path.endsWith(".mm") ? [
      ...rnghUses.map((use) => [`does not use \`${use}\``, has(use)]),
      ["does not register through the library's own registerViewWithGestureRecognizerAttachedIfNeeded:", (code) => rnghRegistration.test(code)]
    ] : []
  ], true));
}
function reanimatedProblems(read) {
  const base = "android/src/main";
  return [
    ...inFile(read, `${base}/java/com/swmansion/reanimated/SvelteEngineHook.kt`, [["has no `updater` hook", has("var updater")]]),
    ...inFile(read, `${base}/java/com/swmansion/reanimated/NativeProxy.kt`, [
      ["does not offer the engine's hook before React Native's prop dispatch", has("SvelteEngineHook.updater?.invoke(viewTag, props)")],
      ["has no direct path for opacity and translate/scale transforms", has("private fun applySimpleProps(")]
    ]),
    ...inFile(read, `${base}/cpp/reanimated/android/NativeProxy.cpp`, [["does not export reanimatedSetSynchronousPropsSink", has("reanimatedSetSynchronousPropsSink")], ["does not call the sink", has("synchronousPropsSink.load")]]),
    ...inFile(read, `${base}/cpp/reanimated/android/NativeProxy.h`, [["does not declare SynchronousPropsSink", has("SynchronousPropsSink")], ["does not keep the sink's rest buffers", has("sinkRestInts_")]])
  ];
}
function workletsProblems(read) {
  const check = (path) => inFile(read, path, [
    ["does not request a native frame on demand", (code) => code.includes("let frameRequested = false;") && code.includes("function requestFrame()")],
    ["still starts the per-frame loop", (code) => !code.includes("/* Start the loop */") && code.split("__nativeRequestAnimationFrame(").length - 1 === 1]
  ], true);
  return [...check("lib/module/runLoop/uiRuntime/requestAnimationFrame.js"), ...check("src/runLoop/uiRuntime/requestAnimationFrame.ts")];
}
function addedLines(patch, file) {
  const start = patch.indexOf(`diff --git a/${file}`);
  if (start < 0) return "";
  const end = patch.indexOf("diff --git", start + 1);
  return patch.slice(start, end < 0 ? void 0 : end).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
}
function block(source, header) {
  const match = header.exec(source);
  if (!match) throw new Error(`${header} not found in the registry`);
  const rest = source.slice(match.index + match[0].length);
  return rest.slice(0, rest.search(/^\s*\)\s*$/m));
}
function lazyRegistry(patch) {
  const registry = addedLines(patch, moduleRegistryPath);
  return {
    lazyEntries: [...block(registry, /LAZY_MODULE_NAMES = mapOf\(/).matchAll(/"([\w.]+)" to "(\w+)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]),
    prewarm: strings(block(registry, /PREWARM_MODULE_NAMES = listOf\(/)),
    startup: strings(/STARTUP_MODULE_NAMES = listOf\(([^)]*)\)/.exec(registry)?.[1] ?? ""),
    definitionOnly: strings(/DEFINITION_ONLY_MODULE_NAMES = setOf\(([^)]*)\)/.exec(registry)?.[1] ?? "")
  };
}
function adapterLoadsRegistryLazily(source) {
  return !/^import .*NativeComponentRegistry/m.test(source) && /require\('react-native\/Libraries\/NativeComponent\/NativeComponentRegistry'\)/.test(source);
}
function expoModulesCoreProblems(read, patch) {
  const { lazyEntries, prewarm, startup } = lazyRegistry(patch);
  return [
    ...inFile(read, moduleRegistryPath, [
      ["does not list the lazy modules the patch defines", (text2) => lazyEntries.length > 10 && lazyEntries.every(([className, name]) => text2.includes(`"${className}" to "${name}"`))],
      ["does not name the prewarmed and startup modules the patch defines", (text2) => [...prewarm, ...startup].every((name) => text2.includes(`"${name}"`))]
    ], true),
    ...inFile(read, "android/src/main/java/expo/modules/adapters/react/NativeModulesProxy.java", [["cannot build the interop registry in the background", has("startInteropInBackground")]], true),
    ...inFile(read, "src/NativeViewManagerAdapter.native.tsx", [["imports the native component registry when it loads", adapterLoadsRegistryLazily]], true)
  ];
}
var stripComments, neverCoalescesPattern, neverCoalesces, has, count, mapsStreamEvents, rnghAdditions, rnghUses, rnghRegistration, strings, moduleRegistryPath;
var init_shapes = __esm({
  "src/doctor/shapes.ts"() {
    "use strict";
    stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    neverCoalescesPattern = /(?:@Override\s+public boolean canCoalesce\(\)\s*\{\s*return false;\s*\}|override fun canCoalesce\(\): Boolean = false)/;
    neverCoalesces = (code) => neverCoalescesPattern.test(stripComments(code));
    has = (needle) => (code) => code.includes(needle);
    count = (needle, atLeast) => (code) => code.split(needle).length - 1 >= atLeast;
    mapsStreamEvents = ["OnDragEvent", "OnMarkerDragEvent", "OnPanDragEvent", "OnRegionChangeEvent", "OnUserLocationChangeEvent"];
    rnghAdditions = {
      "apple/RNGestureHandlerManager.h": ["+ (nullable RNGestureHandlerManager *)currentManager;", "- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view;"],
      "apple/RNGestureHandlerManager.mm": ["+ (nullable RNGestureHandlerManager *)currentManager\n{", "- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view\n{"]
    };
    rnghUses = ["RNGHViewHasSurfaceTouchHandler(touchHandlerView)"];
    rnghRegistration = /\[self registerViewWithGestureRecognizerAttachedIfNeeded:view\];/;
    strings = (text2) => [...text2.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
    moduleRegistryPath = "android/src/main/java/expo/modules/kotlin/ModuleRegistry.kt";
  }
});

// src/doctor/patches.ts
import { readdirSync as readdirSync3 } from "node:fs";
import { resolve as resolve5 } from "node:path";
function patchFiles(directory = patchesDirectory) {
  return readdirSync3(directory).filter((file) => file.endsWith(".patch")).sort().map((file) => {
    const stem = file.slice(0, -".patch".length);
    const at = stem.lastIndexOf("@");
    if (at <= 0) throw new Error(`${file}: a patch is named <package>@<version>.patch`);
    return { package: stem.slice(0, at).replaceAll("__", "/"), version: stem.slice(at + 1), file, path: resolve5(directory, file) };
  });
}
var patchesDirectory, patchSpecs, patchKey;
var init_patches = __esm({
  "src/doctor/patches.ts"() {
    "use strict";
    init_package_root();
    init_shapes();
    patchesDirectory = resolve5(packageRoot, "patches");
    patchSpecs = [
      { package: "@sveltejs/kit", does: "SvelteKit leaves the `+mobile.svelte` files of a route directory alone", inspect: kitProblems },
      { package: "expo-modules-core", via: "expo", does: "Expo modules register lazily and the common ones are prewarmed (Android start)", inspect: expoModulesCoreProblems },
      { package: "lottie-react-native", does: "Lottie's events are delivered one by one (Android) and a load or failure before the emitter exists is kept (iOS)", inspect: lottieProblems },
      { package: "react-native-gesture-handler", does: "the root gesture recognizer can be registered for the screens the library presents (iOS)", inspect: rnghProblems },
      { package: "react-native-maps", does: "the map's discrete events are delivered one by one, its streams still coalesce (Android)", inspect: mapsProblems },
      { package: "react-native-pdf", does: "the pdf view's one event, which carries every message, no longer coalesces (Android)", inspect: pdfProblems },
      { package: "react-native-reanimated", does: "the engine's views are written natively and opacity/translate/scale skip React Native's prop path (Android)", inspect: reanimatedProblems },
      { package: "react-native-video", does: "only progress and bandwidth events coalesce; every other video event is delivered (Android)", inspect: videoProblems },
      { package: "react-native-worklets", does: "the UI runtime asks for a frame only while a callback waits, with no idle per-frame loop", inspect: workletsProblems }
    ];
    patchKey = (patch) => `${patch.package}@${patch.version}`;
  }
});

// src/doctor/requirements.ts
var requirements;
var init_requirements = __esm({
  "src/doctor/requirements.ts"() {
    "use strict";
    requirements = {
      node: ">=25.0.0",
      pnpm: ">=12.3.4"
    };
  }
});

// src/doctor/semver.ts
function parseVersion(text2) {
  const match = VERSION.exec(text2.trim());
  if (!match) return void 0;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split(".") : [] };
}
function compareIdentifiers(a, b) {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return Math.sign(Number(a) - Number(b));
  if (numericA) return -1;
  if (numericB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === void 0) return -1;
    if (right === void 0) return 1;
    const order = compareIdentifiers(left, right);
    if (order !== 0) return order;
  }
  return 0;
}
function comparatorsOf(token) {
  const operator = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  const match = PARTIAL.exec(operator?.[2] ?? "");
  if (!match) return void 0;
  const wildcard = (part) => part === void 0 || /^[xX*]$/.test(part);
  const [, major, minor, patch, prerelease] = match;
  const make = (a, b, c, pre = "") => ({ major: a, minor: b, patch: c, prerelease: pre ? pre.split(".") : [] });
  const lowest = make(wildcard(major) ? 0 : Number(major), wildcard(minor) ? 0 : Number(minor), wildcard(patch) ? 0 : Number(patch), prerelease);
  const lowestOfNext = () => {
    if (wildcard(major)) return void 0;
    if (wildcard(minor)) return make(Number(major) + 1, 0, 0, "0");
    if (wildcard(patch)) return make(Number(major), Number(minor) + 1, 0, "0");
    return void 0;
  };
  const op = operator?.[1] ?? "";
  const partial = wildcard(major) || wildcard(minor) || wildcard(patch);
  if (op === "^") {
    const upper = lowest.major > 0 || wildcard(minor) ? make(lowest.major + 1, 0, 0, "0") : lowest.minor > 0 || wildcard(patch) ? make(0, lowest.minor + 1, 0, "0") : make(0, 0, lowest.patch + 1, "0");
    return [{ operator: ">=", version: lowest }, { operator: "<", version: upper }];
  }
  if (op === "~") {
    const upper = wildcard(minor) ? make(lowest.major + 1, 0, 0, "0") : make(lowest.major, lowest.minor + 1, 0, "0");
    return [{ operator: ">=", version: lowest }, { operator: "<", version: upper }];
  }
  if (op === "" || op === "=") {
    if (!partial) return [{ operator: "=", version: lowest }];
    const upper = lowestOfNext();
    return upper ? [{ operator: ">=", version: lowest }, { operator: "<", version: upper }] : [];
  }
  if (partial) {
    if (op === ">") return [{ operator: ">=", version: lowestOfNext() ?? lowest }];
    if (op === "<=") return lowestOfNext() ? [{ operator: "<", version: lowestOfNext() }] : [];
  }
  return [{ operator: op, version: lowest }];
}
function holds(version, { operator, version: bound }) {
  const order = compareVersions(version, bound);
  return operator === "=" ? order === 0 : operator === ">=" ? order >= 0 : operator === ">" ? order > 0 : operator === "<=" ? order <= 0 : order < 0;
}
function satisfies(version, range) {
  const installed = parseVersion(version);
  if (!installed) return void 0;
  let readable = false;
  for (const alternative of range.split("||")) {
    const tokens = alternative.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1").split(/\s+/).filter(Boolean);
    const sets = tokens.map(comparatorsOf);
    if (tokens.length === 0 || sets.some((set) => set === void 0)) return void 0;
    readable = true;
    const comparators = sets.flat();
    const allowsPrerelease = installed.prerelease.length === 0 || comparators.some(({ version: bound }) => bound.prerelease.length > 0 && bound.major === installed.major && bound.minor === installed.minor && bound.patch === installed.patch);
    if (allowsPrerelease && comparators.every((comparator) => holds(installed, comparator))) return true;
  }
  return readable ? false : void 0;
}
var VERSION, PARTIAL;
var init_semver = __esm({
  "src/doctor/semver.ts"() {
    "use strict";
    VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
    PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  }
});

// src/doctor/checks.ts
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";
function environment(context) {
  const checks = [];
  if (context.node === void 0) {
    checks.push({ group: "environment", status: "unknown", message: `could not run node (needs ${requirements.node})`, fix: `install Node ${requirements.node.slice(2)} or newer and put it on the PATH` });
  } else {
    const ok = satisfies(context.node, requirements.node);
    checks.push(ok ? { group: "environment", status: "pass", message: `node ${context.node} (needs ${requirements.node})` } : { group: "environment", status: "fail", message: `node ${context.node} does not satisfy ${requirements.node}`, fix: `install Node ${requirements.node.slice(2)} or newer (the repository pins 25.0.0)` });
  }
  const pnpm = context.pnpm();
  if (pnpm === void 0) {
    checks.push({ group: "environment", status: "unknown", message: `could not run pnpm (needs ${requirements.pnpm})`, fix: `install pnpm ${requirements.pnpm.slice(2)} or newer (corepack enable pnpm); the patches are applied by pnpm` });
  } else if (satisfies(pnpm, requirements.pnpm)) {
    checks.push({ group: "environment", status: "pass", message: `pnpm ${pnpm} (needs ${requirements.pnpm})` });
  } else {
    checks.push({ group: "environment", status: "fail", message: `pnpm ${pnpm} does not satisfy ${requirements.pnpm}`, fix: `use pnpm ${requirements.pnpm.slice(2)} or newer (corepack use pnpm@${requirements.pnpm.slice(2)})` });
  }
  return checks;
}
function library(context, name, version, appPackage) {
  const dependencies = { ...record(appPackage.dependencies), ...record(appPackage.devDependencies), ...record(appPackage.optionalDependencies) };
  return name in dependencies ? { group: "build integration", status: "pass", message: `${name} ${version} is a dependency of the app` } : { group: "build integration", status: "fail", message: `${name} is not a dependency of the app (${join5(context.appRoot, "package.json")})`, fix: `add it to the app's dependencies (README: "Install in an app"), or run \`pnpm exec svelte-native init\`` };
}
function svelte(context, peers) {
  const installed = findPackage("svelte", context.appRoot);
  const fix = 'install the custom-renderer build of Svelte (sveltejs/svelte#18042, commit 216f258, 5.56.7): `pnpm exec svelte-native init` does it (docs/02-creating-a-project.md), or by hand, README "Install in an app"';
  if (!installed) return { group: "svelte", status: "fail", message: "svelte is not installed", fix };
  const entry = record(installed.json.exports)["./renderer"];
  const target = text(entry) ?? text(record(entry).default);
  const exported = target !== void 0 && existsSync5(join5(installed.directory, target));
  const compiler = ["src/compiler/validate-options.js", "compiler/index.js"].some((file) => {
    try {
      return readFileSync5(join5(installed.directory, file), "utf8").includes("customRenderer");
    } catch {
      return false;
    }
  });
  if (!exported || !compiler) {
    return {
      group: "svelte",
      status: "fail",
      message: `svelte ${installed.version} is the stock Svelte: ${!exported ? "it has no ./renderer export" : "its compiler has no customRenderer option"} (${installed.directory})`,
      fix
    };
  }
  const range = text(peers.svelte);
  if (range !== void 0 && satisfies(installed.version, range) === false) {
    return { group: "svelte", status: "fail", message: `svelte ${installed.version} has ./renderer but does not satisfy ${range}`, fix };
  }
  return { group: "svelte", status: "pass", message: `svelte ${installed.version} has the ./renderer export and the customRenderer compiler option` };
}
function peerDependencies(context, peers, optional) {
  const checks = [];
  const absent = [];
  for (const [name, wanted] of Object.entries(peers).sort(([a], [b]) => a.localeCompare(b))) {
    const range = text(wanted);
    if (range === void 0 || name === "svelte") continue;
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
function expoRuntime(context) {
  const expo = findPackage("expo", context.appRoot);
  if (!expo) return [];
  const missing = EXPO_RUNTIME_FILES.filter((file) => !existsSync5(join5(expo.directory, file)));
  if (missing.length === 0) return [{ group: "peer dependencies", status: "pass", message: `expo ${expo.version} has src/winter, the runtime (URL, fetch, TextDecoder) that the library's polyfills import` }];
  return [{
    group: "peer dependencies",
    status: "fail",
    message: `expo ${expo.version} has no ${missing.join(", ")} (${expo.directory}): the library's polyfills import expo/src/winter for the standard URL, and the router starts blank without it`,
    fix: `npx expo install expo (the version this library was exercised on is in its peerDependencies)`
  }];
}
function autolinkedPeers(context, peers, appPackage) {
  const dependencies = { ...record(appPackage.dependencies), ...record(appPackage.devDependencies), ...record(appPackage.optionalDependencies) };
  const checks = [];
  for (const name of AUTOLINKED_PEERS) {
    const range = text(peers[name]);
    if (range === void 0) continue;
    if (name in dependencies) {
      checks.push({ group: "peer dependencies", status: "pass", message: `${name} is a dependency of the app: React Native's autolinking links its native module` });
    } else if (findPackage(name, context.appRoot)) {
      checks.push({ group: "peer dependencies", status: "fail", message: `${name} is installed but is not a dependency of the app (${join5(context.appRoot, "package.json")}): React Native's autolinking links only the app's own dependencies, so the build would not have its native module`, fix: `pnpm add ${name}@${range}, then npx expo prebuild` });
    }
  }
  return checks;
}
function patches(context, libraryName, optional) {
  const declared = declaredPatches(context.appRoot);
  const checks = [];
  for (const patch of patchFiles(join5(context.packageRoot, "patches"))) {
    const key = patchKey(patch);
    const spec = patchSpecs.find((candidate) => candidate.package === patch.package);
    if (!spec) continue;
    const parent = spec.via ? findPackage(spec.via, context.appRoot) : void 0;
    const installed = findPackage(patch.package, parent?.directory ?? context.appRoot);
    if (!installed) {
      checks.push(optional.has(patch.package) ? { group: "patches", status: "skip", message: `${key}: ${patch.package} is not installed (optional), nothing to patch` } : { group: "patches", status: "fail", message: `${key}: ${patch.package} is not installed${spec.via && !parent ? ` (${spec.via} is not either)` : ""}`, fix: `pnpm add ${patch.package}@${patch.version}` });
      continue;
    }
    if (installed.version !== patch.version) {
      const fix2 = spec.via ? `pin ${patch.package} for the install: \`overrides:\` with \`${patch.package}: ${patch.version}\` in pnpm-workspace.yaml (${spec.via} asks for it by a range, so a fresh install takes a newer version and pnpm reports ERR_PNPM_UNUSED_PATCH), then pnpm install (README: "Install in an app")` : `pnpm add ${patch.package}@${patch.version}`;
      checks.push({ group: "patches", status: "fail", message: `${patch.package} ${installed.version} is installed, the patch is for exactly ${patch.version}: pnpm would not apply it`, fix: fix2 });
      continue;
    }
    const reader = readerFor(installed.directory);
    const patchText = readFileSync5(patch.path, "utf8");
    const changed = spec.inspect(reader, patchText);
    const differing = changed.length === 0 ? missingFromPackage(patchText, reader) : [];
    if (changed.length === 0 && differing.length === 0) {
      checks.push({ group: "patches", status: "pass", message: `${key} applied: ${spec.does}` });
      continue;
    }
    const entry = declared.get(key);
    const copy = `node_modules/${libraryName}/patches/${patch.file}`;
    const fix = !entry ? `copy ${copy} into your repository (patches/svelte-native/), declare "${key}: patches/svelte-native/${patch.file}" under patchedDependencies in pnpm-workspace.yaml, then pnpm install (README: "Apply the patches")` : !existsSync5(entry.file) ? `${entry.source} declares ${key} at ${entry.path}, which does not exist: copy ${copy} there, then pnpm install` : `${entry.source} declares ${key} (${entry.path}); run pnpm install, and if the package is still not patched copy ${copy} over that file (an older copy of the patch does not match this version of the library)`;
    const problems = changed.length > 0 ? changed : differing;
    checks.push({
      group: "patches",
      status: "fail",
      message: changed.length > 0 ? `${key} is not applied: ${spec.does}` : `${key} is patched, but not with this version of the library's patch`,
      details: problems.slice(0, 4).concat(problems.length > 4 ? [`and ${problems.length - 4} more`] : []),
      fix
    });
  }
  return checks;
}
function integration(context, name) {
  const metro = (finding) => {
    const file = finding.file ?? "";
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} uses withSvelteNative` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not mention withSvelteNative (a config that applies it from a file it imports is fine)`, fix: `module.exports = withSvelteNative(getDefaultConfig(__dirname)), with withSvelteNative from require("${name}/metro")` };
    return { group: "build integration", status: "fail", message: "no metro.config.js in the app: Expo's default Metro config does not know the library", fix: `create metro.config.js: module.exports = withSvelteNative(getDefaultConfig(__dirname)), with withSvelteNative from require("${name}/metro")` };
  };
  const plugin = (finding) => {
    const file = finding.file ?? "";
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} lists the ${finding.name ?? `${name}/expo`} plugin` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not name ${name}/expo (a config that builds its plugins in code may add it)`, fix: `plugins: [["${name}/expo", {}]] in the Expo config` };
    if (finding.state === "absent") return { group: "build integration", status: "fail", message: `${file} does not list the ${name}/expo plugin`, fix: `add "${name}/expo" to plugins in ${file}` };
    return { group: "build integration", status: "fail", message: "no app.json or app.config.* in the app", fix: `create an Expo config with plugins: [["${name}/expo", {}]]` };
  };
  return [metro(metroFinding(context.appRoot)), plugin(expoPluginFinding(context.appRoot, name))];
}
function runChecks(context) {
  const own = readJson(join5(context.packageRoot, "package.json")) ?? {};
  const name = text(own.name) ?? "@rasheed/svelte-native";
  const appPackage = readJson(join5(context.appRoot, "package.json"));
  if (!appPackage) {
    return [{ group: "environment", status: "fail", message: `${context.appRoot} has no package.json: this is not an app directory`, fix: "run svelte-native doctor from the app's directory" }];
  }
  const peers = record(own.peerDependencies);
  const optional = new Set(Object.entries(record(own.peerDependenciesMeta)).filter(([, meta]) => record(meta).optional === true).map(([peer]) => peer));
  return [
    ...environment(context),
    svelte(context, peers),
    ...peerDependencies(context, peers, optional),
    ...autolinkedPeers(context, peers, appPackage),
    ...expoRuntime(context),
    ...patches(context, name, optional),
    library(context, name, text(own.version) ?? "?", appPackage),
    ...integration(context, name)
  ];
}
var record, text, EXPO_RUNTIME_FILES, AUTOLINKED_PEERS;
var init_checks = __esm({
  "src/doctor/checks.ts"() {
    "use strict";
    init_declared();
    init_integration();
    init_hunks();
    init_patches();
    init_requirements();
    init_resolve();
    init_semver();
    record = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    text = (value) => typeof value === "string" ? value : void 0;
    EXPO_RUNTIME_FILES = ["src/winter/index.ts", "src/winter/runtime.native.ts"];
    AUTOLINKED_PEERS = ["hermes-intl"];
  }
});

// src/doctor/index.ts
var doctor_exports = {};
__export(doctor_exports, {
  formatReport: () => formatReport,
  nodeVersion: () => nodeVersion,
  pnpmVersion: () => pnpmVersion,
  runChecks: () => runChecks,
  runDoctor: () => runDoctor
});
import { spawnSync } from "node:child_process";
import { resolve as resolve6 } from "node:path";
function formatReport(checks, { color = false, appRoot = "" } = {}) {
  const paint = (status) => color ? `\x1B[${COLORS[status]}m${WORDS[status]}\x1B[0m` : WORDS[status];
  const lines = [`svelte-native doctor${appRoot ? `: ${appRoot}` : ""}`];
  let group;
  for (const check of checks) {
    if (check.group !== group) {
      group = check.group;
      lines.push("", group);
    }
    lines.push(`  ${paint(check.status)}  ${check.message}`);
    for (const detail of check.details ?? []) lines.push(`        ${detail}`);
    if (check.fix && (check.status === "fail" || check.status === "unknown")) lines.push(`        fix: ${check.fix}`);
  }
  const count2 = (status) => checks.filter((check) => check.status === status).length;
  lines.push("", `${count2("pass")} passed, ${count2("fail")} failed, ${count2("unknown")} could not tell, ${count2("skip")} skipped`);
  return `${lines.join("\n")}
`;
}
function nodeVersion() {
  if (!process.versions.bun) return process.versions.node;
  const result = spawnSync("node", ["--version"], { encoding: "utf8", timeout: 15e3, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().replace(/^v/, "") : void 0;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : void 0;
}
function pnpmVersion(directory) {
  const result = spawnSync("pnpm", ["--version"], { cwd: directory, encoding: "utf8", timeout: 6e4, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().split(/\r?\n/).pop() : void 0;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : void 0;
}
function runDoctor(root2, args2, out = process.stdout, context = {}) {
  if (args2.includes("--help") || args2.includes("-h")) {
    out.write(USAGE);
    return 0;
  }
  const unknown = args2.find((arg) => arg !== "--json");
  if (unknown !== void 0) {
    out.write(`Unknown argument ${unknown}

${USAGE}`);
    return 2;
  }
  const appRoot = resolve6(root2);
  const checks = runChecks({
    appRoot,
    packageRoot,
    node: nodeVersion(),
    pnpm: () => pnpmVersion(appRoot),
    ...context
  });
  const failed = checks.some((check) => check.status === "fail");
  if (args2.includes("--json")) out.write(`${JSON.stringify({ ok: !failed, appRoot, checks }, null, 2)}
`);
  else out.write(formatReport(checks, { color: out.isTTY === true && !process.env.NO_COLOR, appRoot }));
  return failed ? 1 : 0;
}
var USAGE, WORDS, COLORS;
var init_doctor = __esm({
  "src/doctor/index.ts"() {
    "use strict";
    init_package_root();
    init_checks();
    init_checks();
    USAGE = `Usage: svelte-native doctor [--json]

Checks, from the app's directory, that the setup the library needs is complete: Node and pnpm, the custom-renderer Svelte, the peer
dependencies, the patches applied to the installed packages, and the app's Metro and Expo configs. One line per check; the exit status is
1 when a required check fails.

  --json   print the checks as JSON instead of text
`;
    WORDS = { pass: "pass", fail: "FAIL", skip: "skip", unknown: "????" };
    COLORS = { pass: "32", fail: "31", skip: "2", unknown: "33" };
  }
});

// src/cli.ts
import { watch as watch2 } from "node:fs";
import { resolve as resolve7 } from "node:path";

// src/build.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { relative, resolve as resolve2, sep as sep2 } from "node:path";

// src/compile-options.ts
init_package_root();
import { sep } from "node:path";
var RUNES_ENVIRONMENT_VARIABLE = "SVELTE_NATIVE_RUNES";
var runesEnvironment = (runes) => runes === void 0 ? {} : { [RUNES_ENVIRONMENT_VARIABLE]: runes ? "1" : "0" };
var ownSources = sourceDirectory + sep;

// src/route-tree.ts
var PAGE = "+mobile.svelte";
var LAYOUT = "+layout.mobile.svelte";
var isGroup = (segment) => segment.startsWith("(");
var pathOf = (directory) => `/${directory.filter((segment) => !isGroup(segment)).join("/")}`;
var staticSegments = (path) => path.split("/").filter((part) => part !== "" && !part.startsWith("[")).length;
function buildTree(files) {
  const pages = /* @__PURE__ */ new Map();
  const layouts = /* @__PURE__ */ new Map();
  files.forEach((file, index) => {
    const directory = file.path.split("/");
    const name = directory.pop();
    const source = { path: file.path, directory, key: directory.join("/"), index, exports: file.exports };
    if (name === PAGE) pages.set(source.key, source);
    else if (name === LAYOUT) layouts.set(source.key, source);
  });
  const everyDirectory = [...pages.values(), ...layouts.values()];
  const prefixes = (directory) => Array.from({ length: directory.length + 1 }, (_, length) => directory.slice(0, length).join("/"));
  const navigators = /* @__PURE__ */ new Map();
  for (const layout of layouts.values()) {
    const navigator = layout.exports.navigator;
    if (!navigator) continue;
    if (layout.key === "") throw new Error(`${layout.path}: the root layout is the app shell and cannot be a navigator`);
    navigators.set(layout.key, { ...layout, navigator });
  }
  for (const layout of navigators.values()) {
    if (layout.navigator === "tabs" && prefixes(layout.directory).slice(0, -1).some((key) => navigators.get(key)?.navigator === "tabs")) {
      throw new Error(`${layout.path}: a tab bar inside a tab bar is not supported`);
    }
  }
  const paneSources = /* @__PURE__ */ new Map();
  const paneDirectories = /* @__PURE__ */ new Set();
  for (const tabs of navigators.values()) {
    if (tabs.navigator !== "tabs") continue;
    const found = /* @__PURE__ */ new Map();
    for (const source of everyDirectory) {
      if (!source.key.startsWith(`${tabs.key}/`)) continue;
      const relative2 = source.directory.slice(tabs.directory.length);
      let groups = 0;
      while (groups < relative2.length && isGroup(relative2[groups])) groups++;
      if (groups === relative2.length) {
        const isPage = pages.get(source.key) === source;
        if (isPage || navigators.has(source.key)) throw new Error(`${source.path}: a ${isPage ? "page" : "navigator layout"} directly under a tabs layout has no pane to show in; move it into a pane directory`);
        continue;
      }
      const key = relative2[groups];
      const directory = tabs.directory.concat(relative2.slice(0, groups + 1));
      const known = found.get(key);
      if (known && known.directory.join("/") !== directory.join("/")) throw new Error(`pane ${key} of ${tabs.key} is defined twice: ${known.directory.join("/")} and ${directory.join("/")}`);
      if (key.startsWith("[")) throw new Error(`${source.path}: a pane is a fixed directory, not a parameter`);
      if (known) known.first = Math.min(known.first, source.index);
      else found.set(key, { key, directory, first: source.index });
    }
    paneSources.set(tabs.key, [...found.values()].sort((a, b) => a.first - b.first));
    for (const pane of found.values()) paneDirectories.add(pane.directory.join("/"));
  }
  for (const layout of navigators.values()) {
    const page = pages.get(layout.key);
    if (page && !paneDirectories.has(layout.key)) {
      throw new Error(`${page.path}: a ${layout.navigator} layout is the screen of its directory; move the page into ${layout.navigator === "tabs" ? "a pane" : "a child directory"}`);
    }
  }
  const contentLayouts = (directory) => prefixes(directory).slice(1).flatMap((key) => {
    const layout = layouts.get(key);
    return layout && !layout.exports.navigator ? [layout.path] : [];
  });
  const root2 = { kind: "stack", id: "", path: "/", routes: [] };
  const rootLayout = layouts.get("");
  if (rootLayout) root2.shellFile = rootLayout.path;
  const stacks = /* @__PURE__ */ new Map([["", root2]]);
  const nodes = /* @__PURE__ */ new Map();
  for (const layout of navigators.values()) {
    if (paneDirectories.has(layout.key)) continue;
    const common = { id: layout.key, path: pathOf(layout.directory), layoutFile: layout.path, layouts: contentLayouts(layout.directory.slice(0, -1)) };
    if (layout.navigator === "stack") {
      const node = { kind: "stack", ...common, routes: [] };
      stacks.set(layout.key, node);
      nodes.set(layout.key, node);
    } else {
      nodes.set(layout.key, { kind: "tabs", ...common, panes: [] });
    }
  }
  for (const [tabsKey, found] of paneSources) {
    const tabs = nodes.get(tabsKey);
    if (tabs?.kind !== "tabs") continue;
    for (const source of found) {
      const key = source.directory.join("/");
      if (!pages.has(key)) throw new Error(`pane ${source.key} of ${tabsKey} has no index page (${PAGE})`);
      const stack = { kind: "stack", id: key, path: pathOf(source.directory), routes: [] };
      const paneLayout = navigators.get(key);
      if (paneLayout) stack.layoutFile = paneLayout.path;
      stacks.set(key, stack);
      tabs.panes.push({ key: source.key, stack });
    }
  }
  const ownerOf = (directory, inclusive) => {
    const keys = prefixes(directory);
    for (let at = keys.length - (inclusive ? 1 : 2); at >= 0; at--) {
      const stack = stacks.get(keys[at]);
      if (stack) return stack;
    }
    return root2;
  };
  const members = /* @__PURE__ */ new Map();
  const add = (stack, route, index) => {
    const list = members.get(stack) ?? [];
    list.push({ route, index });
    members.set(stack, list);
  };
  for (const page of pages.values()) {
    add(ownerOf(page.directory, true), {
      kind: "page",
      id: page.key,
      path: pathOf(page.directory),
      presentation: page.exports.presentation ?? "push",
      file: page.path,
      layouts: contentLayouts(page.directory)
    }, page.index);
  }
  for (const node of nodes.values()) {
    const layout = navigators.get(node.id);
    if (layout) add(ownerOf(layout.directory, false), node, layout.index);
  }
  for (const [stack, list] of members) {
    stack.routes = list.sort((a, b) => staticSegments(b.route.path) - staticSegments(a.route.path) || a.index - b.index).map(({ route }) => route);
    for (const route of stack.routes) {
      if (route.kind === "page") continue;
      const clash = stack.routes.find((other) => other !== route && other.path === route.path);
      if (clash) throw new Error(`${route.layoutFile}: ${route.path} is also the path of ${clash.kind === "page" ? clash.file : clash.layoutFile}; a navigator is a screen of its own`);
    }
  }
  return root2;
}

// src/variant.ts
var DEFAULT_VARIANT = "app";
var variantName = (env = process.env) => env.APP_VARIANT || DEFAULT_VARIANT;
var labIncludedFor = (variant) => variant !== "production";
var routesTableFile = (variant) => `routes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;

// src/build.ts
var require2 = createRequire(import.meta.url);
var posix = (path) => path.split(sep2).join("/");
function exportedLiteral(ast, file, name, values) {
  for (const statement of ast.module?.content.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    const declared = declarations.find((declaration) => declaration.id.type === "Identifier" && declaration.id.name === name);
    const init = declared?.init;
    const literal = init?.type === "Literal" ? values.find((value) => value === init.value) : void 0;
    if (literal !== void 0) return literal;
    const aliased = statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === name);
    if (declared || aliased) throw new Error(`${file}: export \`${name}\` as one of the literals ${values.map((value) => JSON.stringify(value)).join(", ")}; the route table reads it at build time`);
  }
  return void 0;
}
function exportedInInstance(ast, name) {
  return (ast.instance?.content.body ?? []).some((statement) => {
    if (statement.type !== "ExportNamedDeclaration") return false;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    return declarations.some((declaration) => declaration.id.type === "Identifier" && declaration.id.name === name) || statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === name);
  });
}
var PRESENTATIONS = ["push", "modal", "transparentModal", "sheet", "formSheet"];
var NAVIGATORS = ["stack", "tabs"];
var labIncluded = (env = process.env) => labIncludedFor(variantName(env));
var LAB_DIRECTORY = "__dev";
function routeFilesSync(routesRoot, { lab = labIncluded() } = {}) {
  const paths = [];
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve2(directory, item.name);
      if (item.isDirectory()) {
        if (lab || item.name !== LAB_DIRECTORY) walk(path);
      } else paths.push(posix(relative(routesRoot, path)));
    }
  }
  walk(routesRoot);
  const { parse } = require2("svelte/compiler");
  const files = [];
  const labDirectories = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const ast = parse(readFileSync(resolve2(routesRoot, path), "utf8"), { modern: true, filename: path });
    if (exportedInInstance(ast, "lab")) throw new Error(`${path}: export \`lab\` is ignored in the instance script; move \`lab\` to \`<script module>\`, which the route table reads at build time`);
    const labOnly = exportedLiteral(ast, path, "lab", [true]) === true;
    if (labOnly && path === name && name === "+layout.mobile.svelte") throw new Error(`${path}: the root layout is the app shell and cannot be lab-only`);
    const marked = labOnly && !lab;
    if (name === "+mobile.svelte") {
      if (marked) continue;
      const presentation = exportedLiteral(ast, path, "presentation", PRESENTATIONS);
      files.push({ path, exports: presentation ? { presentation } : {} });
    } else {
      if (marked) {
        labDirectories.push(path.slice(0, path.length - name.length));
        continue;
      }
      const navigator = exportedLiteral(ast, path, "navigator", NAVIGATORS);
      files.push({ path, exports: navigator ? { navigator } : {} });
    }
  }
  return labDirectories.length === 0 ? files : files.filter((file) => !labDirectories.some((directory) => file.path.startsWith(directory)));
}
function treeModule(tree, routesRoot, output, variant, lab) {
  const json = (value) => JSON.stringify(value);
  const code = (file) => `require(${json(posix(relative(output, resolve2(routesRoot, file))))}).default`;
  const loader = (file, layouts = []) => `async () => ({ component: ${code(file)}, layouts: [${layouts.map(code).join(", ")}] })`;
  const routeOf = (route, indent) => {
    if (route.kind === "page") {
      const { file = "", layouts = [] } = route;
      return `${indent}{
${indent}  kind: "page", id: ${json(route.id)}, path: ${json(route.path)}, presentation: ${json(route.presentation)},
${indent}  file: ${json(file)}, layouts: ${json(layouts)},
${indent}  load: ${loader(file, layouts)},
${indent}}`;
    }
    return nodeOf(route, indent);
  };
  const nodeOf = (node, indent) => {
    const inner = `${indent}  `;
    const lines = [`kind: ${json(node.kind)}, id: ${json(node.id)}, path: ${json(node.path)},`];
    if (node.layoutFile !== void 0) {
      lines.push(`layoutFile: ${json(node.layoutFile)},${node.layouts ? ` layouts: ${json(node.layouts)},` : ""}`);
      lines.push(`layout: ${loader(node.layoutFile, node.layouts)},`);
    }
    if (node.kind === "stack") {
      if (node.shellFile !== void 0) lines.push(`shellFile: ${json(node.shellFile)},`);
      lines.push(`routes: [
${node.routes.map((route) => `${routeOf(route, `${inner}  `)},`).join("\n")}
${inner}],`);
    } else {
      lines.push(`panes: [
${node.panes.map((pane) => `${inner}  { key: ${json(pane.key)}, stack: ${nodeOf(pane.stack, `${inner}  `).trimStart()} },`).join("\n")}
${inner}],`);
    }
    return `${indent}{
${lines.map((line) => `${inner}${line}`).join("\n")}
${indent}}`;
  };
  return `// Generated by svelte-native sync for the ${variant} app${lab ? "" : " (the development lab's routes are left out)"}.
import type { StackNode } from '@rasheed/svelte-native/router';

export const variant = ${json(variant)};
export const lab = ${lab};
export const tree: StackNode = ${nodeOf(tree, "").trimStart()};
`;
}
function syncRoutes(root2, options = {}) {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = resolve2(root2, "src/routes");
  const output = resolve2(root2, ".svelte-native");
  mkdirSync(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import '@rasheed/svelte-native/init';\nimport '@rasheed/svelte-native/polyfills';\nimport { createFabricApp, remountSurfaces } from '@rasheed/svelte-native/fabric';\n";
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot ? `${prelude}import App from ${JSON.stringify(posix(relative(output, resolve2(root2, customRoot))))};
createFabricApp(App, {});
${hot}` : `${prelude}import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
${hot}`;
  const files = [[routesTableFile(variant), manifest]];
  if (options.entry !== "keep" || customRoot !== void 0 || !existsSync2(resolve2(output, "entry.ts"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) {
    const destination = resolve2(output, file);
    let current = "";
    try {
      current = readFileSync(destination, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== content) writeFileSync(destination, content);
  }
  rmSync(resolve2(output, "routes.ts"), { force: true });
}
async function syncNative(root2, options = {}) {
  syncRoutes(root2, options);
}
function expoEnvironment(args2, extra = {}) {
  const env = { ...process.env, EXPO_NO_TELEMETRY: "1", ...extra };
  if (args2.includes("--localhost")) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim();
  return env;
}
function runExpo(root2, args2, extraEnv = {}) {
  return spawn(process.execPath, [require2.resolve("expo/bin/cli"), ...args2], {
    cwd: root2,
    stdio: "inherit",
    env: expoEnvironment(args2, extraEnv)
  });
}
async function exportNative(root2, platform, options = {}) {
  await syncNative(root2, options);
  const output = resolve2(root2, ".svelte-native/dist", platform);
  await mkdir(output, { recursive: true });
  const child = runExpo(root2, [
    "export:embed",
    "--platform",
    platform,
    "--entry-file",
    ".svelte-native/entry.ts",
    "--bundle-output",
    resolve2(output, "index.hbc"),
    "--sourcemap-output",
    resolve2(output, "index.hbc.map"),
    "--assets-dest",
    resolve2(output, "assets"),
    "--dev",
    "false",
    "--bytecode",
    "--reset-cache"
  ], runesEnvironment(options.runes));
  const result = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", done);
  });
  if (result !== 0) throw new Error(`Native ${platform} export exited with ${result}`);
}

// src/cli.ts
var [command = "dev", ...args] = process.argv.slice(2);
var root = process.cwd();
if (command === "doctor") {
  const { runDoctor: runDoctor2 } = await Promise.resolve().then(() => (init_doctor(), doctor_exports));
  process.exit(runDoctor2(root, args));
}
await syncNative(root);
if (command === "build") {
  const platformIndex = args.indexOf("--platform");
  const platform = platformIndex < 0 ? "android" : args[platformIndex + 1];
  if (platform !== "ios" && platform !== "android") throw new Error("Choose --platform android or ios");
  await exportNative(root, platform);
} else if (command === "android" || command === "ios") {
  const child = runExpo(root, [`run:${command}`, ...args]);
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else if (command === "dev") {
  await syncNative(root);
  let syncing = Promise.resolve();
  const watcher = watch2(resolve7(root, "src/routes"), { recursive: true }, (_event, file) => {
    if (file && /\+(?:mobile|layout\.mobile)\.svelte$/.test(file)) {
      syncing = syncing.then(() => syncNative(root)).catch((error) => {
        console.error(error);
      });
    }
  });
  const child = runExpo(root, ["start", ...args]);
  const stop = () => {
    watcher.close();
    child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("error", (error) => {
    watcher.close();
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    watcher.close();
    process.exitCode = code ?? 1;
  });
} else if (command !== "sync") {
  throw new Error(`Unknown command: ${command}. Use dev, android, ios, build, sync or doctor.`);
}
