/**
 * react-native-gesture-handler's own detector code as an oracle: the modules the Svelte host replaces (`GestureDetector/utils`,
 * `needsToReattach`, `handlers/utils`, `eventReceiver`), bundled against the same `react-native` stub `capture-golden.mjs` uses,
 * with their own copy of RNGH's registries and builders. A test feeds the oracle and the Svelte host the same input and compares.
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(require.resolve("react-native-gesture-handler/package.json")), "src");

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
export const TurboModuleRegistry = { getEnforcing: () => ({ createGestureHandler() {}, attachGestureHandler() {}, updateGestureHandler() {}, dropGestureHandler() {}, flushOperations() {}, install: () => true }) };
`;

const entry = `
export { onGestureHandlerEvent } from ${JSON.stringify(`${root}/handlers/gestures/eventReceiver`)};
export { GestureObjects } from ${JSON.stringify(`${root}/handlers/gestures/gestureObjects`)};
export { registerHandler, unregisterHandler, findHandler } from ${JSON.stringify(`${root}/handlers/handlersRegistry`)};
export { ALLOWED_PROPS, extractGestureRelations } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/utils`)};
export { needsToReattach } from ${JSON.stringify(`${root}/handlers/gestures/GestureDetector/needsToReattach`)};
export { filterConfig } from ${JSON.stringify(`${root}/handlers/utils`)};
export { CALLBACK_TYPE } from ${JSON.stringify(`${root}/handlers/gestures/gesture`)};
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
  CALLBACK_TYPE: Record<string, number>;
  State: Record<string, number>;
  TouchEventType: Record<string, number>;
};

export async function loadOracle(): Promise<Oracle> {
  const directory = await mkdtemp(join(tmpdir(), "svelte-native-gestures-oracle-"));
  try {
    await writeFile(join(directory, "entry.ts"), entry);
    const globals = globalThis as { RN$Bridgeless?: boolean };
    globals.RN$Bridgeless = true; // RNGH's remote-debugging check, which turns worklets off, reads this
    await build({
      entryPoints: [join(directory, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile: join(directory, "out.mjs"), logLevel: "warning",
      define: { __DEV__: "true" },
      absWorkingDir: root,
      plugins: [{ name: "stubs", setup(b) {
        b.onResolve({ filter: /^react-native$/ }, () => ({ path: "react-native", namespace: "stub" }));
        b.onResolve({ filter: /^react-native\// }, (a) => ({ path: a.path, namespace: "stub-sub" }));
        b.onResolve({ filter: /^react-native-reanimated$/ }, () => ({ path: "react-native-reanimated", namespace: "no-reanimated" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: reactNative, loader: "js" }));
        b.onLoad({ filter: /.*/, namespace: "stub-sub" }, () => ({ contents: "export default function () {}; export const customDirectEventTypes = {};", loader: "js" }));
        b.onLoad({ filter: /.*/, namespace: "no-reanimated" }, () => ({ contents: "throw new Error('react-native-reanimated is not available in the oracle');", loader: "js" }));
      } }],
    });
    return await import(`${pathToFileURL(join(directory, "out.mjs")).href}?${Math.random()}`) as Oracle;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
