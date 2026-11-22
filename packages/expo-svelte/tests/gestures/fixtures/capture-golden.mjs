/**
 * Captures what react-native-gesture-handler's own detector code sends to its native module for a set of gesture objects:
 * `createGestureHandler`, `attachGestureHandler`, `setGestureHandlerConfig` and `configureRelations` (RNGH 3 sends a handler's config and its
 * relation arrays as two calls), `dropGestureHandler` and `flushOperations`, in order. The files in `golden/` are the expected output of the Svelte detector (SPEC.md,
 * "Gestures (react-native-gesture-handler)", "Test plan"); regenerate them with `node tests/gestures/fixtures/capture-golden.mjs`
 * after upgrading the package and read the diff: it is what the native side will see differently.
 *
 * RNGH's `GestureDetector/*` files import React components and `react-native`, so they are bundled with esbuild against a
 * stub of `react-native` whose `TurboModuleRegistry` returns the recorder. Nothing here runs in the app.
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// The library's copy of react-native-gesture-handler (`vendor/`, VENDORING.md), which is what Metro bundles; the app has no package of that name.
const vendored = resolve(here, "../../../vendor/react-native-gesture-handler");
const root = join(vendored, "src");
const version = require(join(vendored, "package.json")).version;

const reactNative = `
export const Platform = { OS: 'android', Version: 34, select: (o) => o.android ?? o.default };
export const UIManager = {};
export const DeviceEventEmitter = { addListener: () => ({ remove() {} }) };
export const findNodeHandle = (n) => n?.__tag ?? null;
export const StyleSheet = { create: (s) => s, hairlineWidth: 1, flatten: (s) => s, absoluteFill: {} };
export const View = function View() {};
export const Animated = { event: () => () => {}, View: function () {}, Value: function () {} };
export const processColor = (c) => c;
export const AccessibilityInfo = { isScreenReaderEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove() {} }) };
export const I18nManager = { isRTL: false };
export const NativeModules = {};
export const TouchableNativeFeedback = function () {};
export const FlatList = function () {};
const record = (name) => (...args) => globalThis.__calls.push([name, ...args]);
export const TurboModuleRegistry = { getEnforcing: () => ({
  createGestureHandler: record('createGestureHandler'), attachGestureHandler: record('attachGestureHandler'),
  setGestureHandlerConfig: record('setGestureHandlerConfig'), updateGestureHandlerConfig: record('updateGestureHandlerConfig'),
  configureRelations: record('configureRelations'), dropGestureHandler: record('dropGestureHandler'),
  flushOperations: record('flushOperations'), installUIRuntimeBindings: () => true,
}) };
`;

const entry = `
import { GestureObjects as Gesture } from ${JSON.stringify(`${root}/handlers/gestures/gestureObjects`)};
import { attachHandlers } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/attachHandlers`)};
import { updateHandlers } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/updateHandlers`)};
import { dropHandlers } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/dropHandlers`)};
const g = globalThis;
g.RN$Bridgeless = true; // the app is bridgeless: RNGH's remote-debugging check (which turns worklets off) reads this
g.__calls = [];
const worklet = (f) => { f.__workletHash = 1; return f; };
const js = () => {};
const settle = () => new Promise((r) => setTimeout(r, 20));
const fresh = () => ({ attachedGestures: [], animatedEventHandler: null, animatedHandlers: null, shouldUseReanimated: false, isMounted: true });
const take = () => { const calls = JSON.parse(JSON.stringify(g.__calls)); g.__calls.length = 0; return calls; };
const attach = (prepared, gesture, viewTag) => attachHandlers({ preparedGesture: prepared, gestureConfig: gesture, gesturesToAttach: gesture.toGestureArray(), viewTag, webEventHandlersRef: null });

async function single(name, make, viewTag = 42) {
  const gesture = make();
  const prepared = fresh();
  attach(prepared, gesture, viewTag);
  await settle();
  const attachCalls = take();
  dropHandlers(prepared);
  await settle();
  return { name, attach: attachCalls, drop: take() };
}
export async function run() {
  const out = [];
  out.push(await single("pan-js-offsets", () => Gesture.Pan().onUpdate(js).activeOffsetX([-10, 10]).failOffsetY([-10, 10]).minPointers(1).maxPointers(2)));
  out.push(await single("pan-worklet", () => Gesture.Pan().onStart(worklet(js)).onUpdate(worklet(js)).onEnd(worklet(js))));
  out.push(await single("pan-no-callbacks-counts-as-worklet", () => Gesture.Pan()));
  out.push(await single("pan-mixed-runOnJS", () => Gesture.Pan().runOnJS(true).onUpdate(worklet(js)).onEnd(js).hitSlop({ left: -20 }).enabled(false).shouldCancelWhenOutside(true).manualActivation(true)));
  out.push(await single("hitslop-number", () => Gesture.Tap().hitSlop(12).onEnd(js)));
  out.push(await single("simultaneous-pan-pinch-rotation", () => Gesture.Simultaneous(Gesture.Pan().onUpdate(js), Gesture.Pinch().onUpdate(js), Gesture.Rotation().onUpdate(js))));
  out.push(await single("exclusive-doubletap-singletap", () => Gesture.Exclusive(Gesture.Tap().numberOfTaps(2).onEnd(js), Gesture.Tap().onEnd(js))));
  out.push(await single("race-longpress-tap", () => Gesture.Race(Gesture.LongPress().minDuration(300).maxDistance(10).onStart(js), Gesture.Tap().maxDuration(250).onEnd(js))));
  out.push(await single("fling-direction", () => Gesture.Fling().direction(3).numberOfPointers(1).onEnd(js)));
  out.push(await single("manual-touches", () => Gesture.Manual().onTouchesDown(js).onTouchesMove(js)));
  {
    // The external gesture is attached by another detector first, then the pan that names it.
    const scroll = Gesture.Native().disallowInterruption(true).shouldActivateOnStart(false);
    const pan = Gesture.Pan().onUpdate(js).simultaneousWithExternalGesture(scroll).requireExternalGestureToFail(scroll).blocksExternalGesture(scroll);
    const first = fresh(); const second = fresh();
    attach(first, scroll, 100);
    attach(second, pan, 42);
    await settle();
    out.push({ name: "external-relations-native-then-pan", attach: take(), drop: [] });
  }
  {
    // The same detector given a new gesture object of the same shape: the handler keeps its tag and only its config is sent.
    const prepared = fresh();
    const gesture = Gesture.Pan().onUpdate(js).enabled(true);
    attach(prepared, gesture, 42);
    await settle();
    const attachCalls = take();
    const next = Gesture.Pan().onUpdate(js).enabled(false).minDistance(4);
    updateHandlers(prepared, next, next.toGestureArray());
    await settle();
    out.push({ name: "update-same-shape", attach: attachCalls, update: take(), drop: [] });
  }
  return out;
}
`;

const directory = await mkdtemp(join(tmpdir(), "expo-svelte-gestures-golden-"));
try {
  await writeFile(join(directory, "entry.ts"), entry);
  await build({
    entryPoints: [join(directory, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile: join(directory, "out.mjs"), logLevel: "warning",
    define: { __DEV__: "true" },
    absWorkingDir: root,
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^react-native$/ }, () => ({ path: "react-native", namespace: "stub" }));
      b.onResolve({ filter: /^react-native\// }, (a) => ({ path: a.path, namespace: "stub-sub" }));
      // RNGH 3 requires Worklets as well as Reanimated, each inside a try: a package that throws is one that is not installed.
      b.onResolve({ filter: /^react-native-(?:reanimated|worklets)$/ }, (a) => ({ path: a.path, namespace: "no-reanimated" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: reactNative, loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "stub-sub" }, () => ({ contents: "export default function () {}; export const customDirectEventTypes = {};", loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "no-reanimated" }, (a) => ({ contents: `throw new Error('${a.path} is not available in the capture');`, loader: "js" }));
    } }],
  });
  const { run } = await import(pathToFileURL(join(directory, "out.mjs")).href);
  const vectors = await run();
  const target = resolve(here, "golden", `rngh-${version}-native-calls.json`);
  await mkdir(dirname(target), { recursive: true });
  // One native call per line, so a diff of the file reads as a diff of the calls.
  const calls = (list) => `[\n${list.map((call) => `      ${JSON.stringify(call)}`).join(",\n")}\n    ]`;
  const body = vectors.map((vector) => {
    const { name, ...phases } = vector;
    const lines = Object.entries(phases).map(([phase, list]) => `    ${JSON.stringify(phase)}: ${list.length ? calls(list) : "[]"}`);
    return `  {\n    "name": ${JSON.stringify(name)},\n${lines.join(",\n")}\n  }`;
  });
  await writeFile(target, `{\n  "package": "react-native-gesture-handler",\n  "version": ${JSON.stringify(version)},\n  "vectors": [\n${body.join(",\n")}\n  ]\n}\n`);
  console.log(`wrote ${vectors.length} vectors to ${target}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
