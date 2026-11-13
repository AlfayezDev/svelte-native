import { afterAll, beforeAll, describe, expect, jest, test } from "bun:test";
import { build, transform, type Plugin } from "esbuild";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, compileModule, type CompileOptions } from "svelte/compiler";
import { coreFeatures } from "../src/lib/features/core.ts";
import { demos } from "../src/lib/features/demos.ts";

/**
 * Every screen of the core tour mounted on the library's fake Fabric binding (the one its own tests use, `packages/svelte-native/tests`): the
 * app's real root layout, the generated route table and the real pages, compiled by the Svelte compiler with the custom renderer, with React
 * Native's modules stubbed. It cannot say how a screen looks, but it does catch a screen that throws when it mounts, a log of an error, and a
 * list that mounts every row. A device is still where the look and the touch are checked.
 *
 * The same harness plays the demo scripts (`src/lib/demo.ts`): a screen opened with `?demo` runs its script on a fake clock, so ten seconds of
 * pauses take a few milliseconds, and the test says whether the script got to its end without an error. The screens whose views come from a
 * native library are the ones it cannot mount (`needsNativeLibrary`).
 */
const app = join(import.meta.dirname, "..");
const library = dirname(createRequire(import.meta.url).resolve("@alfayez/svelte-native/package.json"));
const libraryTests = join(library, "tests");

/**
 * The routes of the demo manifest this harness does not mount, and the native library each one needs. A foreign view (`@alfayez/svelte-native/foreign`
 * and `/svg`) is drawn from the library's own view configs and native module, and the gestures screen attaches handlers to react-native-gesture-handler's
 * turbo module; the fake binding has none of them. Their scripts are checked on a device (the videos are recorded there); the bundle test compiles
 * the screens, and `demo.test.ts` runs the helper they all use.
 */
const needsNativeLibrary: Record<string, string> = {
  "/native-views/image": "expo-image",
  "/native-views/blur": "the library's own blur view and expo-image",
  "/native-views/linear-gradient": "expo-linear-gradient",
  "/native-views/conic-gradient": "expo-conic-gradient",
  "/native-views/video": "react-native-video",
  "/native-views/lottie": "lottie-react-native",
  "/native-views/pdf": "react-native-pdf",
  "/native-views/svg": "react-native-svg",
  "/native-views/rive": "rive-react-native",
  "/native-views/shadow": "react-native-fast-shadow",
  "/native-views/animateable-text": "react-native-animateable-text",
  "/native-views/view-shot": "react-native-view-shot",
  "/native-views/date-time-picker": "@react-native-community/datetimepicker",
  "/native-views/web-view": "react-native-webview",
  "/native-views/map": "react-native-maps",
  "/native-views/any-expo-view": "expo-camera and expo-image, by name",
  "/gestures": "react-native-gesture-handler",
};
/** The screens with a script that run here. */
const scripted = [...new Set(demos.map((demo) => demo.route))].sort();
const playable = scripted.filter((route) => !(route in needsNativeLibrary));

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean };
const roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode: (tag: number, name: string, _root: number, props: Record<string, unknown>) => ({ tag, name, props: { ...props }, children: [], sealed: false }),
  cloneNodeWithNewChildren: (node: FakeNode) => ({ ...node, children: [], sealed: false }),
  cloneNodeWithNewProps: (node: FakeNode, props: Record<string, unknown>) => ({ ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }),
  cloneNodeWithNewChildrenAndProps: (node: FakeNode, props: Record<string, unknown>) => ({ ...node, props: { ...node.props, ...props }, children: [], sealed: false }),
  appendChild(parent: FakeNode, child: FakeNode) {
    if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
    parent.children.push(child);
  },
  createChildSet: (root: number) => ({ root, children: [] as FakeNode[] }),
  appendChildToSet: (set: { children: FakeNode[] }, child: FakeNode) => { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    const seal = (node: FakeNode) => { node.sealed = true; node.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
  },
  measure: (_node: FakeNode, callback: (...args: number[]) => void) => callback(1, 2, 3, 4, 5, 6),
  measureInWindow: (_node: FakeNode, callback: (...args: number[]) => void) => callback(5, 6, 3, 4),
  dispatchCommand: () => {},
  registerEventHandler: () => {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;
(globalThis as { __navigationInsets?: unknown }).__navigationInsets = { top: 24, right: 0, bottom: 34, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } };

/** What the screens import from React Native and Expo, as the smallest modules that do the job; the rest of `react-native` is an empty module. */
const stubs: Record<string, string> = {
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: {}, directEventTypes: {} });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__exampleOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/Appearance": "export const getColorScheme = () => 'light'; export const addChangeListener = () => ({ remove() {} });",
  "react-native/Libraries/Utilities/Dimensions": "export default { get: () => ({ width: 400, height: 800, scale: 2, fontScale: 1 }) };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  // A link that arrives while the app is open (`play`'s `from`) goes to the newest router: the screens of earlier tests are still mounted.
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (type, handler) => { handlers.push(handler); return { remove() { handlers.splice(handlers.indexOf(handler), 1); } }; }, getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/AppState/AppState": "export default { currentState: 'active', addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter": "export default { addListener: () => ({ remove() {} }) };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = (name) => name === 'SvelteEngine' ? { install: () => false, getInsets: () => globalThis.__navigationInsets, addListener: () => ({ remove() {} }) } : null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

// The options the library's transformer compiles a component with (runes mode for the app's own components), as the library's tests use them.
const { componentOptions, lowersHtml } = (await import(join(library, "src/compile-options.ts"))) as { componentOptions(filename: string): CompileOptions; lowersHtml(filename: string): boolean };
// And the lowering the transformer runs first: the primitives, and the HTML elements of the app's own files (the HTML screen has nothing else).
const { lowerPrimitives } = (await import(join(library, "src/lower.ts"))) as { lowerPrimitives(content: string, options: { filename: string; html: boolean }): string };

const svelteCompiler: Plugin = {
  name: "svelte",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
      contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path, html: lowersHtml(path) }), componentOptions(path)).js.code,
      loader: "js",
    }));
    builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
      const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
      return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
    });
  },
};

type Mounted = { startSurface(surface: number, component: unknown, props: Record<string, unknown>): unknown; tick(): Promise<void>; Fixture: unknown };
let mounted: Mounted;
let directory: string;

beforeAll(async () => {
  // The library loads Reanimated when a screen first animates, and its bundle always names it: the library's own stand-ins for it.
  const { reanimatedStubs } = (await import(join(libraryTests, "reanimated-stubs.ts"))) as { reanimatedStubs: Record<string, string> };
  Object.assign(stubs, reanimatedStubs);
  // The library's stand-in knows `withTiming` only; the animation and gestures screens also spring and repeat, which the stand-in treats like a timing: the animation is recorded, not played.
  stubs["react-native-reanimated"] += "\nexport const withSpring = (to, config, callback) => withTiming(to, config, callback); export const withRepeat = (animation) => animation;";
  directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "example-screens-"));
  // A project whose `src` holds the app's real layout, home and lib, and the route folders of the core tour and of the demo screens that
  // can run here: the route table `svelte-native sync` writes then requires exactly the pages this test mounts. The native-view and remote
  // screens need their libraries' native views, which the fake binding does not have; the bundle test (`bundle.test.ts`) compiles them.
  await mkdir(join(directory, "src/routes"), { recursive: true });
  // The app's `imports` (`#lib/*`), so the copied pages resolve what they import as they do in the app.
  const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as { imports?: unknown };
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "example-screens", private: true, type: "module", imports: manifest.imports }));
  await symlink(join(app, "src/lib"), join(directory, "src/lib"));
  await symlink(join(app, "assets"), join(directory, "assets"));
  for (const file of ["+layout.mobile.svelte", "+mobile.svelte"]) await symlink(join(app, "src/routes", file), join(directory, "src/routes", file));
  const folders = new Set([...coreFeatures.flatMap((feature) => [feature.route, ...(feature.also ?? [])]), ...playable].map((route) => route.split("/")[1]).filter((folder): folder is string => Boolean(folder)));
  // Copied, not linked: route discovery does not follow a linked folder. Their relative imports reach the linked `src/lib`.
  for (const folder of folders) await cp(join(app, "src/routes", folder), join(directory, "src/routes", folder), { recursive: true });
  const { syncRoutes } = (await import(join(library, "src/build.ts"))) as { syncRoutes(root: string, options: { variant: string }): void };
  syncRoutes(directory, { variant: "test" });
  await mkdir(join(directory, "fixture"));
  await writeFile(join(directory, "fixture/Fixture.svelte"), `<script>
    import Root from ${JSON.stringify(join(library, "src/Root.svelte"))};
    import Shell from ${JSON.stringify(join(app, "src/routes/+layout.mobile.svelte"))};
    import { tree } from "@alfayez/svelte-native/routes";
    let { initial } = $props();
  </script>
  <Root shell={Shell} {tree} {initial} />`);
  const bundle = await build({
    stdin: {
      contents: `import Fixture from "./Fixture.svelte"; import { startSurface } from ${JSON.stringify(join(library, "src/fabric/host.ts"))}; import { tick } from "svelte"; export { Fixture, startSurface, tick };`,
      resolveDir: join(directory, "fixture"),
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, nodePaths: [join(app, "node_modules"), join(app, "../../node_modules")],
    loader: { ".png": "dataurl" },
    plugins: [svelteCompiler, {
      name: "fabric-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: join(libraryTests, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: join(library, "src/renderer.ts") }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/routes$/ }, () => ({ path: join(directory, ".svelte-native/routes.test.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: join(library, "src/environment.ts") }));
      },
    }],
  });
  const file = join(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  mounted = (await import(pathToFileURL(file).href)) as Mounted;
});
afterAll(() => rm(directory, { recursive: true, force: true }));

const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((node) => [...(node.name === name ? [node] : []), ...find(node.children, name)]);
const texts = (surface: number): string[] => find(roots[surface] ?? [], "RCTRawText").map((node) => String(node.props.text));
/** The title of every header on the surface: the screen's `<Screen title>`, which the engine reads from the header's `nativeID` (`svelte:header;t=…`). */
const titles = (surface: number): string[] => [...JSON.stringify(roots[surface] ?? []).matchAll(/svelte:header;[^"]*?\bt=([^;"]*)/g)].map((match) => decodeURIComponent(match[1] ?? ""));
const turns = async () => { for (let turn = 0; turn < 8; turn++) { await mounted.tick(); await Promise.resolve(); await Promise.resolve(); } };

let nextSurface = 100;
async function mount(href: string, os: "android" | "ios" = "android") {
  (globalThis as { __exampleOS?: string }).__exampleOS = os;
  const surface = nextSurface++;
  const problems: string[] = [];
  const logged = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => { problems.push(args.map(String).join(" ")); };
  console.warn = (...args: unknown[]) => { problems.push(args.map(String).join(" ")); };
  try {
    mounted.startSurface(surface, mounted.Fixture, { initial: href });
    await turns();
  } finally {
    console.error = logged.error;
    console.warn = logged.warn;
  }
  return { surface, problems };
}

/** Waits for a task of the real event loop, which lets every promise that is ready settle; `setImmediate` is not on the fake clock. */
const settled = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/**
 * Opens `route` with `?demo` and plays its script on a fake clock until the script says it ended or stopped (or logs a problem, or nothing is
 * left to wait for). The clock jumps from timer to timer, and a timer's promises settle before the next one fires, as they would in a gap of
 * real time. `from` is a screen to start the app on, with the demo link arriving afterwards as a link opened by the platform does (a sheet or
 * a modal needs a screen below it). `ms` is the time the script took on the fake clock: what `[demo] end` says.
 */
async function play(route: string, from?: string) {
  (globalThis as { __exampleOS?: string }).__exampleOS = "android";
  const surface = nextSurface++;
  const log: string[] = [];
  const problems: string[] = [];
  const logged = { log: console.log, error: console.error, warn: console.warn };
  const line = (args: unknown[]) => args.map(String).join(" ");
  console.log = (...args: unknown[]) => { log.push(line(args)); };
  console.error = (...args: unknown[]) => { problems.push(line(args)); };
  // A screen that goes leaves the native stack when the stack reports its exit; there is none here, so the router's timeout removes it, with a warning.
  console.warn = (...args: unknown[]) => { if (!/did not report their exit/.test(line(args))) problems.push(line(args)); };
  const ended = () => log.some((entry) => /^\[demo\] (?:end|stopped) /.test(entry));
  jest.useFakeTimers();
  try {
    mounted.startSurface(surface, mounted.Fixture, { initial: from ?? `${route}?demo` });
    await turns();
    if (from) {
      const links = (globalThis as { __linkHandlers?: ((event: { url: string }) => void)[] }).__linkHandlers ?? [];
      links[links.length - 1]?.({ url: `svelte-native://${route}?demo` });
      await turns();
    }
    for (let fired = 0; !ended() && problems.length === 0 && jest.getTimerCount() > 0 && fired < 20_000; fired++) {
      jest.advanceTimersToNextTimer();
      await settled();
    }
  } finally {
    jest.useRealTimers();
    Object.assign(console, logged);
  }
  const end = log.map((entry) => /^\[demo\] end \S+ after (\d+) ms$/.exec(entry)).find((match) => match !== null);
  return { log, problems, ms: end ? Number(end[1]) : undefined };
}

const routes = coreFeatures.flatMap((feature) => [feature.route, ...(feature.also ?? [])]).map((route) => route.replace("[id]", "7"));

describe("every screen of the core tour mounts", () => {
  for (const os of ["android", "ios"] as const) {
    for (const route of routes) {
      test(`${route} on ${os} draws a header and text and logs nothing`, async () => {
        const { surface, problems } = await mount(route, os);
        expect(problems).toEqual([]);
        expect(titles(surface).length).toBeGreaterThan(0);
        expect(texts(surface).length).toBeGreaterThanOrEqual(2);
      });
    }
  }

  test("the home screen lists every feature of the registries under its group", async () => {
    const { surface, problems } = await mount("/");
    expect(problems).toEqual([]);
    expect(titles(surface)).toContain("Svelte Native");
    for (const feature of coreFeatures) expect([feature.title, texts(surface).includes(feature.title)]).toEqual([feature.title, true]);
    expect(texts(surface)).toContain("BASICS");
  });

  test("the windowed list mounts a few of its 5,000 rows, and the plain list all of its 40", async () => {
    const { surface } = await mount("/lists");
    const rows = texts(surface).filter((line) => /^Person \d+$/.test(line));
    expect(rows).toContain("Person 1");
    expect(rows).not.toContain("Person 4000");
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(rows.length).toBeLessThan(100);
  });

  test("the HTML screen draws its list, form and links from HTML elements, and the dialog is a closed modal", async () => {
    const { surface, problems } = await mount("/html");
    expect(problems).toEqual([]);
    const lines = texts(surface);
    // The text of an li (h3 and p), of a button, of the form's label and of a paragraph with links in it.
    for (const line of ["Amal Haddad", "jon@example.com", "Add contact", "Send updates", "stack screen"]) expect([line, lines.includes(line)]).toEqual([line, true]);
    // `<input>` is a text input and a switch, `<dialog>` a modal that is not shown, `<img>` an image.
    expect(find(roots[surface] ?? [], "AndroidTextInput").length).toBe(2);
    expect(find(roots[surface] ?? [], "AndroidSwitch").length).toBe(1);
    expect(find(roots[surface] ?? [], "RCTImageView").length).toBe(2);
    expect(find(roots[surface] ?? [], "RCTModalHostView").map((node) => node.props.visible)).toEqual([false]);
  });

  test("a route parameter reaches the page: item 7 of the stack", async () => {
    const { surface } = await mount("/navigation/stack/7");
    expect(titles(surface)).toContain("Item 7");
    expect(texts(surface)).toContain("Push item 8");
  });

  test("the tab bar opens on its first tab, with its own header", async () => {
    const { surface } = await mount("/navigation/tabs");
    expect(titles(surface)).toContain("Feed");
    expect(texts(surface)).toContain("Post 1");
  });
});

describe("every demo script plays to its end", () => {
  // A sheet and a modal close themselves with `router.back()`, which needs a screen below them: the app is open on the home screen, as for a recording.
  const overHome = new Set(["/navigation/sheet", "/navigation/modal"]);
  for (const route of playable) {
    test(`${route} logs its start and its end, and nothing else goes wrong`, async () => {
      const { log, problems, ms } = await play(route, overHome.has(route) ? "/" : undefined);
      expect(problems).toEqual([]);
      expect(log.filter((entry) => entry.startsWith("[demo]")).map((entry) => entry.replace(/ after \d+ ms$/, ""))).toEqual([`[demo] start ${route}`, `[demo] end ${route}`]);
      // The manifest's length is what a recording on an emulator took: the pauses add up to a little less (a frame to render, the keyboard to open), never to more.
      const recorded = demos.find((demo) => demo.route === route)?.durationMs ?? 0;
      expect([route, ms, ms !== undefined && ms <= recorded + 50 && ms >= recorded - 1000]).toEqual([route, ms, true]);
    });
  }

  test("a screen that has a script is played here, or is listed with the library that stops it", () => {
    expect(scripted.length).toBe(playable.length + Object.keys(needsNativeLibrary).length);
    for (const route of Object.keys(needsNativeLibrary)) expect([route, scripted.includes(route)]).toEqual([route, true]);
  });
});
