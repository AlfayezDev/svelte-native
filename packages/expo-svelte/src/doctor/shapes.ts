import type { Reader } from "./resolve.ts";

/**
 * What the library's patches leave in the packages they patch, read from the installed files: the shape the package's tests pin
 * (`tests/upstream/foreign-native-events.test.ts`, `tests/upstream/expo-modules-core-patch.test.ts`, `tests/upstream/react-native-gesture-handler-patch.test.ts`, `tests/upstream/worklets-frame-loop.test.ts`)
 * and `expo-svelte doctor` reports on in an app: the packages an app installs (`patches/`) and the copies the library carries (`vendor/`, patched by `scripts/vendor.ts`; `vendored: true` in `patches.ts`). Each function takes a `Reader` over one package's directory and returns the problems
 * it finds, so an empty list means the patch is in; none of them reads anything but the files they name.
 */

/** Source without block comments and without lines that are only a `//` comment: the patches comment on what they change, and a marker is code. */
export const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** An Android event class that overrides `canCoalesce()` to false (Java or Kotlin), so React Native's event queue delivers each message. */
export const neverCoalescesPattern = /(?:@Override\s+public boolean canCoalesce\(\)\s*\{\s*return false;\s*\}|override fun canCoalesce\(\): Boolean = false)/;
export const neverCoalesces = (code: string): boolean => neverCoalescesPattern.test(stripComments(code));

type Check = readonly [problem: string, holds: (code: string) => boolean];

/** The problems of one file: it is missing, or one of the checks fails on its text (comments removed unless `raw`: a check that looks for a comment, or in a language whose strings can hold `/*`, reads the file as it is). */
function inFile(read: Reader, path: string, checks: readonly Check[], raw = false): string[] {
  const text = read.read(path);
  if (text === undefined) return [`${path} is not in the package`];
  const code = raw ? text : stripComments(text);
  return checks.filter(([, holds]) => !holds(code)).map(([problem]) => `${path}: ${problem}`);
}

const has = (needle: string) => (code: string) => code.includes(needle);
const count = (needle: string, atLeast: number) => (code: string) => code.split(needle).length - 1 >= atLeast;

// ---- @sveltejs/kit: the route manifest and the warning preprocessors leave `+mobile.svelte` files alone ----

export function kitProblems(read: Reader): string[] {
  return [
    ...inFile(read, "src/core/sync/create_manifest_data/index.js", [["does not skip the +mobile files of a route directory", has("(?:mobile\\.|(?:layout|error)\\.mobile\\.)")]], true),
    ...inFile(read, "src/exports/vite/index.js", [["the `+page`/`+layout` warnings still look at .mobile.svelte files", count("filename.endsWith('.mobile.svelte')", 2)]], true),
  ];
}

// ---- react-native-pdf, react-native-video, lottie-react-native, react-native-maps: Android events that must not coalesce ----

export function pdfProblems(read: Reader): string[] {
  return [
    ...inFile(read, "android/src/main/java/org/wonday/pdf/events/TopChangeEvent.java", [["canCoalesce() is not overridden to return false", neverCoalesces]]),
    // The library carries the package (`vendor/`), so react-native is not found from the package's own place beside it in node_modules but from the app's directory upwards.
    ...inFile(read, "android/build.gradle", [
      ["does not look for react-native in the node_modules above the app's directory", has("reactNativeFromAncestor")],
      ["still looks for react-native beside the package itself", (code) => !code.includes("reactNativeFromNodeModulesWithPDF")],
    ], true),
  ];
}

/**
 * The video library sends every event through one class, so the class decides by a flag the sender gives: a sender that says nothing is a discrete
 * event, and the two streams (progress, bandwidth), whose latest message replaces the earlier ones, say so.
 */
export function videoEmitterProblems(emitter: string): string[] {
  const code = stripComments(emitter);
  const custom = /private class VideoCustomEvent\([\s\S]*?\n {4}\}\n/.exec(code)?.[0] ?? "";
  const problems: string[] = [];
  if (!/private val coalescable: Boolean/.test(custom)) problems.push("VideoCustomEvent has no coalescable flag");
  if (!/override fun canCoalesce\(\): Boolean = coalescable/.test(custom)) problems.push("VideoCustomEvent.canCoalesce() does not answer with the flag");
  if (!/fun dispatch\(event: EventTypes, coalescable: Boolean = false, paramsSetter/.test(code)) problems.push("dispatch() does not default to an event that cannot coalesce");
  if (code.match(/: Event</g)?.length !== 1) problems.push("the emitter no longer has exactly one Event class");
  const streams = [...code.matchAll(/event\.dispatch\(EventTypes\.(\w+), coalescable = true\)/g)].map((match) => match[1]).sort();
  if (streams.join(",") !== "EVENT_BANDWIDTH,EVENT_PROGRESS") problems.push(`the events that may coalesce are ${streams.join(", ") || "none"}, not EVENT_BANDWIDTH and EVENT_PROGRESS`);
  return problems;
}

export function videoProblems(read: Reader): string[] {
  const path = "android/src/main/java/com/brentvatne/common/react/VideoEventEmitter.kt";
  const emitter = read.read(path);
  return emitter === undefined ? [`${path} is not in the package`] : videoEmitterProblems(emitter).map((problem) => `${path}: ${problem}`);
}

/** The map's streams (a position or a region per frame of a drag, a pan, a camera move or a GPS fix) keep coalescing: the latest message replaces the earlier ones. */
export const mapsStreamEvents: readonly string[] = ["OnDragEvent", "OnMarkerDragEvent", "OnPanDragEvent", "OnRegionChangeEvent", "OnUserLocationChangeEvent"];

/** Every other event class of the map is one message per user act, state change or load, and does not coalesce. */
export function mapsProblems(read: Reader): string[] {
  const directory = "android/src/main/java/com/rnmaps/fabric/event";
  const files = read.list(directory).filter((file) => file.endsWith(".java"));
  if (files.length === 0) return [`${directory} is not in the package`];
  const problems: string[] = [];
  for (const file of files) {
    const stream = mapsStreamEvents.includes(file.slice(0, -".java".length));
    problems.push(...inFile(read, `${directory}/${file}`, [stream ? ["a stream event no longer coalesces", (code) => !code.includes("canCoalesce")] : ["canCoalesce() is not overridden to return false", neverCoalesces]]));
  }
  problems.push(...inFile(read, "plugin/build/ios.js", [["the Podfile line of its iOS plugin looks for an installed react-native-maps, not the library's copy", has("require.resolve(\\'expo-svelte/package.json\\')")]], true));
  return problems;
}

export function lottieProblems(read: Reader): string[] {
  const directory = "android/src/main/java/com/airbnb/android/react/lottie";
  const events = read.list(directory).filter((file) => /^On\w+Event\.kt$/.test(file));
  const android = events.length === 0 ? [`${directory} has no event classes`] : events.flatMap((file) => inFile(read, `${directory}/${file}`, [["canCoalesce() is not overridden to return false", neverCoalesces]]));
  // iOS: a loaded or failure event raised before the view has its emitter is kept for it instead of being dropped.
  const ios = inFile(read, "ios/Fabric/LottieAnimationViewComponentView.mm", [["does not keep events until the view has its emitter", (code) => code.includes("_eventsBeforeEmitter") && code.includes("lottieSendEvent:")]]);
  return [...android, ...ios];
}

// ---- react-native-gesture-handler: the manager the iOS screens ask to register the root recognizer, and the podspec that finds the Worklets copy ----

/** The declarations the patch adds to the manager, as whole source lines (`tests/upstream/react-native-gesture-handler-patch.test.ts` looks for the same lines in the patch file). */
export const rnghAdditions: Record<string, readonly string[]> = {
  "apple/RNGestureHandlerManager.h": ["+ (nullable RNGestureHandlerManager *)currentManager;", "- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view;"],
  "apple/RNGestureHandlerManager.mm": ["+ (nullable RNGestureHandlerManager *)currentManager\n{", "- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view\n{"],
};

/** Where the implementation uses them: the walk to the root view stops at a view that holds a touch handler, and the registration reuses the library's own. */
export const rnghUses = ["RNGHViewHasSurfaceTouchHandler(touchHandlerView)"] as const;
export const rnghRegistration = /\[self registerViewWithGestureRecognizerAttachedIfNeeded:view\];/;

/** The podspec's helper looks for the Worklets copy beside the package before it asks Node (`0002-worklets-is-the-copy-beside-it.patch`): the pod links Worklets, and gesture handler 3's state manager works on the UI runtime, only when it finds one. */
export const rnghWorkletsLookup = "File.expand_path('../../react-native-worklets', __dir__)";

export function rnghProblems(read: Reader): string[] {
  return [
    ...inFile(read, "scripts/gesture_handler_utils.rb", [["does not look for the Worklets copy beside the package", has(rnghWorkletsLookup)]], true),
    ...rnghManagerProblems(read),
  ];
}

function rnghManagerProblems(read: Reader): string[] {
  return Object.entries(rnghAdditions).flatMap(([path, lines]) =>
    inFile(read, path, [
      ...lines.map((line): Check => [`does not have \`${line.split("\n")[0]}\``, has(line)]),
      ...(path.endsWith(".mm")
        ? [
            ...rnghUses.map((use): Check => [`does not use \`${use}\``, has(use)]),
            ["does not register through the library's own registerViewWithGestureRecognizerAttachedIfNeeded:", (code: string) => rnghRegistration.test(code)] as Check,
          ]
        : []),
    ], true));
}

// ---- react-native-reanimated: the sink and the engine hook of the Android views ----

export function reanimatedProblems(read: Reader): string[] {
  const base = "android/src/main";
  return [
    ...inFile(read, `${base}/java/com/swmansion/reanimated/SvelteEngineHook.kt`, [["has no `updater` hook", has("var updater")]]),
    ...inFile(read, `${base}/java/com/swmansion/reanimated/NativeProxy.kt`, [
      ["does not offer the engine's hook before React Native's prop dispatch", has("SvelteEngineHook.updater?.invoke(viewTag, props)")],
      ["has no direct path for opacity and translate/scale transforms", has("private fun applySimpleProps(")],
    ]),
    ...inFile(read, `${base}/cpp/reanimated/android/NativeProxy.cpp`, [["does not export reanimatedSetSynchronousPropsSink", has("reanimatedSetSynchronousPropsSink")], ["does not call the sink", has("synchronousPropsSink.load")]]),
    ...inFile(read, `${base}/cpp/reanimated/android/NativeProxy.h`, [["does not declare SynchronousPropsSink", has("SynchronousPropsSink")], ["does not keep the sink's rest buffers", has("sinkRestInts_")]]),
    // The Gradle task and the podspec's script find Worklets by this path (`vendor/react-native-worklets`, beside the copy of Reanimated): by name it is not a package of the app.
    ...inFile(read, "scripts/validate-worklets-version.js", [["still looks for react-native-worklets by name", has("require('../../react-native-worklets/package.json')")]], true),
    // The patched Android update (the sink above) is reached only through the synchronous update this flag turns on, which an app no longer sets itself.
    ...inFile(read, "src/featureFlags/staticFlags.json", [["has the synchronous Android update off by default", has('"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true')]], true),
  ];
}

// ---- react-native-worklets: the UI runtime asks for a frame only while something waits for one ----

export function workletsProblems(read: Reader): string[] {
  const check = (path: string) => inFile(read, path, [
    ["does not request a native frame on demand", (code) => code.includes("let frameRequested = false;") && code.includes("function requestFrame()")],
    ["still starts the per-frame loop", (code) => !code.includes("/* Start the loop */") && code.split("__nativeRequestAnimationFrame(").length - 1 === 1],
  ], true);
  return [...check("lib/module/runLoop/uiRuntime/requestAnimationFrame.js"), ...check("src/runLoop/uiRuntime/requestAnimationFrame.ts")];
}

// ---- expo-modules-core: the lazy module registry ----

/** The lines a patch adds to one of the files it changes, without the diff markers. */
export function addedLines(patch: string, file: string): string {
  const start = patch.indexOf(`diff --git a/${file}`);
  if (start < 0) return "";
  const end = patch.indexOf("diff --git", start + 1);
  return patch
    .slice(start, end < 0 ? undefined : end)
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function block(source: string, header: RegExp): string {
  const match = header.exec(source);
  if (!match) throw new Error(`${header} not found in the registry`);
  const rest = source.slice(match.index + match[0].length);
  return rest.slice(0, rest.search(/^\s*\)\s*$/m));
}

export const strings = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");

export const moduleRegistryPath = "android/src/main/java/expo/modules/kotlin/ModuleRegistry.kt";

/** The modules the patch's `ModuleRegistry.kt` defers (class to name), prewarms, creates before the startup round, and builds without their JavaScript object. */
export function lazyRegistry(patch: string) {
  const registry = addedLines(patch, moduleRegistryPath);
  return {
    lazyEntries: [...block(registry, /LAZY_MODULE_NAMES = mapOf\(/).matchAll(/"([\w.]+)" to "(\w+)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""] as const),
    prewarm: strings(block(registry, /PREWARM_MODULE_NAMES = listOf\(/)),
    startup: strings(/STARTUP_MODULE_NAMES = listOf\(([^)]*)\)/.exec(registry)?.[1] ?? ""),
    definitionOnly: strings(/DEFINITION_ONLY_MODULE_NAMES = setOf\(([^)]*)\)/.exec(registry)?.[1] ?? ""),
  };
}

/** The native view adapter loads React Native's component registry on its first view, not when it is imported. */
export function adapterLoadsRegistryLazily(source: string): boolean {
  return !/^import .*NativeComponentRegistry/m.test(source) && /require\('react-native\/Libraries\/NativeComponent\/NativeComponentRegistry'\)/.test(source);
}

/** The installed expo-modules-core carries the patch: the registry lists every module the patch defers, and the proxy and the adapter have their changes. */
export function expoModulesCoreProblems(read: Reader, patch: string): string[] {
  const { lazyEntries, prewarm, startup } = lazyRegistry(patch);
  return [
    ...inFile(read, moduleRegistryPath, [
      ["does not list the lazy modules the patch defines", (text) => lazyEntries.length > 10 && lazyEntries.every(([className, name]) => text.includes(`"${className}" to "${name}"`))],
      ["does not name the prewarmed and startup modules the patch defines", (text) => [...prewarm, ...startup].every((name) => text.includes(`"${name}"`))],
    ], true),
    ...inFile(read, "android/src/main/java/expo/modules/adapters/react/NativeModulesProxy.java", [["cannot build the interop registry in the background", has("startInteropInBackground")]], true),
    ...inFile(read, "src/NativeViewManagerAdapter.native.tsx", [["imports the native component registry when it loads", adapterLoadsRegistryLazily]], true),
  ];
}

/** react-native-blob-util's Gradle file names AGP's default Proguard file that AGP 9 (React Native 0.88, Expo SDK 58) refuses: it carries `-dontoptimize`, so the optimizing one is named. */
export function blobUtilProblems(read: Reader): string[] {
  return inFile(read, "android/build.gradle", [
    ["still names `proguard-android.txt`, which AGP 9 refuses", (code) => !code.includes("getDefaultProguardFile('proguard-android.txt')")],
    ["does not name `proguard-android-optimize.txt`", has("getDefaultProguardFile('proguard-android-optimize.txt')")],
  ], true);
}

export function nitroProblems(read: Reader): string[] {
  return inFile(read, "ios/turbomodule/NativeNitroModules+NewArch.mm", [
    ["has no `installJSIBindingsWithRuntime:callInvoker:`, the only overload React Native 0.87 and later call", has("installJSIBindingsWithRuntime:(jsi::Runtime&)runtime callInvoker:")],
  ], true);
}

export function quickBase64Problems(read: Reader): string[] {
  return inFile(read, "ios/QuickBase64Module.mm", [
    ["still casts the bridge to `RCTCxxBridge`, which React Native 0.88 removed", (code) => !code.includes("(RCTCxxBridge *)")],
    ["does not ask the bridge for its runtime", has("[(id<QuickBase64RuntimeOwner>)_bridge runtime]")],
  ], true);
}

export function riveProblems(read: Reader): string[] {
  return inFile(read, "android/src/main/java/com/rivereactnative/RiveReactNativeView.kt", [
    ["an event still goes through the old architecture's event emitter (a soft exception for every event in a bridgeless app)", (code) => !code.includes("RCTEventEmitter")],
    ["the view's events are not sent through the event dispatcher", (code) => code.includes("getEventDispatcherForReactTag")],
  ]);
}
