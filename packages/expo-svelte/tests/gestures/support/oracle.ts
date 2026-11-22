/**
 * react-native-gesture-handler's own detector code as an oracle: the modules the Svelte host replaces (`GestureDetector/utils`,
 * `needsToReattach`, `handlers/utils`, `eventReceiver`), bundled against the same `react-native` stub `fixtures/capture-golden.mjs` uses,
 * with their own copy of RNGH's registries and builders. A test feeds the oracle and the Svelte host the same input and compares.
 */
import { build } from "esbuild";
import { afterAll, beforeAll } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluate } from "../../support/bundle.ts";
import { snapshotGlobals } from "../../support/globals.ts";
import { vendored } from "../../support/paths.ts";

const root = join(vendored("react-native-gesture-handler"), "src");

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
export const TurboModuleRegistry = { getEnforcing: () => ({ createGestureHandler() {}, attachGestureHandler() {}, setGestureHandlerConfig() {}, updateGestureHandlerConfig() {}, configureRelations() {}, dropGestureHandler() {}, flushOperations() {}, installUIRuntimeBindings: () => true }) };
`;

const entry = `
export { onGestureHandlerEvent } from ${JSON.stringify(`${root}/handlers/gestures/eventReceiver`)};
export { GestureObjects } from ${JSON.stringify(`${root}/handlers/gestures/gestureObjects`)};
export { registerHandler, unregisterHandler, findHandler } from ${JSON.stringify(`${root}/handlers/handlersRegistry`)};
export { ALLOWED_PROPS, extractGestureRelations } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/utils`)};
export { needsToReattach } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/needsToReattach`)};
export { filterConfig } from ${JSON.stringify(`${root}/handlers/utils`)};
export { CallbackType } from ${JSON.stringify(`${root}/CallbackType`)};
export { State } from ${JSON.stringify(`${root}/State`)};
export { TouchEventType } from ${JSON.stringify(`${root}/TouchEventType`)};
`;

export type Oracle = {
  onGestureHandlerEvent(event: object): void;
  GestureObjects: typeof import("../../src/gestures/rngh.js").GestureObjects;
  registerHandler(tag: number, handler: unknown, testId?: string): void;
  unregisterHandler(tag: number, testId?: string): void;
  ALLOWED_PROPS: string[];
  extractGestureRelations(gesture: unknown): { waitFor: number[]; simultaneousHandlers: number[]; blocksHandlers: number[] };
  needsToReattach(prepared: { attachedGestures: unknown[] }, next: unknown[]): boolean;
  filterConfig(props: Record<string, unknown>, valid: readonly string[], defaults?: Record<string, unknown>): Record<string, unknown>;
  CallbackType: Record<string, number>;
  State: Record<string, number>;
  TouchEventType: Record<string, number>;
};

/** RNGH's modules bundled once per run: building them is most of the oracle's cost, and each file that uses it evaluates the text afresh. */
let built: Promise<string> | undefined;
async function bundleOracle(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "expo-svelte-gestures-oracle-"));
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
        b.onLoad({ filter: /.*/, namespace: "no-reanimated" }, (a) => ({ contents: `throw new Error('${a.path} is not available in the oracle');`, loader: "js" }));
      } }],
    });
    return await readFile(join(directory, "out.mjs"), "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A fresh evaluation of the oracle. RNGH's modules read `global.RN$Bridgeless` (its remote-debugging check, which turns worklets off) when they run, so it is set for as long as the oracle is used. */
export async function loadOracle(): Promise<Oracle> {
  (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless = true;
  built ??= bundleOracle();
  return evaluate<Oracle>(await built);
}

/**
 * The oracle for the tests of a file: loaded before the first and put away, with the global it sets, after the last. Call it at the top level of the file; the function it returns is
 * the oracle once the tests run.
 */
export function gestureOracle(): () => Oracle {
  let oracle: Oracle | undefined;
  let snapshot: ReturnType<typeof snapshotGlobals> | undefined;
  beforeAll(async () => {
    snapshot = snapshotGlobals();
    oracle = await loadOracle();
  });
  afterAll(() => snapshot?.restore());
  return () => oracle as Oracle;
}
