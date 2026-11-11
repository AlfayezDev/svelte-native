import { test, expect, jest, afterEach, beforeEach } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions, lowersHtml } from "../src/compile-options.ts";
import { lowerPrimitives } from "../src/lower.ts";
import { hostBind, hostClick, hostHref, hostInputEvent, hostKeyEvent, hostSource, hostStyleProps, hostSubmit, hostTag, hostWebClickSpread, hostWebSpread } from "../src/renderer.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";

/**
 * A page written with HTML elements and nothing imported from the package (`html-page-fixture.svelte`), lowered as the Metro transformer lowers it (`lowerPrimitives` with `html`, for the
 * files `lowersHtml` names), mounted under a real `<Router>` on a fake Fabric host: the host tree and its props are what the platform would be given, and a press, an edit and a
 * link go through the host's own event path.
 */
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
let roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) {
    if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
    parent.children.push(child);
  },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
  },
  measure(_node: FakeNode, callback: (...args: number[]) => void) { callback(1, 2, 3, 4, 5, 6); },
  measureInWindow(_node: FakeNode, callback: (...args: number[]) => void) { callback(5, 6, 3, 4); },
  dispatchCommand() {},
  registerEventHandler(handler: unknown) { (fake as { handler?: unknown }).handler = handler; },
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null), openURL: (url) => { (globalThis.__opened ??= []).push(url); return Promise.resolve(); } };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
  "react-native/Libraries/Utilities/Appearance": "export const getColorScheme = () => 'light'; export const addChangeListener = () => ({ remove() {} });",
  "react-native/Libraries/Utilities/PixelRatio": "export default { get: () => 2, roundToNearestPixel: (value) => Math.round(value * 2) / 2 };",
  "react-native/Libraries/Utilities/Dimensions": "export default { get: () => ({ width: 400, height: 800 }), addEventListener: () => ({ remove() {} }) };",
  // The `Text` and `View` a fixture imports are lowered to `<native-text>` and `<native-view>`, and the import is then unused.
  "@example/svelte-native": "export const Text = null; export const View = null;",
};

// The class table the class resolver reads (`@example/svelte-native/classes-table`): what the converter would write for these classes.
const classTable = {
  version: 1,
  classes: {
    "text-lg": [{ order: 1, style: { fontSize: 18 }, fontRelative: { lineHeight: 1.5 } }],
    "text-sm": [{ order: 2, style: { fontSize: 14 }, fontRelative: { lineHeight: 1.25 } }],
    "leading-snug": [{ order: 3, fontRelative: { lineHeight: 1.25 } }],
    "text-white": [{ order: 4, style: { color: "#ffffff" } }],
    "bg-blue": [{ order: 5, style: { backgroundColor: "#0000ff" } }],
    card: [{ order: 6, style: { padding: 16 } }],
  },
};

const components = ["TextInput", "Switch", "Modal"];

/** What the lowering warned about while the last fixture was built. */
let warnings: string[] = [];

async function load(fixture = "html-root-fixture.svelte") {
  warnings = [];
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import '../src/css/load-table.ts';
        import { startSurface, stopSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, stopSurface, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "html-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core|@example\/svelte-native$)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@example\/svelte-native\/classes-table$/ }, (args) => ({ path: args.path, namespace: "classes-table" }));
        builder.onLoad({ filter: /.*/, namespace: "classes-table" }, () => ({ contents: `export default ${JSON.stringify(classTable)};`, loader: "js" }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^@example\/svelte-native\/router$/ }, () => ({ path: resolve(import.meta.dirname, "../src/router.svelte.ts") }));
        // What the lowering imports the components from; the entry holds more (lists, keyboards) than the page needs.
        builder.onResolve({ filter: /^@example\/svelte-native\/core$/ }, () => ({ path: "core", namespace: "package" }));
        builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
          contents: components.map((name) => `export { default as ${name} } from ${JSON.stringify(resolve(import.meta.dirname, `../src/components/${name}.svelte`))};`).join("\n"),
          loader: "js", resolveDir: import.meta.dirname,
        }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
        // The way Metro's transformer does it, for the files it lowers HTML in.
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path, html: lowersHtml(path), warn: (message) => warnings.push(message) }), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-html-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

type Module = Awaited<ReturnType<typeof load>>;
type Page = { snapshot(): { name: string; agreed: boolean; showDialog: boolean; boxed: boolean; sectioned: boolean }; setDialog(value: boolean): void; setName(value: string): void; toggleSecret(): void };
const globals = globalThis as unknown as { __htmlLog: (entry: string) => void; __htmlPage: Page; __opened?: string[] };
const settle = async (m: Module) => { for (let turn = 0; turn < 4; turn++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };
const all = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((node) => [node, ...all(node.children)]);
const emit = (target: unknown, type: string, event: object) => (fake as unknown as { handler: (t: unknown, type: string, e: object) => void }).handler(target, type, event);
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {}));
/** What a node draws: the text it holds, with the text of nested spans in their places. */
const textOf = (node: FakeNode): string => node.children.map((child) => (child.name === "RCTRawText" ? String(child.props.text) : textOf(child))).join("");

let surface = 500;
beforeEach(() => { (globalThis as unknown as { __log: string[] }).__log = []; });
let started: { m: Module; tag: number } | undefined;
async function mount() {
  const m = await load();
  jest.useFakeTimers();
  roots = {};
  globals.__opened = [];
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, {}) as { current(): string };
  started = { m, tag };
  await settle(m);
  const nodes = () => all(roots[tag] ?? []);
  const byID = (testID: string) => {
    const found = nodes().find((node) => node.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  return { m, app, log, byID, nodes, page: globals.__htmlPage, settle: () => settle(m) };
}
afterEach(() => {
  if (started) started.m.stopSurface(started.tag);
  started = undefined;
  jest.useRealTimers();
});

test("a page of HTML elements is a host tree: views, texts, a pressable, an image and the native controls", async () => {
  const t = await mount();
  const card = t.byID("card");
  expect(card.name).toBe("RCTView");
  // The text next to the elements of a div is a `native-text` of its own: the host draws no bare text.
  expect(textOf(card.children[0] as FakeNode)).toBe("Hello Ada");
  expect((card.children[0] as FakeNode).name).toBe("RCTText");
  const title = t.byID("title");
  expect(title.name).toBe("RCTText");
  expect(title.props.accessibilityRole).toBe("header");
  expect(textOf(title)).toBe("Title");
  // `<p>` holds text and inline elements: one text, the `<a>` and `<b>` are spans of it.
  const para = t.byID("para");
  expect(para.name).toBe("RCTText");
  expect(textOf(para)).toBe("Read the terms or else.");
  expect(t.byID("terms").name).toBe("RCTVirtualText");
  // The rows of an `{#each}`: views holding a text each.
  const row = t.byID("row/a");
  expect(row.name).toBe("RCTView");
  expect(textOf(row)).toBe("/a");
  expect(row.children[0]?.name).toBe("RCTText");
  // A button is a pressable view: role button, `type` dropped, text wrapped.
  const save = t.byID("save");
  expect(save.name).toBe("RCTView");
  expect(save.props.accessibilityRole).toBe("button");
  expect(save.props.onClick).toBe(true);
  // `type` stays as the element's own (a press reads it: a button that is not a submit button submits nothing); the native view ignores it.
  expect(save.props.disabled).toBe(false);
  // A disabled button is disabled for the screen reader too, as React Native's Pressable makes it.
  expect((save.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled).toBe(false);
  expect((t.byID("off").props.accessibilityState as { disabled?: boolean }).disabled).toBe(true);
  expect(textOf(save)).toBe("Save");
  expect(save.children[0]?.name).toBe("RCTText");
  // An image: `src` is the source, `alt` its label, `width` and `height` its size.
  const logo = t.byID("logo");
  expect(logo.name).toBe("RCTImageView");
  expect(logo.props.source).toEqual([{ uri: "/logo.png", scale: 1 }]);
  expect(logo.props.accessibilityLabel).toBe("Logo");
  expect(logo.props.accessible).toBe(true);
  expect(flat(logo.props.style)).toMatchObject({ width: 40, height: 30 });
  expect(t.byID("asset").props.source).toEqual([{ uri: "https://x.dev/a.png", scale: 1 }]);
  // Inputs are the native controls: a text field with its keyboard, a multiline one, a switch; the dialog is a modal host that is not shown.
  const email = t.byID("email");
  expect(email.name).toBe("AndroidTextInput");
  expect(email.props).toMatchObject({ keyboardType: "email-address", autoComplete: "email", autoCapitalize: "none", placeholder: "Email", maxLength: 20, text: "Ada" });
  expect(t.byID("pass").props.secureTextEntry).toBe(true);
  expect(t.byID("off-input").props.editable).toBe(false);
  expect(t.byID("notes").props).toMatchObject({ multiline: true, numberOfLines: 3 });
  expect(t.byID("agree").name).toBe("AndroidSwitch");
  // `style`, a spread and `bind:this` are carried over as on a lowered `<View>`; a web handler name in the spread (`onclick`) is the native one.
  const styled = t.byID("styled");
  expect(flat(styled.props.style)).toEqual({ padding: 4 });
  expect(styled.props.accessibilityLabel).toBe("from a spread");
  expect(styled.props.onClick).toBe(true);
  expect(t.page.snapshot().sectioned).toBe(true);
  emit(styled.target, "topClick", {});
  expect(t.log).toEqual(["section"]);
  expect(t.byID("dialog").name).toBe("RCTModalHostView");
  expect(t.byID("dialog").props.visible).toBe(false);
  expect(textOf(t.byID("dialog-text"))).toBe("Dialog body");
});

test("a press runs onclick as onPress, an <a href> goes to the router or the platform, and a disabled button does not press", async () => {
  const t = await mount();
  // A div with an `onclick` is pressable.
  emit(t.byID("card").target, "topClick", {});
  expect(t.log).toEqual(["card"]);
  emit(t.byID("save").target, "topClick", {});
  expect(t.log).toEqual(["card", "save"]);
  // `disabled` keeps its own press from running (the touch is the card's, as for a disabled `Pressable` in a pressable view).
  emit(t.byID("off").target, "topClick", {});
  expect(t.log).toEqual(["card", "save", "card"]);
  expect(t.byID("off").props.disabled).toBe(true);
  // A link to another site is opened by the platform, after its own `onclick`.
  emit(t.byID("site").target, "topClick", {});
  expect(t.log.at(-1)).toBe("site");
  expect(t.log).not.toContain("off");
  expect(globals.__opened).toEqual(["https://example.com/x"]);
  // A link inside the app is the router's `goto`.
  expect(t.app.current()).toBe("/");
  emit(t.byID("go").target, "topClick", {});
  await t.settle();
  expect(t.app.current()).toBe("/a");
});

test("an inline <a> in a <p> is a press on the text; a role and a link role come from the elements", async () => {
  const t = await mount();
  const terms = t.byID("terms");
  expect(terms.props.accessibilityRole).toBe("link");
  expect(terms.props.onClick).toBe(true);
  expect(t.byID("go").props.accessibilityRole).toBe("link");
  expect(t.byID("go").name).toBe("RCTView");
  emit(terms.target, "topClick", {});
  await t.settle();
  expect(t.app.current()).toBe("/a");
});

test("an input binds, and oninput and onchange get the web's event shape; a checkbox is a switch; bind:this is the handle", async () => {
  const t = await mount();
  const email = t.byID("email");
  emit(email.target, "topChange", { text: "grace", eventCount: 1 });
  await t.settle();
  expect(t.page.snapshot().name).toBe("grace");
  expect(t.log).toEqual(["input grace"]);
  t.page.setName("ada");
  await t.settle();
  expect(t.byID("email").props.text).toBe("ada");
  expect(t.page.snapshot().boxed).toBe(true);
  emit(t.byID("agree").target, "topChange", { value: true });
  await t.settle();
  expect(t.page.snapshot().agreed).toBe(true);
  expect(t.log.at(-1)).toBe("agree true");
  expect(t.byID("agree").props.value).toBe(true);
  // `type={expression}` is worked out when it changes.
  expect(t.byID("pass").props.secureTextEntry).toBe(true);
  t.page.toggleSecret();
  await t.settle();
  expect(t.byID("pass").props.secureTextEntry).toBeFalsy();
});

test("a dialog is a modal that is visible while it is open", async () => {
  const t = await mount();
  t.page.setDialog(true);
  await t.settle();
  expect(t.byID("dialog").props.visible).toBe(true);
  t.page.setDialog(false);
  await t.settle();
  expect(t.byID("dialog").props.visible).toBe(false);
});

/** The text of each `RCTText` that is not inside another one, with what is inside nested ones in the order they were written. */
const textsOf = (nodes: FakeNode[]): string[][] => nodes.flatMap((node) => {
  if (node.name === "RCTText") return [node.children.flatMap((child) => (child.name === "RCTRawText" ? [String(child.props.text)] : child.name === "RCTVirtualText" ? child.children.map((inner) => String(inner.props.text)) : []))];
  return textsOf(node.children);
});

test("the text of a div reaches the native text as the text of a Text written the same way does, whitespace included (tests/text-whitespace.test.ts)", async () => {
  const m = await load("html-text-fixture.svelte");
  roots = {};
  const app = m.startSurface(601, m.Fixture, {}) as { rename(next: string): void };
  const texts = textsOf(roots[601] ?? []);
  expect(texts).toHaveLength(12);
  // Even indexes are the div's, odd ones the Text's: the same strings (the last two are not pairs).
  for (let index = 0; index < 10; index += 2) expect(texts[index], `text ${index / 2}`).toEqual(texts[index + 1] as string[]);
  expect(texts[0]).toEqual(["A sentence that is split\n    across two source lines."]);
  expect(texts[2]).toEqual(["Hello Ada,\n    welcome   back."]);
  expect(texts[4]).toEqual(["Before ", "nested", " after."]);
  expect(texts[6]).toEqual(["padded on one line"]);
  app.rename("Grace");
  await m.tick();
  await Promise.resolve();
  const after = textsOf(roots[601] ?? []);
  expect(after[2]).toEqual(["Hello Grace,\n    welcome   back."]);
  expect(after[8]).toEqual(["Grace"]);
});

test("a link has the platform open another site or app, ignores a hash, and needs a router for a screen of the app", async () => {
  const m = await load("html-link-fixture.svelte");
  roots = {};
  globals.__opened = [];
  m.startSurface(602, m.Fixture, {});
  const press = (testID: string) => emit(all(roots[602] ?? []).find((node) => node.props.testID === testID)?.target, "topClick", {});
  press("mail");
  press("net");
  press("hash");
  expect(globals.__opened).toEqual(["mailto:ada@example.com", "https://example.com/x"]);
  expect(() => press("screen")).toThrow('<a href="/settings"> goes to a screen of the app, which needs a router above it');
});

test("what the lowered code calls: a source from a string or an asset, the props of a type, the event of an input, a spread's onclick", () => {
  expect(hostSource("/a.png")).toEqual({ uri: "/a.png" });
  expect(hostSource(12)).toBe(12);
  const source = { uri: "https://x.dev/a.png" };
  expect(hostSource(source)).toBe(source);
  expect(hostSource(undefined)).toBeUndefined();
  const event = hostInputEvent("input", "ada");
  expect(event).toMatchObject({ type: "input", target: { value: "ada" }, currentTarget: { value: "ada" } });
  expect(hostInputEvent("change", true)).toMatchObject({ type: "change", currentTarget: { checked: true } });
  expect(() => { event.preventDefault(); event.stopPropagation(); }).not.toThrow();
  const press = () => {};
  expect(hostWebSpread({ onclick: press, id: "a" })).toEqual({ onPress: press, id: "a" });
  expect(hostWebSpread({ onclick: press, onPress: go })).toEqual({ onPress: go });
});
function go() {}

test("a <pre> keeps its spaces and newlines, a <br> is a newline of its text, and an <hr> is a hairline that its class or style can change", async () => {
  const m = await load("html-text-fixture.svelte");
  roots = {};
  m.startSurface(604, m.Fixture, {});
  const texts = textsOf(roots[604] ?? []);
  // The newline right after `<pre>` is not part of the text, as in HTML; the rest is as written, around a nested element.
  expect(texts[10]).toEqual(["  line one\n    ", "bold", "  and  `ticks` \\ back\n"]);
  expect(texts[11]).toEqual(["a\nb"]);
  const rules = all(roots[604] ?? []).filter((node) => node.props.testID === "rule" || node.props.testID === "rule-own");
  expect(flat(rules[0]?.props.style)).toEqual({ height: 0.5, backgroundColor: "#c7c7cc", marginVertical: 8 });
  // The element's own style is over the default, key by key.
  expect(flat(rules[1]?.props.style)).toEqual({ height: 4, backgroundColor: "#c7c7cc", marginVertical: 0 });
});

test("a submit button anywhere below a <form> (in a component of its own too) and Enter in a single-line input make the form hear submit; preventDefault on the click stops it", async () => {
  const m = await load("html-form-fixture.svelte");
  roots = {};
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  m.startSurface(603, m.Fixture, {});
  const node = (testID: string) => {
    const found = all(roots[603] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found.target;
  };
  const turn = async () => { for (let index = 0; index < 3; index++) { await m.tick(); await Promise.resolve(); } };
  // The submit button of the field component: no `onclick` of its own, and the form is not in its file.
  emit(node("field-submit"), "topClick", {});
  expect(log).toEqual(["submit submit true []"]);
  emit(node("field-input"), "topChange", { text: "ada", eventCount: 1 });
  await turn();
  log.length = 0;
  emit(node("own-submit"), "topClick", {});
  expect(log).toEqual(["submit submit true [ada]"]);
  // Enter in the single-line input.
  log.length = 0;
  emit(node("field-input"), "topSubmitEditing", { text: "ada" });
  expect(log).toEqual(["submit submit true [ada]"]);
  // A button that is not a submit button, a handler that prevents the default, a multiline input, and a button with no form above it.
  log.length = 0;
  emit(node("plain"), "topClick", {});
  emit(node("prevented"), "topClick", {});
  emit(node("notes"), "topSubmitEditing", { text: "" });
  emit(node("loose"), "topClick", {});
  expect(log).toEqual(["plain", "prevented"]);
});

test("a web handler that can never run on a device is a warning with the file and line, once; the ones that run are not", async () => {
  await load("html-form-fixture.svelte");
  expect(warnings).toEqual([`${resolve(import.meta.dirname, "html-form-fixture.svelte")}:26:27 onmouseover on <div> never runs on a device: a native element has no "mouseover" event (the web still calls it)`]);
});

test("onkeydown and onkeyup of an input are its key press, with the key", async () => {
  const m = await load("html-form-fixture.svelte");
  roots = {};
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  m.startSurface(605, m.Fixture, {});
  const keyed = all(roots[605] ?? []).find((candidate) => candidate.props.testID === "keyed");
  emit(keyed?.target, "topKeyPress", { key: "Enter" });
  expect(log).toEqual(["down Enter", "up Enter"]);
});

test("style as a string is converted when the file is built, and style:property directives follow their values", async () => {
  const m = await load("html-form-fixture.svelte");
  roots = {};
  m.startSurface(606, m.Fixture, {});
  const byID = (testID: string) => {
    const found = all(roots[606] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  // `line-height: 1.5` is relative to the font size the element has (20 here): the host works it out.
  expect(flat(byID("string-style").props.style)).toEqual({ paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8, color: "#ff0000", fontSize: 20, lineHeight: 30 });
  expect(flat(byID("directives").props.style)).toEqual({ color: "red", fontSize: 12, width: "50%", opacity: 0.5 });
  expect(flat(byID("mixed").props.style)).toEqual({ margin: 2, color: "red" });
  const form = globals as unknown as { __htmlForm: { setColor(value: string): void; setWidth(value: string | number): void } };
  form.__htmlForm.setColor("blue");
  form.__htmlForm.setWidth(100);
  for (let index = 0; index < 3; index++) { await m.tick(); await Promise.resolve(); }
  expect(flat(byID("directives").props.style)).toEqual({ color: "blue", fontSize: 12, width: 100, opacity: 0.5 });
  expect(flat(byID("mixed").props.style)).toEqual({ margin: 2, color: "blue" });
});

test("text style of an HTML element reaches the text and the inputs below it, through a View, and the text's own style wins", async () => {
  const m = await load("html-inherit-fixture.svelte");
  roots = {};
  m.startSurface(607, m.Fixture, {});
  const byID = (testID: string) => {
    const found = all(roots[607] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  const outer = { color: "white", fontSize: 20 };
  // The text of the outer div, which has no element of its own to carry it.
  expect(flat(all(byID("outer").children).find((candidate) => candidate.name === "RCTText")?.props.style)).toMatchObject(outer);
  // A paragraph two elements and a View down: the section's keys over the div's; the line height is a factor of the font size it ends up with.
  expect(flat(byID("deep").props.style)).toEqual({ ...outer, fontWeight: "700", lineHeight: 30 });
  expect(flat(byID("own").props.style)).toEqual({ color: "red", fontSize: 20, fontWeight: "700", lineHeight: 30 });
  expect(flat(byID("field").props.style)).toMatchObject(outer);
  // A Text from the package has React Native's semantics, and so has a View: it neither takes the style nor gives one.
  expect(byID("rn-text").props.style).toBeUndefined();
  expect(flat(byID("rn-child").props.style)).toEqual({});
  // A button's class: the text inside it is white.
  expect(flat(byID("button").props.style)).toMatchObject({ backgroundColor: "#0000ff" });
  expect(flat(all(byID("button").children).find((candidate) => candidate.name === "RCTText")?.props.style)).toEqual({ color: "#ffffff" });
});

test("a change to an element's text style reaches the text below it, and a font size it inherits is what a relative line height is made from", async () => {
  const m = await load("html-inherit-fixture.svelte");
  roots = {};
  m.startSurface(608, m.Fixture, {});
  const byID = (testID: string) => {
    const found = all(roots[608] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  const turns = async () => { for (let index = 0; index < 4; index++) { await m.tick(); await Promise.resolve(); } };
  const api = (globalThis as unknown as { __htmlInherit: { setColor(value: string): void; setBig(value: boolean): void } }).__htmlInherit;
  expect(flat(byID("deep").props.style).color).toBe("white");
  api.setColor("black");
  await turns();
  // The paragraph is two elements and a View below the div whose style changed.
  expect(flat(byID("deep").props.style).color).toBe("black");
  expect(flat(byID("own").props.style).color).toBe("red");
  expect(flat(byID("field").props.style).color).toBe("black");
  expect(flat(all(byID("outer").children).find((candidate) => candidate.name === "RCTText")?.props.style).color).toBe("black");
  // `text-lg` on a div gives its descendants 18; `leading-snug` of a paragraph (or of a div between) is 1.25 of that, and a line height the div gave is its factor, not a size.
  expect(flat(byID("relative").props.style)).toEqual({ fontSize: 18, lineHeight: 22.5 });
  expect(flat(byID("relative-deep").props.style)).toEqual({ fontSize: 18, lineHeight: 22.5 });
  expect(flat(byID("inherited-factor").props.style)).toEqual({ fontSize: 18, lineHeight: 27 });
  expect(flat(byID("inline-relative").props.style)).toEqual({ fontSize: 10, lineHeight: 20 });
  // The class changes with state: what is below follows (a theme or a breakpoint changes a class the same way).
  api.setBig(false);
  await turns();
  expect(flat(byID("relative").props.style)).toEqual({ fontSize: 14, lineHeight: 17.5 });
  expect(flat(byID("relative-deep").props.style)).toEqual({ fontSize: 14, lineHeight: 17.5 });
  expect(flat(byID("inherited-factor").props.style)).toEqual({ fontSize: 14, lineHeight: 17.5 });
});

test("style:property values are what a native style takes: px and numbers are dp, a percentage, a color or a keyword passes, a factor of the font size waits, anything else is left out with a warning", () => {
  expect(hostStyleProps({ "font-size": "12px", opacity: "0.5", width: "50%", color: "#fff", "text-align": "center", "z-index": 3, "padding-top": 4, "font-weight": 700, "text-decoration-line": "line-through", "background-color": "rgb(1, 2, 3)" }))
    .toEqual({ fontSize: 12, opacity: 0.5, width: "50%", color: "#fff", textAlign: "center", zIndex: 3, paddingTop: 4, fontWeight: "700", textDecorationLine: "line-through", backgroundColor: "rgb(1, 2, 3)" });
  // Nothing takes the property away, as on the web.
  expect(hostStyleProps({ color: null, width: undefined, height: false, margin: "" })).toEqual({});
  // A unitless or `em` line height, and an `em` letter spacing, are factors of the font size; a unitless number of another key is dp.
  expect(hostStyleProps({ "line-height": 1.5, "letter-spacing": "0.1em" })).toEqual({ fontRelative: { lineHeight: 1.5, letterSpacing: 0.1 } });
  expect(hostStyleProps({ "line-height": "20px" })).toEqual({ lineHeight: 20 });
  expect(hostStyleProps({ "line-height": "1.2em" })).toEqual({ fontRelative: { lineHeight: 1.2 } });
  const warnings: unknown[] = [];
  const warn = console.warn;
  const dev = globalThis as { __DEV__?: boolean };
  console.warn = (message: unknown) => { warnings.push(message); };
  dev.__DEV__ = true;
  try {
    expect(hostStyleProps({ width: "3rem", height: "calc(1px + 2px)", margin: { a: 1 }, color: "red", "--gap": "4px", flexo: 2 })).toEqual({ width: 48, color: "red", flexo: 2 });
  } finally {
    console.warn = warn;
    delete dev.__DEV__;
  }
  // `calc()` and an object are not values, `--gap` is not a property, `flexo` is not a style: four warnings; `3rem` is 48.
  expect(warnings).toHaveLength(4);
  expect(String(warnings[0])).toContain('style:height={"calc(1px + 2px)"} is not a value a native style takes');
  expect(warnings.map(String).some((warning) => warning.includes("--gap") && warning.includes("custom property"))).toBe(true);
  expect(warnings.map(String).some((warning) => warning.includes("flexo is not a style React Native knows"))).toBe(true);
  expect(hostStyleProps({ width: "10px !important", padding: "2rem" })).toEqual({ width: 10, padding: 32 });
});

test("a click runs the handler with a preventDefault that works, then what the press does by itself unless it was called; a submit needs the form above the element", () => {
  const log: string[] = [];
  const event = { nativeEvent: { x: 1 } };
  hostClick(event, (press: unknown) => { log.push(`handler ${(press as { nativeEvent: { x: number } }).nativeEvent.x}`); }, () => log.push("after"));
  expect(log).toEqual(["handler 1", "after"]);
  log.length = 0;
  hostClick(event, (press: unknown) => { (press as { preventDefault(): void }).preventDefault(); log.push("prevented"); }, () => log.push("after"));
  expect(log).toEqual(["prevented"]);
  // No handler, and no event (called by hand): the press still does what it does.
  log.length = 0;
  hostClick(undefined, undefined, () => log.push("after"));
  expect(log).toEqual(["after"]);
  // The event the host gives is not changed by a handler that prevents the default.
  expect((event as { defaultPrevented?: boolean }).defaultPrevented).toBeUndefined();
  // Without a form above (or an element at all) a submit is nothing, and so is the type of a button that is not a submit button.
  expect(() => { hostSubmit(undefined); hostSubmit({}); hostSubmit({ currentTarget: {} }); hostSubmit({ currentTarget: {} }, "button"); }).not.toThrow();
  expect(hostKeyEvent("keydown", { nativeEvent: { key: "a" }, currentTarget: 7 })).toMatchObject({ type: "keydown", key: "a", currentTarget: 7 });
  expect(hostKeyEvent("keyup", undefined)).toMatchObject({ type: "keyup", key: undefined });
});

/** A fixture on a surface of its own (no router), with a finder by `testID`. */
async function mountFixture(fixture: string, surface: number) {
  const m = await load(fixture);
  roots = {};
  globals.__opened = [];
  m.startSurface(surface, m.Fixture, {});
  await settle(m);
  const byID = (testID: string) => {
    const found = all(roots[surface] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  return { m, byID, nodes: () => all(roots[surface] ?? []), settle: () => settle(m) };
}
const probe = globalThis as unknown as { __log: string[]; __focused: string[]; __htmlRun: { setN(value: number): void }; __htmlBind: { reverse(): void; remove(id: number): void; show(): void; tags(): (number | null)[] }; __htmlMisc: { setCss(value: string): void; setTag(value: string): void; amount(): number; note(): string } };
/** The names of the children of a node, with a text's string: the shape of what the platform is given. */
const shape = (node: FakeNode): string[] => node.children.map((child) => (child.name === "RCTRawText" ? `"${child.props.text}"` : `${child.name}(${textOf(child)})`));

test("text that reaches an HTML view through children, a snippet or a block is drawn, as one line with the inline elements, and a View keeps React Native's rule", async () => {
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (message: unknown) => { warnings.push(message); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  let t: Awaited<ReturnType<typeof mountFixture>>;
  try {
    t = await mountFixture("html-run-fixture.svelte", 610);
  } finally {
    delete (globalThis as { __DEV__?: boolean }).__DEV__;
    console.warn = warn;
  }
  // A string a component hands to a button in `children`, and one in a snippet.
  expect(shape(t.byID("child-text"))).toEqual(["RCTText(Child text)"]);
  expect(shape(t.byID("snippet"))).toEqual(["RCTText(Save)"]);
  // `Hello {#if n}{n}{/if}!` is one text, before the block shows anything and after.
  expect(shape(t.byID("hello"))).toEqual(["RCTText(Hello !)"]);
  probe.__htmlRun.setN(2);
  await t.settle();
  expect(shape(t.byID("hello"))).toEqual(["RCTText(Hello 2!)"]);
  expect(t.byID("hello").children).toHaveLength(1);
  // Spans are one line, with the space between them when there is one, and the paragraphs are not.
  expect(shape(t.byID("spans"))).toEqual(["RCTText(ab)"]);
  expect(t.byID("spans").children[0]?.children.map((child) => child.name)).toEqual(["RCTVirtualText", "RCTVirtualText"]);
  expect(shape(t.byID("spaced"))).toEqual(["RCTText(a b)"]);
  expect(shape(t.byID("blocks"))).toEqual(["RCTText(one)", "RCTText(two)"]);
  // The whitespace at the edge of a line is not drawn: the text between two headings has none.
  expect(shape(t.byID("edges"))).toEqual(["RCTText(T)", "RCTText(some text)", "RCTText(U)"]);
  // A view in the middle splits the text in two; a button in a paragraph is a view in the text, whose own text is a text, not a span (React Native starts a new text under a view).
  expect(shape(t.byID("mixed"))).toEqual(["RCTText(before)", "RCTView(inner)", "RCTText(after)"]);
  expect(shape(t.byID("press"))).toEqual(['"Press "', "RCTView(here)", '" now"']);
  expect(t.byID("here").children.map((child) => child.name)).toEqual(["RCTText"]);
  // A view in a text starts a new text under it, as in React Native: the paragraph in it is a text, not a span of the text it is in.
  expect(t.byID("s7-para").name).toBe("RCTText");
  expect(t.byID("s7-box").name).toBe("RCTView");
  // A dialog's text.
  expect(shape(t.byID("dialog"))).toEqual(["RCTText(Dialog text)"]);
  // A View of the package draws no bare text, and development says so once, for both.
  expect(textOf(t.byID("rn"))).toBe("");
  expect(warnings.filter((message) => String(message).includes("not inside a Text"))).toHaveLength(1);
});

test("bind:this gives the handle before onMount, and a handle asked to focus before there is a view does it when the view is on the screen", async () => {
  const commands: string[] = [];
  const original = fake.dispatchCommand;
  fake.dispatchCommand = ((node: FakeNode, name: string) => { commands.push(`${name} ${node.props.testID}`); }) as never;
  try {
    probe.__focused = [];
    const t = await mountFixture("html-bind-fixture.svelte", 611);
    probe.__htmlBind.show();
    await t.settle();
    // The handles were there when `onMount` ran, for the input (a component, which hands its `ref` to the view) and the div.
    expect(probe.__focused).toEqual(["input true", "div true"]);
    // And what was asked of them has reached the views.
    expect(commands.sort()).toEqual(["focus late", "focus late-div"]);
  } finally {
    fake.dispatchCommand = original;
  }
});

test("bind:this={els[i]} follows its row: a handle is nulled only if the variable still holds it, and a moved row rebinds", async () => {
  const t = await mountFixture("html-bind-fixture.svelte", 612);
  const tag = (id: number) => t.byID(`row-${id}`).tag;
  expect(probe.__htmlBind.tags()).toEqual([tag(1), tag(2), tag(3)]);
  probe.__htmlBind.reverse();
  await t.settle();
  expect(probe.__htmlBind.tags()).toEqual([tag(3), tag(2), tag(1)]);
  probe.__htmlBind.remove(2);
  await t.settle();
  // The removed row's slot is not the one it had in the end; the last slot is nobody's.
  expect(probe.__htmlBind.tags()).toEqual([tag(3), tag(1), null]);
});

test("a component that passes its props down keeps HTML semantics: a button's type and onclick, an input's type, events, disabled and maxlength all come through the spread", async () => {
  const t = await mountFixture("html-wrap-fixture.svelte", 613);
  const log = probe.__log;
  const press = (testID: string) => emit(t.byID(testID).target, "topClick", {});
  press("cancel");
  expect(log.splice(0)).toEqual(["cancel"]);
  // The handler of the spread runs before the submission, as on the web, and a prevented click does not submit.
  press("save");
  expect(log.splice(0)).toEqual(["save click", "submitted"]);
  press("prevent");
  expect(log.splice(0)).toEqual(["prevented"]);
  const pass = t.byID("pass");
  expect(pass.props).toMatchObject({ secureTextEntry: true, autoComplete: "password", maxLength: 8 });
  emit(pass.target, "topChange", { text: "pw", eventCount: 1 });
  await t.settle();
  expect(log.splice(0)).toEqual(["input pw"]);
  expect(t.byID("off").props).toMatchObject({ editable: false, readOnly: true });
  // A number in state is the text of a number input.
  expect(t.byID("num").props).toMatchObject({ keyboardType: "numeric", text: "5" });
  // A link gets its href from a spread, and the `onclick` of a spread that prevents the default stops the navigation.
  globals.__opened = [];
  press("spread-link");
  expect(globals.__opened).toEqual(["https://example.com/spread"]);
  press("spread-prevented");
  expect(globals.__opened).toEqual(["https://example.com/spread"]);
  expect(log.splice(0)).toEqual(["link prevented"]);
});

test("what the lowered code calls on a handle and an event: a bind that nulls only its own handle, the href of the element pressed, a spread that leaves a press its own", () => {
  const store: Record<string, unknown> = {};
  const set = (keys: unknown[], value: unknown) => { store[String(keys[0])] = value; };
  const get = (keys: unknown[]) => store[String(keys[0])];
  const first = { name: "first" };
  const second = { name: "second" };
  const refOne = hostBind(set, get, ["a"]);
  const refTwo = hostBind(set, get, ["a"]);
  refOne(first);
  expect(store.a).toBe(first);
  // Another element took the slot: the first one going away leaves it.
  refTwo(second);
  refOne(null);
  expect(store.a).toBe(second);
  refTwo(null);
  expect(store.a).toBeNull();
  // A ref made again for another key nulls the key it had.
  const old = hostBind(set, get, ["x"]);
  old(first);
  hostBind(set, get, ["y"])(first);
  old(null);
  expect(store).toMatchObject({ x: null, y: first });
  // The `onclick` of a spread: the press's own `onPress` stays for a button and a link, and is the handler of any other element.
  const press = () => {};
  expect(hostWebClickSpread({ onclick: press, onPress: go, id: "a" })).toEqual({ onHtmlClick: press, onPress: go, id: "a" });
  expect(hostWebSpread({ onclick: press })).toEqual({ onPress: press });
  expect(hostHref(undefined)).toBeUndefined();
  expect(hostHref({ currentTarget: {} })).toBeUndefined();
});

test("a link without an href does nothing, a style that is text when the app runs is parsed, a number is the text of its input, and an input's event has its name, id and type", async () => {
  const t = await mountFixture("html-misc-fixture.svelte", 614);
  const log = probe.__log;
  emit(t.byID("nolink").target, "topClick", {});
  expect(log.splice(0)).toEqual(["no link clicked"]);
  expect(flat(t.byID("text-style").props.style)).toEqual({ color: "red", fontSize: 20, padding: 16 });
  probe.__htmlMisc.setCss("color: blue");
  await t.settle();
  expect(flat(t.byID("text-style").props.style)).toEqual({ color: "blue" });
  expect(t.byID("number").props.text).toBe("5");
  emit(t.byID("named").target, "topChange", { text: "ada", eventCount: 1 });
  await t.settle();
  expect(log.splice(0)).toEqual(["user/user-name/text/ada"]);
  // The text between the tags of a textarea is its initial value, and a bound value wins.
  expect(t.byID("initial").props.text).toBe("Initial 5 text");
  expect(t.byID("initial-bound").props.text).toBe("");
});

test("preventDefault on the key press of Enter stops the submission; Enter submits otherwise", async () => {
  const t = await mountFixture("html-misc-fixture.svelte", 615);
  const log = probe.__log;
  log.length = 0;
  emit(t.byID("enter-free").target, "topSubmitEditing", { text: "" });
  expect(log.splice(0)).toEqual(["submitted"]);
  emit(t.byID("enter").target, "topKeyPress", { key: "Enter" });
  emit(t.byID("enter").target, "topSubmitEditing", { text: "" });
  expect(log.splice(0)).toEqual([]);
  // The next key press clears it.
  emit(t.byID("enter").target, "topKeyPress", { key: "a" });
  emit(t.byID("enter").target, "topSubmitEditing", { text: "" });
  expect(log.splice(0)).toEqual(["submitted"]);
});

test("<svelte:element this={tag}> draws the host tag of the tag, and one with no host tag fails where it is chosen", async () => {
  const t = await mountFixture("html-misc-fixture.svelte", 616);
  // `h2` is a text, `div` a view; the web's `testID` here is just an attribute.
  expect(t.byID("dynamic").name).toBe("RCTText");
  probe.__htmlMisc.setTag("div");
  await t.settle();
  expect(t.byID("dynamic").name).toBe("RCTView");
  expect(hostTag("h2")).toBe("native-text");
  expect(hostTag("button")).toBe("native-pressable");
  expect(hostTag("native-scroll")).toBe("native-scroll");
  expect(hostTag(undefined)).toBeUndefined();
  expect(hostTag(false)).toBe(false);
  expect(() => hostTag("table")).toThrow('<svelte:element this="table"> has no native equivalent');
  expect(() => hostTag("input")).toThrow("write input as an element of its own");
});

test("the default style of an element is a browser's, under its class and style: bold, italic, underline, monospace, sizes of the font it inherits", async () => {
  const t = await mountFixture("html-ua-fixture.svelte", 617);
  const style = (testID: string) => flat(t.byID(testID).props.style);
  expect(style("b")).toMatchObject({ fontWeight: "700" });
  expect(style("em")).toMatchObject({ fontStyle: "italic" });
  expect(style("u")).toMatchObject({ textDecorationLine: "underline" });
  expect(style("del")).toMatchObject({ textDecorationLine: "line-through" });
  expect(style("s")).toMatchObject({ textDecorationLine: "line-through" });
  expect(style("code")).toMatchObject({ fontFamily: "monospace" });
  expect(style("kbd")).toMatchObject({ fontFamily: "monospace" });
  expect(style("mark")).toMatchObject({ backgroundColor: "#ffff00", color: "#000000" });
  // A factor of the font size it inherits (14 when nothing sets one): small, and a heading, whose own size and class still win.
  expect(style("small")).toMatchObject({ fontSize: 11.2 });
  expect(style("h1")).toMatchObject({ fontSize: 28, fontWeight: "700" });
  expect(style("h1-small")).toMatchObject({ fontSize: 22.4 });
  expect(style("h2")).toMatchObject({ fontSize: 10, fontWeight: "700" });
  expect(style("h3")).toMatchObject({ fontSize: 18, fontWeight: "700" });
  // Of an inherited 20: h4 is 1, h6 0.67, sub 0.75, and a pre is monospace.
  expect(style("h4")).toMatchObject({ fontSize: 20, fontWeight: "700" });
  expect(style("h6")).toMatchObject({ fontSize: 13.4 });
  expect(style("sub")).toMatchObject({ fontSize: 15 });
  expect(style("pre")).toMatchObject({ fontFamily: "monospace", fontSize: 20 });
  // A link has no default: its color is the app's.
  expect(style("a")).not.toHaveProperty("color");
  // The text of a paragraph does not take the bold of what is inside it.
  expect(style("p")).toEqual({});
});
