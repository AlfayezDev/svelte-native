import { afterAll, afterEach, beforeAll, expect, jest, test } from "bun:test";
import { resolve } from "node:path";
import { htmlTextInput } from "../../src/html-input.ts";
import { hostBind, hostClick, hostHref, hostInputEvent, hostKeyEvent, hostSource, hostStyleProps, hostSubmit, hostTag, hostWebClickSpread, hostWebSpread } from "../../src/renderer.ts";
import { type FakeNode, type Module, all, emit, fake, flat, host, load, settle, textOf } from "../html-harness.ts";
import { touchSender } from "../gestures/support/touches.ts";
import { type GlobalSnapshot, snapshotGlobals } from "../support/globals.ts";
import { createProject } from "../support/project.ts";

/**
 * A page written with HTML elements and nothing imported from the package (`html-page-fixture.svelte`), lowered as the Metro transformer lowers it (`lowerPrimitives` with `html`, for the
 * files `lowersHtml` names), mounted under a real `<Router>` on a fake Fabric host: the host tree and its props are what the platform would be given, and a press, an edit and a
 * link go through the host's own event path.
 */
type Page = { snapshot(): { name: string; agreed: boolean; showDialog: boolean; boxed: boolean; sectioned: boolean }; setDialog(value: boolean): void; setName(value: string): void; toggleSecret(): void };
const globals = globalThis as unknown as { __htmlLog: (entry: string) => void; __htmlPage: Page; __opened?: string[] };

// What the pages of this file leave on the global object (`__log`, `__api`, `__htmlLog`...) goes when the file is done; the fake host the harness installs is put back after each test.
let world: GlobalSnapshot;
beforeAll(() => { world = snapshotGlobals(); });
afterAll(() => world.restore());

/** A page of this file: `components/fixtures/<name>`. The harness takes a path. */
const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);

let surface = 500;
let started: { m: Module; tag: number } | undefined;
async function mount() {
  const m = await load();
  jest.useFakeTimers();
  host.roots = {};
  (globalThis as unknown as { __log: string[] }).__log = [];
  globals.__opened = [];
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, {}) as { current(): string };
  started = { m, tag };
  await settle(m);
  const nodes = () => all(host.roots[tag] ?? []);
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

test("a link that is all of its view is a pressable view with the role link, and one among the text of a paragraph goes to the router when it is pressed", async () => {
  const t = await mount();
  expect(t.byID("go").props.accessibilityRole).toBe("link");
  expect(t.byID("go").name).toBe("RCTView");
  emit(t.byID("terms").target, "topClick", {});
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

test("the text of a div reaches the native text as the text of a Text written the same way does, whitespace included (tests/components/text-whitespace.test.ts)", async () => {
  const m = await load(fixture("html-text-fixture.svelte"));
  host.roots = {};
  const app = m.startSurface(601, m.Fixture, {}) as { rename(next: string): void };
  const texts = textsOf(host.roots[601] ?? []);
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
  const after = textsOf(host.roots[601] ?? []);
  expect(after[2]).toEqual(["Hello Grace,\n    welcome   back."]);
  expect(after[8]).toEqual(["Grace"]);
});

test("a link has the platform open another site or app, ignores a hash, and needs a router for a screen of the app", async () => {
  const m = await load(fixture("html-link-fixture.svelte"));
  host.roots = {};
  globals.__opened = [];
  m.startSurface(602, m.Fixture, {});
  const press = (testID: string) => emit(all(host.roots[602] ?? []).find((node) => node.props.testID === testID)?.target, "topClick", {});
  press("mail");
  press("net");
  press("hash");
  expect(globals.__opened).toEqual(["mailto:ada@example.com", "https://example.com/x"]);
  expect(() => press("screen")).toThrow('<a href="/settings"> goes to a screen of the app, which needs a router above it');
});

test("what the lowered code calls: a source from a string or an asset, the props of a type, the event of an input, a bind that nulls only its own handle, the href of the element pressed, what a spread's onclick becomes", () => {
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
  expect(hostWebClickSpread({ onclick: press, onPress: go, id: "a" })).toEqual({ onHtmlClick: press, onPress: go, id: "a" });
  expect(hostHref(undefined)).toBeUndefined();
  expect(hostHref({ currentTarget: {} })).toBeUndefined();
});
function go() {}

test("a <pre> keeps its spaces and newlines, a <br> is a newline of its text, and an <hr> is a hairline that its class or style can change", async () => {
  const m = await load(fixture("html-text-fixture.svelte"));
  host.roots = {};
  m.startSurface(604, m.Fixture, {});
  const texts = textsOf(host.roots[604] ?? []);
  // The newline right after `<pre>` is not part of the text, as in HTML; the rest is as written, around a nested element.
  expect(texts[10]).toEqual(["  line one\n    ", "bold", "  and  `ticks` \\ back\n"]);
  expect(texts[11]).toEqual(["a\nb"]);
  const rules = all(host.roots[604] ?? []).filter((node) => node.props.testID === "rule" || node.props.testID === "rule-own");
  expect(flat(rules[0]?.props.style)).toEqual({ height: 0.5, backgroundColor: "#c7c7cc", marginVertical: 8 });
  // The element's own style is over the default, key by key.
  expect(flat(rules[1]?.props.style)).toEqual({ height: 4, backgroundColor: "#c7c7cc", marginVertical: 0 });
});

test("a single-line input sends no line height, its own or inherited, so its text stays centred (iOS laid it out above the text); a textarea keeps it", async () => {
  const m = await load(fixture("html-input-lineheight-fixture.svelte"));
  host.roots = {};
  m.startSurface(611, m.Fixture, {});
  await settle(m);
  const byTest = (id: string) => all(host.roots[611] ?? []).find((node) => node.props.testID === id);
  for (const id of ["own", "inherited"]) {
    const input = byTest(id);
    expect(input?.name).toBe("AndroidTextInput");
    const style = flat(input?.props.style);
    expect(style.lineHeight).toBeUndefined();
    expect(style.fontSize).toBe(18);
  }
  const area = byTest("area");
  expect(flat(area?.props.style).lineHeight).toBe(27);
});

test("a submit button anywhere below a <form> (in a component of its own too) and Enter in a single-line input make the form hear submit; preventDefault on the click stops it", async () => {
  const m = await load(fixture("html-form-fixture.svelte"));
  host.roots = {};
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  m.startSurface(603, m.Fixture, {});
  const node = (testID: string) => {
    const found = all(host.roots[603] ?? []).find((candidate) => candidate.props.testID === testID);
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
  await load(fixture("html-form-fixture.svelte"));
  expect(host.warnings).toEqual([`${fixture("html-form-fixture.svelte")}:26:27 onmouseover on <div> never runs on a device: a native element has no "mouseover" event (the web still calls it)`]);
});

test("onkeydown and onkeyup of an input are its key press, with the key", async () => {
  const m = await load(fixture("html-form-fixture.svelte"));
  host.roots = {};
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  m.startSurface(605, m.Fixture, {});
  const keyed = all(host.roots[605] ?? []).find((candidate) => candidate.props.testID === "keyed");
  emit(keyed?.target, "topKeyPress", { key: "Enter" });
  expect(log).toEqual(["down Enter", "up Enter"]);
});

test("style as a string is converted when the file is built, and style:property directives follow their values", async () => {
  const m = await load(fixture("html-form-fixture.svelte"));
  host.roots = {};
  m.startSurface(606, m.Fixture, {});
  const byID = (testID: string) => {
    const found = all(host.roots[606] ?? []).find((candidate) => candidate.props.testID === testID);
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
  const m = await load(fixture("html-inherit-fixture.svelte"));
  host.roots = {};
  m.startSurface(607, m.Fixture, {});
  const byID = (testID: string) => {
    const found = all(host.roots[607] ?? []).find((candidate) => candidate.props.testID === testID);
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
  const m = await load(fixture("html-inherit-fixture.svelte"));
  host.roots = {};
  m.startSurface(608, m.Fixture, {});
  const byID = (testID: string) => {
    const found = all(host.roots[608] ?? []).find((candidate) => candidate.props.testID === testID);
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
  // `display` is what the class compiler writes for it: the native one, and the keyword that was used (the host reads which of a block and a flex container the element is).
  expect(hostStyleProps({ display: "block" })).toEqual({ display: "flex", htmlDisplay: "block" });
  expect(hostStyleProps({ display: "inline-flex" })).toEqual({ display: "flex", htmlDisplay: "inline-flex" });
  expect(hostStyleProps({ display: "none" })).toEqual({ display: "none", htmlDisplay: "none" });
});

test("an input's own props go over what its type implies, but one that is undefined does not undo it", () => {
  expect(htmlTextInput({ type: "password" }).props).toMatchObject({ secureTextEntry: true, autoComplete: "password" });
  expect(htmlTextInput({ type: "password", secureTextEntry: undefined, autocomplete: undefined }).props).toMatchObject({ secureTextEntry: true, autoComplete: "password" });
  expect(htmlTextInput({ type: "password", secureTextEntry: false }).props.secureTextEntry).toBe(false);
  expect(htmlTextInput({ type: "email", keyboardType: "default" }).props).toMatchObject({ keyboardType: "default", autoComplete: "email" });
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

const probe = globalThis as unknown as { __log: string[]; __focused: string[]; __htmlRun: { setN(value: number): void }; __htmlBind: { reverse(): void; remove(id: number): void; show(): void; tags(): (number | null)[] }; __htmlMisc: { setCss(value: string): void; setTag(value: string): void; amount(): number; note(): string } };

/** A fixture on a surface of its own (no router), with a finder by `testID`. */
async function mountFixture(path: string, surface: number) {
  const m = await load(path);
  host.roots = {};
  globals.__opened = [];
  probe.__log = [];
  m.startSurface(surface, m.Fixture, {});
  await settle(m);
  const byID = (testID: string) => {
    const found = all(host.roots[surface] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  return { m, byID, nodes: () => all(host.roots[surface] ?? []), settle: () => settle(m) };
}
/** The names of the children of a node, with a text's string: the shape of what the platform is given. */
const shape = (node: FakeNode): string[] => node.children.map((child) => (child.name === "RCTRawText" ? `"${child.props.text}"` : `${child.name}(${textOf(child)})`));

/**
 * A fixture written in the test: `source` is the page (it calls `globalThis.__api = { ... }` for what the test drives), `files` the components it imports. It is lowered and mounted as a file of an app is.
 * The page is built, and its directory removed, before the page is mounted.
 */
async function mountSource(source: string, files: Record<string, string> = {}) {
  const m = await (async () => {
    using project = createProject({ ...files, "Fixture.svelte": source }, "svelte-native-html-source-");
    return await load(project.path("Fixture.svelte"));
  })();
  host.roots = {};
  globals.__opened = [];
  probe.__log = [];
  (globalThis as { __api?: unknown }).__api = undefined;
  const tag = ++surface;
  m.startSurface(tag, m.Fixture, {});
  await settle(m);
  const nodes = () => all(host.roots[tag] ?? []);
  const byID = (testID: string) => {
    const found = nodes().find((candidate) => candidate.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  started = { m, tag };
  return { m, byID, nodes, settle: () => settle(m), api: (globalThis as { __api: Record<string, (...args: unknown[]) => unknown> }).__api, tree: () => host.roots[tag] ?? [] };
}
/** What is wrong with the text of a tree of the platform, if anything: a span outside a text, a text in a text, a string outside a text. React Native's own rules. */
function textFaults(nodes: FakeNode[], inText = false): string[] {
  const faults: string[] = [];
  for (const node of nodes) {
    if (node.name === "RCTRawText" && !inText) faults.push(`a string outside a text: ${node.props.text}`);
    if (node.name === "RCTVirtualText" && !inText) faults.push(`a span outside a text: ${node.props.testID ?? textOf(node)}`);
    if (node.name === "RCTText" && inText) faults.push(`a text in a text: ${node.props.testID ?? textOf(node)}`);
    faults.push(...textFaults(node.children, node.name === "RCTText" || node.name === "RCTVirtualText"));
  }
  return faults;
}

test("text that reaches an HTML view through children, a snippet or a block is drawn, as one line with the inline elements, and a View keeps React Native's rule", async () => {
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (message: unknown) => { warnings.push(message); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  let t: Awaited<ReturnType<typeof mountFixture>>;
  try {
    t = await mountFixture(fixture("html-run-fixture.svelte"), 610);
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
    const t = await mountFixture(fixture("html-bind-fixture.svelte"), 611);
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
  const t = await mountFixture(fixture("html-bind-fixture.svelte"), 612);
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
  const t = await mountFixture(fixture("html-wrap-fixture.svelte"), 613);
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

test("a link without an href does nothing, a style that is text when the app runs is parsed, a number is the text of its input, and an input's event has its name, id and type", async () => {
  const t = await mountFixture(fixture("html-misc-fixture.svelte"), 614);
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
  const t = await mountFixture(fixture("html-misc-fixture.svelte"), 615);
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
  const t = await mountFixture(fixture("html-misc-fixture.svelte"), 616);
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
  const t = await mountFixture(fixture("html-ua-fixture.svelte"), 617);
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

// --- Round 4: the text context of an element changes, flex containers, runs that are kept ---

const wrapper = { "W.svelte": `<script>let { label = "", children, ...rest } = $props();</script><div {...rest}>{label}{@render children?.()}</div>` };

test("an element that is a span of a run and then a text of its own (or the other way) is made again as the other component, and its ref hears null and then the new handle", async () => {
  const t = await mountSource(`<script>
    let on = $state(false);
    let el = $state(null);
    globalThis.__api = { set: (value) => { on = value; }, tag: () => el?.tag };
  </script>
  <div testID="d">{#if on}Hi {/if}<b testID="b" bind:this={el}>x</b></div>
  <div testID="d2">{#if on}Hi {/if}<i testID="i" ref={(handle) => globalThis.__log.push(handle ? \`handle \${handle.tag}\` : "null")}>y</i></div>`);
  const state = () => ({ name: t.byID("b").name, d: t.byID("d").children.map((child) => `${child.name}(${textOf(child)})`), tag: t.byID("b").tag, ref: t.api.tag() });
  const alone = state();
  const first = t.byID("i");
  expect(alone).toMatchObject({ name: "RCTText", d: ["RCTText(x)"], ref: alone.tag });
  t.api.set(true);
  await t.settle();
  // `Hi` and the bold are one text now, and the bold is a span of it: another component, so another node, which the ref has (Svelte trims the edge of a block: no space between them).
  const together = state();
  expect(together).toMatchObject({ name: "RCTVirtualText", d: ["RCTText(Hix)"], ref: together.tag });
  expect(together.tag).not.toBe(alone.tag);
  // A `ref` callback hears `null` for the node that is gone, and then gets the handle of the new one.
  expect(probe.__log).toEqual([`handle ${first.tag}`, "null", `handle ${t.byID("i").tag}`]);
  expect(textFaults(t.tree())).toEqual([]);
  t.api.set(false);
  await t.settle();
  expect(state()).toMatchObject({ name: "RCTText", d: ["RCTText(x)"] });
  expect(state().ref).toBe(state().tag);
  expect(textFaults(t.tree())).toEqual([]);
  t.api.set(true);
  await t.settle();
  expect(state().name).toBe("RCTVirtualText");
  expect(textFaults(t.tree())).toEqual([]);
});

test("the same through a component: a label that comes and goes beside the children it is given", async () => {
  const t = await mountSource(`<script>
    import W from "./W.svelte";
    let label = $state("");
    globalThis.__api = { label: (value) => { label = value; } };
  </script>
  <W testID="d" {label}><span testID="sp">x</span></W>`, wrapper);
  expect(t.byID("sp").name).toBe("RCTText");
  t.api.label("Name: ");
  await t.settle();
  expect(textOf(t.byID("d"))).toBe("Name: x");
  expect(t.byID("sp").name).toBe("RCTVirtualText");
  expect(textFaults(t.tree())).toEqual([]);
  t.api.label("");
  await t.settle();
  expect(t.byID("sp").name).toBe("RCTText");
  expect(textFaults(t.tree())).toEqual([]);
});

test("a span that is a text of its own again still has the text style of the elements above it, and keeps its own", async () => {
  const t = await mountSource(`<script>
    let on = $state(true);
    globalThis.__api = { set: (value) => { on = value; } };
  </script>
  <div class="text-lg" testID="d">{#if on}Hi {/if}<b testID="b" class="text-white">x</b></div>`);
  // A span takes what its text has: its own style only.
  expect(flat(t.byID("b").props.style)).toMatchObject({ fontWeight: "700", color: "#ffffff" });
  expect(flat(t.byID("b").props.style).fontSize).toBeUndefined();
  t.api.set(false);
  await t.settle();
  // A text of its own takes the style of the div, under its own.
  expect(flat(t.byID("b").props.style)).toMatchObject({ fontSize: 18, fontWeight: "700", color: "#ffffff" });
  t.api.set(true);
  await t.settle();
  expect(flat(t.byID("b").props.style).fontSize).toBeUndefined();
});

test("what is asked of a handle before its view exists is not kept for an element that never gets one, and is done in the order it was asked, across handles", async () => {
  const done: string[] = [];
  const dispatch = fake.dispatchCommand;
  const measure = fake.measure;
  fake.dispatchCommand = ((node: FakeNode, name: string) => { done.push(`${name} ${node.props.testID}`); }) as never;
  fake.measure = ((node: FakeNode) => { done.push(`measure ${node.props.testID}`); }) as never;
  try {
    const t = await mountSource(`<script>
      import { flushSync, onMount } from "svelte";
      let show = $state(false);
      let flash = $state(false);
      let a = $state(null); let b = $state(null);
      globalThis.__api = { show: () => { show = true; }, flash: () => { flash = true; flushSync(); flash = false; flushSync(); } };
      $effect(() => { if (a && b) { a.focus(); b.focus(); a.measure(() => {}); } });
    </script>
    {#if show}<div testID="a" bind:this={a}>a</div><div testID="b" bind:this={b}>b</div>{/if}
    {#if flash}<div testID="late" ref={(handle) => { handle?.focus(); handle?.measure(() => {}); }}>x</div>{/if}`);
    const waiting = () => (globalThis as unknown as { __svelteFabric: { stats(): { waiting: number } } }).__svelteFabric.stats().waiting;
    for (let round = 0; round < 3; round++) { t.api.flash(); await t.settle(); }
    // Three elements that came and went in one flush left nothing waiting for a view.
    expect(waiting()).toBe(0);
    expect(done).toEqual([]);
    t.api.show();
    await t.settle();
    expect(done).toEqual(["focus a", "focus b", "measure a"]);
    expect(waiting()).toBe(0);
  } finally {
    fake.dispatchCommand = dispatch;
    fake.measure = measure;
  }
});

test("a flex container's children are its items: each element, and each run of text; a block container's are a line", async () => {
  const t = await mountSource(`<script>
    let price = $state(5);
    globalThis.__api = {};
  </script>
  <div testID="row" class="flex-row justify-between"><span testID="l">Name</span><span testID="r">\${price}</span></div>
  <button testID="btn" class="flex-row items-center gap-2"><span testID="ic">★</span><span testID="lb">Label</span></button>
  <div testID="plain"><span>a</span><span>b</span></div>
  <div testID="flex-total" class="flex-row gap-2">Total: <span>5</span></div>
  <div testID="block-total">Total: <span>5</span></div>
  <div testID="explicit" class="flex"><b>x</b> <i>y</i></div>
  <div testID="blocky" class="block"><b>x</b> <i>y</i></div>
  <label testID="label" class="block">Name <span>*</span></label>
  <div testID="stack">a <span class="block" testID="blk">b</span> c</div>
  <div testID="inl">a <span class="inline" testID="in">b</span> c</div>
  <ul class="flex-row gap-2"><li testID="li1">one</li><li testID="li2">two</li></ul>`);
  expect(shape(t.byID("row"))).toEqual(["RCTText(Name)", "RCTText($5)"]);
  expect(flat(t.byID("row").props.style)).toMatchObject({ flexDirection: "row", justifyContent: "space-between" });
  expect(shape(t.byID("btn"))).toEqual(["RCTText(★)", "RCTText(Label)"]);
  expect(t.byID("l").name).toBe("RCTText");
  // A block container: one line, as before.
  expect(shape(t.byID("plain"))).toEqual(["RCTText(ab)"]);
  // The text between the elements of a flex container is an item of its own, and the whitespace at its edge is not drawn.
  expect(shape(t.byID("flex-total"))).toEqual(["RCTText(Total:)", "RCTText(5)"]);
  expect(shape(t.byID("block-total"))).toEqual(["RCTText(Total: 5)"]);
  // `display: flex` is a flex container; `block` is not one (the class compiler writes `flex` for it, with the keyword that was used beside it).
  expect(shape(t.byID("explicit"))).toEqual(["RCTText(x)", "RCTText(y)"]);
  expect(shape(t.byID("blocky"))).toEqual(["RCTText(x y)"]);
  expect(shape(t.byID("label"))).toEqual(["RCTText(Name *)"]);
  // An element of its own `display` is not in the line: `block` stacks, `inline` flows.
  expect(shape(t.byID("stack"))).toEqual(["RCTText(a)", "RCTText(b)", "RCTText(c)"]);
  expect(shape(t.byID("inl"))).toEqual(["RCTText(a b c)"]);
  expect(textFaults(t.tree())).toEqual([]);
});

test("the layout of a view follows its class: a container that becomes a flex one (or stops being one), and an element that sets its display or stops, are split again", async () => {
  const t = await mountSource(`<script>
    let cls = $state("block");
    let own = $state("");
    globalThis.__api = { cls: (value) => { cls = value; }, own: (value) => { own = value; } };
  </script>
  <div testID="d" class={cls}>a <b>x</b> c</div>
  <div testID="e">a <span testID="s" class={own}>x</span> c</div>`);
  expect(shape(t.byID("d"))).toEqual(["RCTText(a x c)"]);
  t.api.cls("flex");
  await t.settle();
  expect(shape(t.byID("d"))).toEqual(["RCTText(a)", "RCTText(x)", "RCTText(c)"]);
  t.api.cls("block");
  await t.settle();
  expect(shape(t.byID("d"))).toEqual(["RCTText(a x c)"]);
  expect(shape(t.byID("e"))).toEqual(["RCTText(a x c)"]);
  t.api.own("block");
  await t.settle();
  expect(shape(t.byID("e"))).toEqual(["RCTText(a)", "RCTText(x)", "RCTText(c)"]);
  t.api.own("");
  await t.settle();
  expect(shape(t.byID("e"))).toEqual(["RCTText(a x c)"]);
  expect(textFaults(t.tree())).toEqual([]);
});

test("an <a> that is among text is still a pressable span with its own press, in a block container; in a flex container it is an item that presses", async () => {
  const t = await mountSource(`<script>
    globalThis.__api = {};
  </script>
  <p testID="p">See <a testID="in-p" href="https://x.dev/a" onclick={() => globalThis.__log.push("p")}>terms</a> now</p>
  <div testID="block">See <a testID="in-block" href="https://x.dev/a" onclick={() => globalThis.__log.push("block")}>terms</a> now</div>
  <div testID="flex" class="flex-row">See <a testID="in-flex" href="https://x.dev/a" onclick={() => globalThis.__log.push("flex")}>terms</a></div>`);
  for (const id of ["in-p", "in-block"]) {
    expect(t.byID(id).name, id).toBe("RCTVirtualText");
    expect(t.byID(id).props, id).toMatchObject({ accessibilityRole: "link", onClick: true });
  }
  expect(t.byID("in-flex").name).toBe("RCTText");
  expect(t.byID("in-flex").props.onClick).toBe(true);
  for (const id of ["in-p", "in-block", "in-flex"]) emit(t.byID(id).target, "topClick", {});
  expect(probe.__log).toEqual(["p", "block", "flex"]);
});

test("a view rebuilt for a change below it does not clone the runs of text it holds that did not change", async () => {
  const t = await mountSource(`<script>
    let m = $state(0);
    globalThis.__api = { m: (value) => { m = value; } };
  </script>
  <div testID="outer">Header <b>bold</b> and more
    <section><p testID="deep">deep {m}</p></section>
    trailing text <i>it</i>
  </div>`);
  const cloned: string[] = [];
  const names = ["cloneNodeWithNewChildren", "cloneNodeWithNewProps", "cloneNodeWithNewChildrenAndProps"] as const;
  const originals = names.map((name) => fake[name]);
  for (const [index, name] of names.entries()) {
    (fake as Record<string, unknown>)[name] = function (this: unknown, node: FakeNode, ...rest: never[]) { cloned.push(`${name.replace("cloneNodeWith", "")} ${node.name}${node.props.testID ? `#${node.props.testID}` : ""}`); return (originals[index] as (...args: unknown[]) => unknown).call(this, node, ...rest); };
  }
  try {
    t.api.m(1);
    await t.settle();
  } finally {
    for (const [index, name] of names.entries()) (fake as Record<string, unknown>)[name] = originals[index];
  }
  expect(textOf(t.byID("deep"))).toBe("deep 1");
  // The paragraph's string, the paragraph, the section and the div were changed, and nothing else: the two runs of text beside the section were not.
  expect(cloned.filter((entry) => entry.includes("RCTText") || entry.includes("RCTVirtualText"))).toEqual(["NewChildren RCTText#deep"]);
  expect(cloned.filter((entry) => entry.includes("RCTRawText"))).toEqual(["NewProps RCTRawText"]);
  expect(textOf(t.byID("outer").children[0] as FakeNode)).toBe("Header bold and more");
});

test("nested decorations add up, a style that is text beside style: directives is parsed, a dynamic svelte:element is a span in the line, and an undefined prop does not undo the default of an input type", async () => {
  const t = await mountSource(`<script>
    import { TextInput } from "@alfayez/svelte-native/core";
    let css = $state("padding: 4px; color: red");
    let w = $state("10px");
    let tag = $state("b");
    let secure = $state(undefined);
    let el = $state(null);
    globalThis.__api = { css: (value) => { css = value; }, tag: (value) => { tag = value; }, el: () => el?.tag };
  </script>
  <p testID="p"><u testID="u"><s testID="s">x</s></u> and <u testID="plain-u">y</u></p>
  <div testID="styled" style={css} style:width={w}>x</div>
  <div testID="array" style={[{ margin: 2 }, css]}>x</div>
  <div testID="line">a <svelte:element this={tag} testID="dyn" bind:this={el}>b</svelte:element> c</div>
  <div testID="lit">a <svelte:element this="span" testID="lit-span">b</svelte:element> c</div>
  <input testID="pass" type="password" secureTextEntry={secure} />`);
  expect(flat(t.byID("s").props.style).textDecorationLine).toBe("underline line-through");
  expect(flat(t.byID("u").props.style).textDecorationLine).toBe("underline");
  expect(flat(t.byID("plain-u").props.style).textDecorationLine).toBe("underline");
  // The string is parsed with the directives over it, and in an array of styles.
  expect(flat(t.byID("styled").props.style)).toEqual({ padding: 4, color: "red", width: 10 });
  expect(flat(t.byID("array").props.style)).toEqual({ margin: 2, padding: 4, color: "red" });
  t.api.css("margin: 8px");
  await t.settle();
  expect(flat(t.byID("styled").props.style)).toEqual({ margin: 8, width: 10 });
  expect(flat(t.byID("array").props.style)).toEqual({ margin: 8 });
  // An element chosen when the app runs is a span of the line when it is a text that flows, as one written out is, and its ref is the handle.
  expect(shape(t.byID("line"))).toEqual(["RCTText(a b c)"]);
  expect(t.byID("dyn").name).toBe("RCTVirtualText");
  expect(t.api.el()).toBe(t.byID("dyn").tag);
  expect(shape(t.byID("lit"))).toEqual(["RCTText(a b c)"]);
  expect(t.byID("lit-span").name).toBe("RCTVirtualText");
  t.api.tag("div");
  await t.settle();
  expect(shape(t.byID("line"))).toEqual(["RCTText(a)", "RCTView(b)", "RCTText(c)"]);
  // `secureTextEntry={undefined}` leaves what the type says.
  expect(t.byID("pass").props.secureTextEntry).toBe(true);
  expect(textFaults(t.tree())).toEqual([]);
});

// --- Round 5: hidden and inline-flex elements, handles in a ref, a tap on a dynamic element, warnings ---

test("a hidden inline element does not break the line it is in, and an inline-flex or inline-block one is part of it", async () => {
  const t = await mountSource(`<script>
    let cls = $state("hidden");
    globalThis.__api = { cls: (value) => { cls = value; } };
  </script>
  <div testID="hid">a <span class="hidden" testID="gone">x</span> b</div>
  <div testID="sm">Price <span class={cls} testID="sm-span">only on big</span> now</div>
  <div testID="flex-inline">a <span class="inline-flex" testID="f">x</span> b <b class="inline-block">y</b> c</div>
  <div testID="flexrow" class="flex-row">a <span class="hidden" testID="gone2">x</span> b</div>`);
  // The line is one text, and the hidden span is built on its own (a span takes no `display`), with `display: none`.
  expect(shape(t.byID("hid")).filter((entry) => entry.startsWith("RCTText(a"))).toEqual(["RCTText(a  b)"]);
  expect(t.byID("hid").children).toHaveLength(2);
  expect(t.byID("gone").name).toBe("RCTText");
  expect(flat(t.byID("gone").props.style).display).toBe("none");
  // `hidden sm:inline`: hidden it is out of the line, and when it shows it is a span of it.
  expect(shape(t.byID("sm")).filter((entry) => entry.startsWith("RCTText(Price"))).toEqual(["RCTText(Price  now)"]);
  t.api.cls("inline");
  await t.settle();
  expect(shape(t.byID("sm"))).toEqual(["RCTText(Price only on big now)"]);
  expect(t.byID("sm-span").name).toBe("RCTVirtualText");
  t.api.cls("hidden");
  await t.settle();
  expect(t.byID("sm").children).toHaveLength(2);
  expect(t.byID("sm-span").name).toBe("RCTText");
  // inline-flex and inline-block are in the line.
  expect(shape(t.byID("flex-inline"))).toEqual(["RCTText(a x b y c)"]);
  expect(t.byID("f").name).toBe("RCTVirtualText");
  // In a flex container every element is an item, hidden or not.
  expect(shape(t.byID("flexrow")).sort()).toEqual(["RCTText(a)", "RCTText(b)", "RCTText(x)"]);
  expect(textFaults(t.tree())).toEqual([]);
});

test("a ref callback that asks its handle for things in the flush that makes the element again does not reach a view that is not on the screen: it waits for the commit", async () => {
  const order: string[] = [];
  const originals = { measure: fake.measure, dispatchCommand: fake.dispatchCommand, completeRoot: fake.completeRoot };
  fake.measure = ((node: FakeNode, callback: (...args: number[]) => void) => { order.push(`measure ${node.name}#${node.tag}`); callback(1, 2, 3, 4, 5, 6); }) as never;
  fake.dispatchCommand = ((node: FakeNode, name: string) => { order.push(`${name} ${node.name}#${node.tag}`); }) as never;
  fake.completeRoot = ((root: number, set: { children: FakeNode[] }) => { order.push("completeRoot"); originals.completeRoot(root, set); }) as never;
  try {
    const t = await mountSource(`<script>
      let on = $state(false);
      globalThis.__api = { set: (value) => { on = value; } };
    </script>
    <div testID="d">{#if on}Hi {/if}<b testID="b" ref={(handle) => { if (handle) { handle.measure(() => {}); handle.focus(); } }}>x</b></div>`);
    // The first flush: the handle is given before the view exists, and what it is asked waits, so it is after the commit.
    expect(order.indexOf("completeRoot")).toBeLessThan(order.findIndex((entry) => entry.startsWith("measure")));
    order.length = 0;
    t.api.set(true);
    await t.settle();
    const tag = t.byID("b").tag;
    // Made again as a span: its new view is committed, and then it is asked.
    expect(order).toEqual(["completeRoot", `measure RCTVirtualText#${tag}`, `focus RCTVirtualText#${tag}`]);
  } finally {
    Object.assign(fake, originals);
  }
});

test("the handle an element gave out follows its tag when it is made again", async () => {
  const t = await mountSource(`<script>
    let on = $state(false);
    globalThis.__handles = [];
    globalThis.__api = { set: (value) => { on = value; } };
  </script>
  <div testID="d">{#if on}Hi {/if}<i testID="i" ref={(handle) => { if (handle) globalThis.__handles.push(handle); }}>y</i></div>`);
  const handles = (globalThis as unknown as { __handles: { tag: number }[] }).__handles;
  const before = t.byID("i").tag;
  expect(handles.map((handle) => handle.tag)).toEqual([before]);
  t.api.set(true);
  await t.settle();
  const after = t.byID("i").tag;
  expect(after).not.toBe(before);
  // The first handle was told it is gone (`ref(null)`), and still reads the element's tag, as the second does.
  expect(handles.map((handle) => handle.tag)).toEqual([after, after]);
});

test("a tap on an element chosen when the app runs presses it: onclick and on:click are onPress, as on a div", async () => {
  jest.useFakeTimers();
  const t = await mountSource(`<script>
    let tag = $state("div");
    globalThis.__api = { tag: (value) => { tag = value; } };
  </script>
  <svelte:element this={tag} testID="a" onclick={() => globalThis.__log.push("onclick")}>one</svelte:element>
  <svelte:element this={tag} testID="b" on:click={() => globalThis.__log.push("on:click")}>two</svelte:element>`);
  const touch = touchSender(emit);
  const tap = (testID: string) => { const { target } = t.byID(testID); touch(target, "topTouchStart"); touch(target, "topTouchEnd"); jest.advanceTimersByTime(200); };
  for (const kind of ["div", "span"]) {
    t.api.tag(kind);
    await t.settle();
    expect(t.byID("a").name).toBe(kind === "div" ? "RCTView" : "RCTText");
    probe.__log.length = 0;
    tap("a");
    tap("b");
    expect(probe.__log, kind).toEqual(["onclick", "on:click"]);
  }
});

test("development says once that the keys of a flex container do nothing on a text, and not for a div, a block or an item's keys", async () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    const t = await mountSource(`<script>
      let n = $state(0);
      globalThis.__api = { n: (value) => { n = value; } };
    </script>
    <p class="flex-row gap-2">{n} text</p>
    <h2 class="flex">heading</h2>
    <p class="block" style={{ flexGrow: 1 }}>fine</p>
    <div class="flex-row gap-2">a <span>b</span></div>
    <span class="block">fine too</span>`);
    t.api.n(1);
    await t.settle();
    t.api.n(2);
    await t.settle();
    expect(warnings.filter((message) => message.includes("does nothing"))).toEqual([
      expect.stringContaining("flexDirection, gap on a text"),
      expect.stringContaining("display: flex on a text"),
    ]);
  } finally {
    delete (globalThis as { __DEV__?: boolean }).__DEV__;
    console.warn = warn;
  }
});

test("style:display with a value a device has no layout for is left out with a warning, as the class compiler reports it", () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    expect(hostStyleProps({ display: "grid", color: "red" })).toEqual({ color: "red" });
    expect(hostStyleProps({ display: "table" })).toEqual({});
  } finally {
    delete (globalThis as { __DEV__?: boolean }).__DEV__;
    console.warn = warn;
  }
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain("display: grid has no React Native equivalent");
  expect(hostStyleProps({ display: "inline-block" })).toEqual({ display: "flex", htmlDisplay: "inline-block" });
});
