import { load as loadBundle } from "../../support/bundle.ts";
import { snapshotGlobals } from "../../support/globals.ts";

/**
 * A device for `window.matchMedia`: the library's own code bundled against stand-ins for the React Native modules it reads (`Dimensions`, `Appearance`, `Platform` and `AccessibilityInfo`), which a
 * test drives through `world` (the window's size, the scheme, the settings the system answers, and the events it sends). The stand-ins count what they are asked, what is listening to them and
 * what was added and removed, so a test can say what the system saw. `load()` evaluates the bundle afresh: its module state (the answers it remembers, the lists it made) is new.
 */
export type World = {
  window: { width: number; height: number; scale: number; fontScale: number };
  scheme: "light" | "dark" | null;
  os: "android" | "ios";
  /** What the system answers when it is asked about an accessibility setting. */
  settings: { motion: boolean; contrast: boolean; inverted: boolean; transparency: boolean };
  /** The questions the system has been asked and has not answered: `answer()` answers them. */
  questions: { name: "motion" | "contrast" | "inverted" | "transparency"; respond: (value: boolean) => void; fail: (error: Error) => void }[];
  asked: { motion: number; contrast: number; inverted: number; transparency: number };
  /** Reads of the window's size and of the scheme. */
  reads: { dimensions: number; appearance: number };
  listeners: Record<"dimensions" | "appearance" | "reduceMotionChanged" | "highTextContrastChanged" | "darkerSystemColorsChanged" | "invertColorsChanged" | "reduceTransparencyChanged", Set<(...args: never[]) => void>>;
  added: number;
  removed: number;
  /** How many times `match-media.ts` was evaluated: it is loaded when `matchMedia` is first called. */
  loaded: number;
  subscribe(name: keyof World["listeners"], listener: (...args: never[]) => void): { remove(): void };
};

const scope = globalThis as unknown as { __mediaWorld?: World };

export function resetWorld(): World {
  const world: World = {
    window: { width: 411, height: 891, scale: 2.625, fontScale: 1 },
    scheme: "light",
    os: "android",
    settings: { motion: false, contrast: false, inverted: false, transparency: false },
    questions: [],
    asked: { motion: 0, contrast: 0, inverted: 0, transparency: 0 },
    reads: { dimensions: 0, appearance: 0 },
    listeners: { dimensions: new Set(), appearance: new Set(), reduceMotionChanged: new Set(), highTextContrastChanged: new Set(), darkerSystemColorsChanged: new Set(), invertColorsChanged: new Set(), reduceTransparencyChanged: new Set() },
    added: 0,
    removed: 0,
    loaded: 0,
    subscribe(name, listener) {
      world.added++;
      world.listeners[name].add(listener);
      return { remove() { world.removed++; world.listeners[name].delete(listener); } };
    },
  };
  scope.__mediaWorld = world;
  return world;
}

/** The size changes: the system tells `Dimensions`' listeners. */
export function resize(world: World, window: Partial<World["window"]>): void {
  world.window = { ...world.window, ...window };
  for (const listener of [...world.listeners.dimensions]) listener();
}

/** The user switches the scheme. */
export function switchScheme(world: World, scheme: World["scheme"]): void {
  world.scheme = scheme;
  for (const listener of [...world.listeners.appearance]) (listener as (preferences: { colorScheme: World["scheme"] }) => void)({ colorScheme: scheme });
}

/** The system sends the change event of an accessibility setting. */
export function setting(world: World, name: "reduceMotionChanged" | "highTextContrastChanged" | "darkerSystemColorsChanged" | "invertColorsChanged" | "reduceTransparencyChanged", value: boolean): void {
  for (const listener of [...world.listeners[name]]) (listener as (value: boolean) => void)(value);
}

/** The system answers every question asked of it so far, with its settings as they are now. */
export function answer(world: World): void {
  for (const question of world.questions.splice(0)) question.respond(world.settings[question.name]);
}

/** Lets every promise that is ready settle. */
export const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
};

const dimensionsModule = `const world = () => globalThis.__mediaWorld;
export default {
  get: (which) => { world().reads.dimensions++; return which === "screen" ? { ...world().window, height: world().window.height + 48 } : world().window; },
  addEventListener: (type, listener) => {
    if (type !== "change") throw new Error("unexpected event " + type);
    return world().subscribe("dimensions", listener);
  },
};`;
const appearanceModule = `const world = () => globalThis.__mediaWorld;
export const getColorScheme = () => { world().reads.appearance++; return world().scheme; };
export const addChangeListener = (listener) => world().subscribe("appearance", listener);`;
const platformModule = "export default { get OS() { return globalThis.__mediaWorld.os; } };";
const accessibilityModule = `const world = () => globalThis.__mediaWorld;
const ask = (name) => { world().asked[name]++; return new Promise((respond, fail) => { world().questions.push({ name, respond, fail }); }); };
export default {
  isReduceMotionEnabled: () => ask("motion"),
  isHighTextContrastEnabled: () => ask("contrast"),
  isDarkerSystemColorsEnabled: () => ask("contrast"),
  isInvertColorsEnabled: () => ask("inverted"),
  isReduceTransparencyEnabled: () => ask("transparency"),
  addEventListener: (name, handler) => {
    if (!Object.hasOwn(world().listeners, name)) return { remove() {} };
    return world().subscribe(name, handler);
  },
};`;

const stubs: Record<string, string> = {
  "react-native/Libraries/Utilities/Dimensions": dimensionsModule,
  "react-native/Libraries/Utilities/Appearance": appearanceModule,
  "react-native/Libraries/Utilities/Platform": platformModule,
  "react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo": accessibilityModule,
  "react-native/Libraries/AppState/AppState": "export default { addEventListener: () => ({ remove() {} }) };",
  // What polyfills.ts loads besides `matchMedia` is not under test (the libraries behind `crypto` and `localStorage` are required when those are first read).
  "expo/src/winter": "export {};",
  "hermes-intl": "export {};",
};

/**
 * Evaluates the bundle of `entry` (the source of a module that imports what it needs; its imports resolve from `tests/`) with Svelte's `browser` build and the stand-ins above, with module
 * state of its own. The bundle is built once per entry (`support/bundle.ts`). A bundle evaluates a module it `require`s when the `require` runs: `world.loaded` counts when `match-media.ts` was.
 */
export function load<T = Record<string, unknown>>(entry: string): Promise<T> {
  return loadBundle<T>({
    entry, stubs, converters: false, esbuild: { mainFields: [] },
    patches: [{ file: "src/match-media\\.ts$", prepend: "globalThis.__mediaWorld.loaded++;\n" }],
  });
}

/** What a test file puts on the global object for the bundle, and takes off again: React Native's `window` is the global object, and it has no `matchMedia`. */
export function hostGlobals() {
  const snapshot = snapshotGlobals();
  return {
    install(): World {
      delete (globalThis as Record<string, unknown>).matchMedia;
      Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true, writable: true });
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 1);
      return resetWorld();
    },
    /** Puts the global object back as it was when `hostGlobals()` was called: `window`, `matchMedia`, the frame functions, the world, and whatever the bundles defined. */
    restore(): void {
      snapshot.restore();
    },
  };
}
