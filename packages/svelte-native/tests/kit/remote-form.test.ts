// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// The native form: what `fields.x.as(type)` gives a native input, what is sent, and the state around a submission. No server: a preflight schema stops
// every submission before the request, so what the schema is given is what would have been sent (the round trips are in remote-e2e.test.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { base64Decode, base64Encode, makeFinalizationRegistry, missingGlobals, releaseNow, setSweepLifecycle, sweepRegistry, sweepTimerRunning, WeakRefFallback } from "../../src/remote/environment.ts";
import { loadClient } from "../remote-harness.ts";
import { type GlobalSnapshot, snapshotGlobals } from "../support/globals.ts";

// What the client bundles and their stand-ins leave on the global object (`__remoteAppState`, `__opened`, `__expoConfig`...) goes when the file is done.
let world: GlobalSnapshot;
beforeAll(() => { world = snapshotGlobals(); });
afterAll(() => world.restore());

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: Record<string, any>;
beforeAll(async () => {
  m = await loadClient(`
    export * from "../src/remote/index.ts";
    export { form } from "../src/remote/runtime.ts";
    export { serialize_binary_form as serializeBinary } from "@sveltejs/kit/src/runtime/form-utils.js";
  `);
});
// A host, and a fetch that fails the test: every submission here stops at a preflight schema, so nothing may be sent.
beforeEach(() => { m.configureRemote({ origin: "https://a.example", fetch: async () => { throw new Error("a request that the preflight should have stopped"); } }); });
afterEach(() => { m.resetRemoteConfig(); });

/** A form whose submissions stop at a preflight schema that records the data. */
function recording() {
  const form = m.form("h/signup");
  const sent: any[] = [];
  form.preflight({ "~standard": { version: 1, vendor: "test", validate: (data: any) => { sent.push(data); return { issues: [{ message: "stop", path: ["stop"] }] }; } } });
  return { form, sent, submit: async () => { await form.submit(); return sent.at(-1); } };
}

describe("fields.x.as(type)", () => {
  test("text-like types are a TextInput's props, with the keyboard the type asks for", () => {
    const { fields } = m.form("h/f");
    expect(Object.keys(fields.a.as("text")).toSorted()).toEqual(["onBlur", "onChangeText", "ref", "value"]);
    expect(fields.a.as("email")).toMatchObject({ keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false, textContentType: "emailAddress" });
    expect(fields.a.as("password")).toMatchObject({ secureTextEntry: true, autoCapitalize: "none" });
    expect(fields.a.as("tel")).toMatchObject({ keyboardType: "phone-pad" });
    expect(fields.a.as("url")).toMatchObject({ keyboardType: "url" });
    expect(fields.a.as("search")).toMatchObject({ returnKeyType: "search" });
    for (const type of ["number", "range"]) expect(fields.a.as(type)).toMatchObject({ keyboardType: "decimal-pad", inputMode: "decimal" });
    for (const type of ["date", "time", "datetime-local", "month", "week", "color", "textarea"]) expect(fields.a.as(type).value).toBe("");
  });
  test("the value is live, and typing is an edit: dirty, but touched only once the input is left", () => {
    const { fields } = m.form("h/f");
    const name = fields.name.as("text");
    expect(name.value).toBe("");
    expect(fields.name.dirty()).toBe(false);
    name.onChangeText("Ada");
    expect([name.value, fields.name.value(), fields.name.dirty(), fields.name.touched()]).toEqual(["Ada", "Ada", true, false]);
    name.onBlur();
    expect(fields.name.touched()).toBe(true);
    // set() from code is an edit as well, and shows in the props.
    fields.name.set("Grace");
    expect(name.value).toBe("Grace");
    // A default until the field is edited.
    expect(fields.title.as("text", "Dr").value).toBe("Dr");
  });
  test("a number keeps the text it is typed as and is a number to the form", () => {
    const { fields } = m.form("h/f");
    const age = fields.age.as("number");
    age.onChangeText("1");
    age.onChangeText("17.");
    expect([age.value, fields.age.value()]).toEqual(["17.", 17]);
    age.onChangeText("17.5");
    expect([age.value, fields.age.value()]).toEqual(["17.5", 17.5]);
    age.onChangeText("");
    expect([age.value, fields.age.value()]).toEqual(["", undefined]);
    // Text that is not a number is not a number (and not the number it starts with).
    age.onChangeText("12abc");
    expect([age.value, fields.age.value()]).toEqual(["12abc", Number.NaN]);
    age.onChangeText("abc");
    expect(fields.age.value()).toBeNaN();
    fields.age.set(30);
    expect(age.value).toBe("30");
  });
  test("checkbox and radio are a Switch's props", () => {
    const { fields } = m.form("h/f");
    const agree = fields.agree.as("checkbox");
    expect(Object.keys(agree).toSorted()).toEqual(["onBlur", "onValueChange", "ref", "value"]);
    expect(agree.value).toBe(false);
    agree.onValueChange(true);
    expect([agree.value, fields.agree.value()]).toEqual([true, true]);
    agree.onValueChange(false);
    expect([agree.value, fields.agree.value()]).toEqual([false, false]);
    // checked by default until it is edited
    expect(fields.news.as("checkbox", true).value).toBe(true);
    fields.news.as("checkbox", true).onValueChange(false);
    expect(fields.news.as("checkbox", true).value).toBe(false);

    const small = fields.size.as("radio", "s");
    const large = fields.size.as("radio", "l");
    expect([small.value, large.value]).toEqual([false, false]);
    large.onValueChange(true);
    expect([small.value, large.value, fields.size.value()]).toEqual([false, true, "l"]);
    small.onValueChange(true);
    expect([small.value, large.value, fields.size.value()]).toEqual([true, false, "s"]);
    // Turning a radio off does not unselect it.
    small.onValueChange(false);
    expect(fields.size.value()).toBe("s");

    const kit = fields.topics.as("checkbox", "kit");
    const svelte = fields.topics.as("checkbox", "svelte");
    kit.onValueChange(true);
    svelte.onValueChange(true);
    expect(fields.topics.value()).toEqual(["kit", "svelte"]);
    kit.onValueChange(false);
    expect([fields.topics.value(), kit.value, svelte.value]).toEqual([["svelte"], false, true]);
  });
  test("select, hidden and submit", async () => {
    const { form, submit } = recording();
    const { fields } = form;
    const picker = fields.color.as("select", "red");
    expect([picker.value, picker.multiple]).toEqual(["red", false]);
    picker.onValueChange("blue");
    expect(fields.color.value()).toBe("blue");
    const many = fields.colors.as("select multiple");
    expect(many.multiple).toBe(true);
    many.onValueChange(["a", "b"]);
    expect(fields.colors.value()).toEqual(["a", "b"]);

    fields.token.as("hidden", "abc");
    const save = fields.intent.as("submit", "save");
    expect(save.value).toBe("save");
    const data = await submit();
    expect(data).toMatchObject({ color: "blue", colors: ["a", "b"], token: "abc" });
    // The submit button's value is part of the data of the submission it starts.
    save.onPress();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fields.intent.value()).toBe("save");
  });
  test("nested paths and array items", async () => {
    const { form, submit } = recording();
    form.fields.address.city.as("text").onChangeText("Riyadh");
    form.fields.items[0].name.as("text").onChangeText("first");
    form.fields.items[1].qty.as("number").onChangeText("3");
    expect(await submit()).toEqual({ address: { city: "Riyadh" }, items: [{ name: "first" }, { qty: 3 }] });
  });
  test("what is sent: rendered text fields as an empty string, rendered numbers as undefined, keyed forms with their key", async () => {
    const { form, submit } = recording();
    form.fields.name.as("text");
    form.fields.age.as("number");
    form.fields.agree.as("checkbox");
    const data = await submit();
    expect(Object.keys(data).toSorted()).toEqual(["age", "name"]);
    expect(data).toEqual({ name: "", age: undefined });
    form.fields.name.set("Ada");
    expect((await submit()).name).toBe("Ada");
    const keyed = m.form("h/signup").for("k-1");
    const sent: any[] = [];
    keyed.preflight({ "~standard": { version: 1, vendor: "test", validate: (value: any) => { sent.push(value); return { issues: [{ message: "stop", path: [] }] }; } } });
    keyed.fields.name.set("x");
    await keyed.submit();
    expect(sent[0]).toEqual({ name: "x", id: "k-1" });
  });
  test("file fields take Files, keep them as given, reset, and refuse anything else (a picker's { uri })", async () => {
    const { form, submit } = recording();
    const single = form.fields.photo.as("file");
    const many = form.fields.attachments.as("file multiple");
    const file = new File([new Uint8Array([0, 255, 42])], "photo.png", { type: "image/png" });
    single.onValueChange(file);
    many.onValueChange([file]);
    expect(single.value).toBe(file);
    expect(form.fields.photo.dirty()).toBe(true);
    const copy = many.value;
    copy.length = 0;
    expect(many.value).toEqual([file]);
    const data = await submit();
    expect(data.photo).toBe(file);
    expect(data.attachments).toEqual([file]);
    expect(() => single.onValueChange({ uri: "file:///private/photo.png" })).toThrow(/give a `File`/);
    expect(() => single.onValueChange(new Blob(["no name"]))).toThrow(/give a `File`/);
    expect(() => many.onValueChange([file, "file:///photo.png"])).toThrow(/give an array of `File`s/);
    single.onValueChange(undefined);
    expect(single.value).toBeUndefined();
    form.reset();
    expect(many.value).toEqual([]);
  });
  test("SvelteKit's binary serialization of files: their metadata in the header, their bytes after it, the smaller first", async () => {
    const large = new File([new Uint8Array([1, 0, 255])], "large.bin", { lastModified: 123 });
    const small = new File([new Uint8Array([42])], "small.bin", { lastModified: 456 });
    const blob = m.serializeBinary({ files: [large, small] }, {}).blob;
    expect(blob).toBeInstanceOf(Blob); // the platform's: the files' bytes are not copied into JavaScript
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(1, true);
    const offsetsLength = view.getUint16(5, true);
    const header = new TextDecoder().decode(bytes.subarray(7, 7 + headerLength));
    const offsets = new TextDecoder().decode(bytes.subarray(7 + headerLength, 7 + headerLength + offsetsLength));
    expect(header).toContain("large.bin");
    expect(header).toContain("small.bin");
    expect(JSON.parse(offsets)).toEqual([1, 0]);
    expect([...bytes.subarray(7 + headerLength + offsetsLength)]).toEqual([42, 1, 0, 255]);
  });
  test("image submit buttons and unknown types are refused", () => {
    const { fields } = m.form("h/f");
    expect(() => fields.photo.as("image")).toThrow(/Image submit buttons/);
    expect(() => fields.photo.as("datetime")).toThrow(/not a field type a native form knows/);
  });
});

describe("state around a submission", () => {
  test("failed submit focuses the first mounted field with an error in render order", async () => {
    const form = m.form("h/focus");
    const focused: string[] = [];
    form.fields.first.as("text").ref({ focus: () => focused.push("first") });
    form.fields.second.as("text").ref({ focus: () => focused.push("second") });
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [{ message: "second", path: ["second"] }, { message: "first", path: ["first"] }] }) } });
    await form.validate({ preflightOnly: true, all: true });
    expect(focused).toEqual([]); // Background validation must not steal focus.
    expect(await form.submit()).toBe(false);
    expect(focused).toEqual(["first"]);
    expect(form.pending).toBe(0);
  });
  test("failed submit skips detached and non-focusable hosts", async () => {
    const form = m.form("h/focus");
    const focused: string[] = [];
    const first = form.fields.first.as("text");
    first.ref({ focus: () => focused.push("detached") });
    first.ref(null);
    form.fields.second.as("text").ref({});
    form.fields.third.as("text").ref({ focus: () => focused.push("third") });
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => ({ issues: ["first", "second", "third"].map((name) => ({ message: name, path: [name] })) }) } });
    await form.submit();
    expect(focused).toEqual(["third"]);
  });
  test("a disappearing native focus handle does not turn validation into a transport error", async () => {
    const form = m.form("h/focus");
    form.fields.first.as("text").ref({ focus: () => { throw new Error("view gone"); } });
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [{ message: "required", path: ["first"] }] }) } });
    expect(await form.submit()).toBe(false);
    expect(form.error).toBeUndefined();
    expect(form.pending).toBe(0);
  });
  test("reset during submit preflight clears errors and prevents stale focus or sending", async () => {
    const form = m.form("h/reset-preflight");
    let finish!: (result: unknown) => void;
    let started!: () => void;
    let focused = false;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    form.fields.name.as("text").ref({ focus: () => { focused = true; } });
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => { started(); return new Promise((resolve) => { finish = resolve; }); } } });
    const submission = form.submit();
    await ready;
    form.reset();
    finish({ issues: [{ message: "stale", path: ["name"] }] });
    expect(await submission).toBe(false);
    expect(form.fields.name.issues()).toBeUndefined();
    expect(form.submitted).toBe(false);
    expect(focused).toBe(false);
    expect(form.pending).toBe(0);
  });
  test("reset during a submission's preflight that then passes: nothing is sent", async () => {
    const form = m.form("h/reset-pass");
    let finish!: (result: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    form.fields.name.as("text").onChangeText("x");
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => { started(); return new Promise((resolve) => { finish = resolve; }); } } });
    const submission = form.submit();
    await ready;
    form.reset();
    finish({ value: { name: "x" } });
    expect(await submission).toBe(false);
    expect(form.error).toBeUndefined(); // the fetch of this file fails the test's submission if anything is sent
    expect(form.pending).toBe(0);
  });
  test("an input whose host is replaced is focused through the new host (the renderer tells the new one before the old one's null)", async () => {
    const form = m.form("h/focus");
    const focused: string[] = [];
    const props = form.fields.first.as("text");
    props.ref({ focus: () => focused.push("old") });
    props.ref({ focus: () => focused.push("new") });
    props.ref(null);
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [{ message: "required", path: ["first"] }] }) } });
    expect(await form.submit()).toBe(false);
    expect(focused).toEqual(["new"]);
  });
  test("reset invalidates pending async validation", async () => {
    const form = m.form("h/reset-validation");
    let finish!: (result: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    form.fields.name.as("text").onChangeText("old");
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => { started(); return new Promise((resolve) => { finish = resolve; }); } } });
    const validating = form.validate({ preflightOnly: true, all: true });
    await ready;
    form.reset();
    finish({ issues: [{ message: "stale", path: ["name"] }] });
    await validating;
    expect(form.fields.name.issues()).toBeUndefined();
    expect(form.fields.name.as("text").value).toBe("");
    expect(form.fields.name.dirty()).toBe(false);
  });

  test("issues of the preflight are the fields', in the order the fields were rendered; pending covers the preflight", async () => {
    const form = m.form("h/f");
    form.fields.second.as("text");
    form.fields.first.as("text");
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: async () => ({ issues: [{ message: "b", path: ["first"] }, { message: "a", path: ["second"] }, { message: "whole form", path: [] }] }) } });
    const sending = form.submit();
    expect(form.pending).toBe(1);
    expect(form.submitted).toBe(true);
    expect(await sending).toBe(false);
    expect(form.pending).toBe(0);
    expect(form.fields.first.issues()).toEqual([{ message: "b", path: ["first"] }]);
    expect(form.fields.allIssues()?.map((issue: any) => issue.message)).toEqual(["whole form", "a", "b"]);
    expect(form.fields.second.issues()?.[0].message).toBe("a");
  });
  test("validate shows the issues of the fields that were edited and left, or of all of them with `all`", async () => {
    const form = m.form("h/f");
    const first = form.fields.first.as("text");
    form.fields.second.as("text");
    form.preflight({ "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [{ message: "first", path: ["first"] }, { message: "second", path: ["second"] }] }) } });
    first.onChangeText("x");
    await form.validate({ preflightOnly: true });
    expect(form.fields.allIssues()).toBeUndefined();
    first.onBlur();
    await form.validate({ preflightOnly: true });
    expect(form.fields.allIssues()?.map((issue: any) => issue.message)).toEqual(["first"]);
    await form.validate({ preflightOnly: true, all: true });
    expect(form.fields.allIssues()?.map((issue: any) => issue.message)).toEqual(["first", "second"]);
  });
  test("reset returns every field to its default, and forgets the issues", async () => {
    const { form, submit } = recording();
    const name = form.fields.name.as("text", "default");
    name.onChangeText("typed");
    await submit();
    expect([form.submitted, form.fields.allIssues()?.length]).toEqual([true, 1]);
    form.reset();
    expect([name.value, form.submitted, form.fields.allIssues(), form.fields.name.dirty(), form.fields.name.touched()]).toEqual(["default", false, undefined, false, false]);
  });
  test("there is no <form> element: no action, no element, no attachment", async () => {
    const form = m.form("h/f");
    expect(form.method).toBe("POST");
    expect([form.action, form.element]).toEqual([undefined, undefined]);
    expect(Object.getOwnPropertySymbols(form)).toEqual([]);
    // With no host the call itself throws, as a query or a command does: a build without one is not a failed request, and nothing is returned to be rejected.
    m.resetRemoteConfig();
    let thrown: any;
    let returned: unknown;
    try { returned = form.submit(); } catch (error) { thrown = error; }
    expect(thrown?.message).toMatch(/No SvelteKit host is configured/);
    expect(returned).toBeUndefined();
  });
});

describe("what is sent is what is shown (as a browser posts the defaults of its inputs)", () => {
  test("defaults of every kind of input are sent until the field is edited; an edit, even to empty, wins", async () => {
    const { form, submit } = recording();
    const { fields } = form;
    const title = fields.title.as("text", "Dr");
    const qty = fields.qty.as("number", 3);
    const news = fields.news.as("checkbox", true);
    const off = fields.off.as("checkbox");
    const color = fields.color.as("select", "red");
    const small = fields.size.as("radio", "s", true);
    const large = fields.size.as("radio", "l");
    const plain = fields.plain.as("text");
    expect([title.value, qty.value, news.value, off.value, color.value, small.value, large.value, plain.value]).toEqual(["Dr", "3", true, false, "red", true, false, ""]);
    const first = await submit();
    expect(Object.keys(first).toSorted()).toEqual(["color", "news", "plain", "qty", "size", "title"]);
    expect(first).toMatchObject({ title: "Dr", qty: 3, news: true, color: "red", size: "s", plain: "" });

    // Edited: the text is empty on screen, so it is empty in the post; an unchecked box is not posted at all; the other radio wins.
    title.onChangeText("");
    news.onValueChange(false);
    large.onValueChange(true);
    color.onValueChange("blue");
    qty.onChangeText("");
    const second = await submit();
    expect(second).toMatchObject({ title: "", size: "l", color: "blue", qty: undefined });
    expect(Object.keys(second).toSorted()).toEqual(["color", "plain", "qty", "size", "title"]);
    expect([title.value, qty.value, news.value, small.value, large.value]).toEqual(["", "", false, false, true]);
  });
  test("a select shows, and posts, the option it starts on: the one given, else the first of its options", async () => {
    const { form, submit } = recording();
    const { fields } = form;
    expect(fields.a.as("select", "b", ["a", "b"]).value).toBe("b");
    expect(fields.c.as("select", undefined, ["x", "y"]).value).toBe("x");
    expect(fields.many.as("select multiple", ["p"]).value).toEqual(["p"]);
    expect(await submit()).toMatchObject({ a: "b", c: "x", many: ["p"] });
    // Without options there is nothing to start on.
    const bare = recording();
    expect(bare.form.fields.d.as("select").value).toBeUndefined();
    expect(Object.keys(await bare.submit())).not.toContain("d");
  });
  test("checkboxes of a list post the checked ones, and none when none is", async () => {
    const { form, submit } = recording();
    const kit = form.fields.topics.as("checkbox", "kit", true);
    const svelte = form.fields.topics.as("checkbox", "svelte");
    expect(await submit()).toMatchObject({ topics: ["kit"] });
    svelte.onValueChange(true);
    expect((await submit()).topics).toEqual(["kit", "svelte"]);
    kit.onValueChange(false);
    svelte.onValueChange(false);
    expect(Object.keys(await submit())).not.toContain("topics");
  });
  test("a field whose input is gone keeps what was typed or set, and has no default sent for it; a field never edited and gone sends nothing", async () => {
    const { form, submit } = recording();
    const { fields } = form;
    const name = fields.name.as("text");
    const company = fields.company.as("text");
    const note = fields.note.as("text", "default note");
    // The host builds the element and tells the ref; with no host (a test, a store) a field counts as there.
    name.ref({});
    company.ref({});
    note.ref({});
    company.onChangeText("Acme");
    fields.code.set("from code");
    expect(await submit()).toMatchObject({ name: "", company: "Acme", note: "default note", code: "from code" });
    // Both inputs go (a step of a wizard, a closed modal): the typed value stays, the defaults are not sent for inputs that are not there.
    company.ref(null);
    note.ref(null);
    name.ref(null);
    const without = await submit();
    expect(Object.keys(without).toSorted()).toEqual(["code", "company"]);
    expect(without).toMatchObject({ company: "Acme", code: "from code" });
    // Shown again: the element is new, and what was typed is still the field's value.
    fields.company.as("text").ref({});
    expect(await submit()).toMatchObject({ company: "Acme" });
    // The ref of a field is one function, so the host is not told "gone, back" on every render.
    expect(fields.company.as("text").ref).toBe(company.ref);
  });
  test("rows of a virtualized list that scrolled away keep what was typed in them", async () => {
    const { form, submit } = recording();
    const row0 = form.fields.items[0].qty.as("number");
    const row1 = form.fields.items[1].qty.as("number");
    const row2 = form.fields.items[2].qty.as("number");
    for (const row of [row0, row1, row2]) row.ref({});
    row0.onChangeText("5");
    row1.onChangeText("7");
    // Row 0 scrolls out and unmounts, and so does row 2, which was never typed in: it has no number to send, and nothing is sent for it.
    row0.ref(null);
    row2.ref(null);
    const data = await submit();
    expect(data.items[0]).toEqual({ qty: 5 });
    expect(data.items[1]).toEqual({ qty: 7 });
    expect(form.fields.items[0].qty.value()).toBe(5);
    expect(data.items[2]?.qty).toBeUndefined();
    // Typed again after it came back: the new number wins.
    form.fields.items[0].qty.as("number").ref({});
    row0.onChangeText("9");
    expect((await submit()).items[0]).toEqual({ qty: 9 });
  });
  test("an input in a modal that was closed after typing in it still sends what was typed", async () => {
    const { form, submit } = recording();
    const name = form.fields.name.as("text");
    name.ref({});
    name.onChangeText("Ada");
    name.ref(null);
    expect(await submit()).toMatchObject({ name: "Ada" });
    // And a value that only code set, for an input that was never made.
    form.fields.nick.set("ada");
    expect(await submit()).toMatchObject({ name: "Ada", nick: "ada" });
  });
  test("of inputs that share a name the field is there while one of them is; once all are gone the choice stays and the defaults do not", async () => {
    const { form, submit } = recording();
    const small = form.fields.size.as("radio", "s", true);
    const large = form.fields.size.as("radio", "l");
    small.ref({});
    large.ref({});
    small.ref(null);
    // `small` (the default) is gone and `large` is on screen and not chosen: nothing is chosen on screen.
    expect(Object.keys(await submit())).not.toContain("size");
    large.onValueChange(true);
    expect((await submit()).size).toBe("l");
    large.ref(null);
    expect((await submit()).size).toBe("l");
  });
  test("the submit button that was pressed last is the only one posted", async () => {
    const { form, sent } = recording();
    const save = form.fields.save.as("submit", "1");
    const remove = form.fields.delete.as("submit", "1");
    save.onPress();
    await new Promise((resolve) => setTimeout(resolve, 30));
    remove.onPress();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent.map((data) => Object.keys(data).toSorted())).toEqual([["save"], ["delete"]]);
    // Pressing the same one again posts it again.
    remove.onPress();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Object.keys(sent[2])).toEqual(["delete"]);
  });
});

describe("a submission that fails", () => {
  test("is handled as SvelteKit's form handles it: through handleError, shown by form.error, and the submit resolves false", async () => {
    const hits: string[] = [];
    m.configureRemote({ origin: "https://a.example", handleError: ({ kind }: any) => { hits.push(kind); return { message: "Offline" }; }, fetch: async () => { throw new TypeError("Network request failed"); } });
    const form = m.form("h/i");
    form.fields.set({ a: 1 });
    const sending = form.submit();
    expect(form.pending).toBe(1);
    // (`.updates()` is still on the promise a failed one resolves.)
    expect(await sending.updates()).toBe(false);
    expect(hits).toEqual(["unknown"]);
    expect(form.error).toMatchObject({ status: 500, message: "Offline" });
    expect([form.pending, form.result]).toEqual([0, undefined]);
    // The next submission starts with no error.
    m.configureRemote({ fetch: async () => Response.json({ type: "result", data: "[{\"_\":1},{\"issues\":2,\"result\":3},[],\"ok\"]" }) });
    expect(await form.submit()).toBe(true);
    expect([form.error, form.result]).toEqual([undefined, "ok"]);
  });
  test("an enhance callback that throws is handled the same way", async () => {
    const hits: string[] = [];
    m.configureRemote({ origin: "https://a.example", handleError: ({ kind }: any) => { hits.push(kind); } });
    const form = m.form("h/j");
    form.enhance(async () => { throw new Error("callback failed"); });
    expect(await form.submit()).toBe(false);
    expect(hits).toEqual(["unknown"]);
    expect(form.error).toMatchObject({ status: 500 });
  });
  test("what a button that calls form.submit() without waiting is left with is a promise that resolves: nothing to reject unhandled", async () => {
    m.configureRemote({ origin: "https://a.example", handleError: () => {}, fetch: async () => { throw new TypeError("Network request failed"); } });
    const form = m.form("h/k");
    form.fields.set({ a: 1 });
    const outcome = await form.submit().then(() => "resolved", () => "rejected");
    expect(outcome).toBe("resolved");
  });
});

describe("the environment", () => {
  const sample = ["", "f", "fo", "foo", "foob", "fooba", "foobar", "svelte-native, é ÿ", String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i))];
  test("base64 fallbacks match the engine's btoa and atob", () => {
    for (const text of sample) {
      expect([text, base64Encode(text)]).toEqual([text, btoa(text)]);
      expect([text, base64Decode(btoa(text))]).toEqual([text, text]);
    }
    expect(base64Decode("Zm9v\n YmFy ")).toBe("foobar");
    expect(base64Decode("Zm9vYg")).toBe("foob");
    expect(() => base64Encode("ā")).toThrow(/Latin1/);
    expect(() => base64Decode("Zm9v*")).toThrow(/not correctly encoded/);
    expect(() => base64Decode("Z")).toThrow(/not correctly encoded/);
  });
  test("the stand-ins are values this package hands to SvelteKit's files, never installed on the global object", () => {
    const before = Object.getOwnPropertyNames(globalThis).toSorted();
    const strong = new WeakRefFallback({ a: 1 });
    expect(strong.deref()).toEqual({ a: 1 });
    expect(Object.getOwnPropertyNames(globalThis).toSorted()).toEqual(before);
    // (and nothing in the package writes to it)
    const sources = [...new Bun.Glob("**/*.{ts,svelte}").scanSync({ cwd: join(import.meta.dirname, "../../src/remote") })];
    for (const file of sources) {
      const text = readFileSync(join(import.meta.dirname, "../../src/remote", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect([file, /\b(?:globalThis|window|global)\.\w+\s*=[^=]|Object\.defineProperty\(\s*globalThis/.test(text)]).toEqual([file, false]);
    }
  });
  test("a registry for an engine with none (React Native 0.86's Hermes) sweeps what its WeakRefs lost, and can be told to release a target at once", async () => {
    const Registry = makeFinalizationRegistry(undefined);
    const called: unknown[] = [];
    const registry = new Registry((held: unknown) => { called.push(held); });
    expect(() => new Registry("nope" as never)).toThrow(/must be callable/);

    const owner = {};
    registry.register(owner, "released");
    expect(releaseNow(owner)).toBe(true);
    expect(releaseNow(owner)).toBe(false);
    expect(releaseNow({})).toBe(false);
    expect(called).toEqual(["released"]);

    const token = {};
    (() => { registry.register({}, "collected"); registry.register({}, "unregistered", token); })();
    expect(registry.unregister(token)).toBe(true);
    expect(registry.unregister({})).toBe(false);
    // The engine collects them in a later turn; the registry finds out at its next sweep.
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    sweepRegistry();
    expect(called).toEqual(["released", "collected"]);
    // A cleanup that throws is reported and does not stop the sweep.
    const failing = new Registry(() => { throw new Error("cleanup failed"); });
    (() => { failing.register({}, 1); })();
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const log = console.error;
    const seen: unknown[] = [];
    console.error = (error: unknown) => { seen.push(error); };
    try { sweepRegistry(); } finally { console.error = log; }
    expect(seen.map((error) => (error as Error).message)).toEqual(["cleanup failed"]);
  });
  test("with an engine registry of its own the release still works, once: the engine's callback for that target is then ignored", () => {
    const callbacks: Array<(held: unknown) => void> = [];
    const registrations: Array<{ target: object; held: unknown; token?: object }> = [];
    class NativeRegistry {
      constructor(callback: (held: unknown) => void) { callbacks.push(callback); }
      register(target: object, held: unknown, token?: object) { registrations.push({ target, held, token }); }
      unregister() { return true; }
    }
    const Registry = makeFinalizationRegistry(NativeRegistry as never);
    const called: unknown[] = [];
    const registry = new Registry((held: unknown) => { called.push(held); });
    const a = {};
    const b = {};
    registry.register(a, "a");
    registry.register(b, "b");
    expect(releaseNow(a)).toBe(true);
    expect(called).toEqual(["a"]);
    // The engine collects both later: `a` was released already, `b` was not.
    for (const { held } of registrations) callbacks[0](held);
    expect(called).toEqual(["a", "b"]);
    expect(releaseNow(b)).toBe(false);
  });
  test("the sweep timer is not left running in the background (iOS keeps timers until the app is suspended) and starts again in the foreground", async () => {
    const Registry = makeFinalizationRegistry(undefined);
    let listener: ((state: string) => void) | undefined;
    let removed = 0;
    setSweepLifecycle((next) => { listener = next; return { remove() { removed++; } }; });
    const called: unknown[] = [];
    const registry = new Registry((held: unknown) => { called.push(held); });
    (() => { registry.register({}, "lost"); })();
    expect(sweepTimerRunning()).toBe(true);
    listener?.("background");
    expect(sweepTimerRunning()).toBe(false);
    // Foreground: one sweep at once (what was lost while away), then the timer again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    listener?.("active");
    expect(called).toEqual(["lost"]);
    sweepRegistry();
    setSweepLifecycle(undefined);
    expect(removed).toBe(1);
  });
  test("what cannot be made up is named", () => {
    expect(missingGlobals({})).toEqual(["ReadableStream", "TextEncoder", "TextDecoder", "AbortController", "Headers", "URL", "URLSearchParams"]);
    expect(missingGlobals()).toEqual([]);
  });
});
