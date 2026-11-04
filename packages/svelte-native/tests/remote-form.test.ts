// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// The native form: what `fields.x.as(type)` gives a native input, what is sent, and the state around a submission. No server: a preflight schema stops
// every submission before the request, so what the schema is given is what would have been sent (the round trips are in remote-e2e.test.ts).
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { base64Decode, base64Encode, installEnvironment, missingGlobals } from "../src/remote/environment.ts";
import { loadClient } from "./remote-harness.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: Record<string, any>;
beforeAll(async () => {
  m = await loadClient(`
    export * from "../src/remote/index.ts";
    export { form } from "../src/remote/runtime.ts";
  `);
});
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
    expect(Object.keys(fields.a.as("text")).toSorted()).toEqual(["onBlur", "onChangeText", "value"]);
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
    age.onChangeText("abc");
    expect(fields.age.value()).toBeUndefined();
    fields.age.set(30);
    expect(age.value).toBe("30");
  });
  test("checkbox and radio are a Switch's props", () => {
    const { fields } = m.form("h/f");
    const agree = fields.agree.as("checkbox");
    expect(Object.keys(agree).toSorted()).toEqual(["onBlur", "onValueChange", "value"]);
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
  test("files and unknown types are refused", () => {
    const { fields } = m.form("h/f");
    expect(() => fields.photo.as("file")).toThrow(/files are not supported/);
    expect(() => fields.photo.as("file multiple")).toThrow(/files are not supported/);
    expect(() => fields.photo.as("image")).toThrow(/files are not supported/);
    expect(() => fields.photo.as("datetime")).toThrow(/not a field type a native form knows/);
  });
});

describe("state around a submission", () => {
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
    // With no host the submission fails as a request, not as the call.
    await expect(form.submit()).rejects.toThrow(/No SvelteKit host is configured/);
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
  test("fallbacks are installed only for what the engine does not define", () => {
    const empty: Record<string, any> = {};
    installEnvironment(empty);
    expect(Object.keys(empty).toSorted()).toEqual(["FinalizationRegistry", "WeakRef", "atob", "btoa"]);
    const target = { WeakRef, atob: () => "mine" } as Record<string, any>;
    installEnvironment(target);
    expect(target.WeakRef).toBe(WeakRef);
    expect(target.atob()).toBe("mine");
    expect(typeof target.btoa).toBe("function");
    const strong = new empty.WeakRef({ a: 1 });
    expect(strong.deref()).toEqual({ a: 1 });
    expect(() => new empty.FinalizationRegistry(() => {}).register({}, 1)).not.toThrow();
  });
  test("what cannot be made up is named", () => {
    expect(missingGlobals({})).toEqual(["ReadableStream", "TextEncoder", "TextDecoder", "AbortController", "Headers", "URL", "URLSearchParams"]);
    expect(missingGlobals()).toEqual([]);
  });
});
