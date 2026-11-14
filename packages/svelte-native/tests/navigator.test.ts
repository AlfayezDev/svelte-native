// `navigator.clipboard`, `ClipboardItem`, `share`, `canShare`, `vibrate`, `language` and `languages` on the device, against stand-ins for React Native's modules and the
// library's SvelteClipboard native module (`globalThis.__native` records what each was asked).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Native = {
  os: "ios" | "android";
  locale?: string;
  clipboard: Record<string, string> | null;
  writes: [string, string | null][];
  shares: { content: any; options: any }[];
  shareResult: string;
  vibrations: (number | number[] | "cancel")[];
};

const STUBS: Record<string, string> = {
  "react-native/Libraries/Share/Share": `export default { dismissedAction: "dismissedAction", sharedAction: "sharedAction", share: async (content, options) => { globalThis.__native.shares.push({ content, options }); return { action: globalThis.__native.shareResult }; } };`,
  "react-native/Libraries/Vibration/Vibration": `export default { vibrate: (pattern) => { globalThis.__native.vibrations.push(pattern); }, cancel: () => { globalThis.__native.vibrations.push("cancel"); } };`,
  "react-native/Libraries/Utilities/Platform": `export default { get OS() { return globalThis.__native.os; } };`,
  "react-native/Libraries/ReactNative/I18nManager": `export default { getConstants: () => ({ isRTL: false, localeIdentifier: globalThis.__native.locale }) };`,
  "expo-modules-core": `export const requireOptionalNativeModule = (name) => name !== "SvelteClipboard" || globalThis.__native.clipboard === null ? null : {
    read: async () => ({ ...globalThis.__native.clipboard }),
    write: async (text, html) => { globalThis.__native.writes.push([text, html]); globalThis.__native.clipboard = html === null ? { "text/plain": text } : { "text/plain": text, "text/html": html }; },
  };`,
};

/** A fresh copy of `navigator.ts`, installed on a scope of its own with the stand-ins above. */
async function install(native: Partial<Native> = {}): Promise<{ scope: any; native: Native; m: any }> {
  const state: Native = { os: "android", locale: "en_US", clipboard: {}, writes: [], shares: [], shareResult: "sharedAction", vibrations: [], ...native };
  (globalThis as any).__native = state;
  const bundle = await build({
    stdin: { contents: `export * from "./src/navigator.ts";`, resolveDir: resolve(import.meta.dirname, ".."), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", write: false,
    plugins: [{
      name: "navigator-stubs",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native\/|expo-modules-core$)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path] ?? "export default {};", loader: "js" }));
      },
    }],
  });
  const directory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "svelte-native-navigator-"));
  const file = join(directory, "navigator.mjs");
  writeFileSync(file, bundle.outputFiles[0].contents);
  let m: any;
  try { m = await import(pathToFileURL(file).href); } finally { rmSync(directory, { recursive: true, force: true }); }
  const scope: any = { navigator: { product: "ReactNative" } };
  m.installNavigator(scope);
  return { scope, native: state, m };
}

describe("navigator.clipboard", () => {
  test("writeText and readText, and an empty clipboard reads as an empty string", async () => {
    const { scope, native } = await install();
    expect(await scope.navigator.clipboard.readText()).toBe("");
    await scope.navigator.clipboard.writeText("hello ✓");
    expect(native.writes).toEqual([["hello ✓", null]]);
    expect(await scope.navigator.clipboard.readText()).toBe("hello ✓");
    await scope.navigator.clipboard.writeText(42);
    expect(native.writes.at(-1)).toEqual(["42", null]);
    expect(Object.prototype.toString.call(scope.navigator.clipboard)).toBe("[object Clipboard]");
  });

  test("write and read ClipboardItems of text/plain and text/html; HTML alone gets its text as the plain part", async () => {
    const { scope, native } = await install();
    const { ClipboardItem } = scope;
    await scope.navigator.clipboard.write([new ClipboardItem({ "text/plain": "Bold", "text/html": Promise.resolve(new Blob(["<b>Bold</b>"], { type: "text/html" })) })]);
    expect(native.writes).toEqual([["Bold", "<b>Bold</b>"]]);
    const [item] = await scope.navigator.clipboard.read();
    expect(item.types).toEqual(["text/plain", "text/html"]);
    expect(await (await item.getType("text/html")).text()).toBe("<b>Bold</b>");
    expect((await item.getType("text/plain")).type).toStartWith("text/plain"); // Bun adds ";charset=utf-8"
    await scope.navigator.clipboard.write([new ClipboardItem({ "text/html": "<p>One &amp; two</p><p>three<br>four</p><script>x()</script>" })]);
    expect(native.writes.at(-1)).toEqual(["One & two\nthree\nfour", "<p>One &amp; two</p><p>three<br>four</p><script>x()</script>"]);
    native.clipboard = {};
    expect(await scope.navigator.clipboard.read()).toEqual([]);
  });

  test("other types, several items and an empty item are refused as a browser refuses them", async () => {
    const { scope } = await install();
    const { ClipboardItem } = scope;
    expect(ClipboardItem.supports("text/plain")).toBe(true);
    expect(ClipboardItem.supports("image/png")).toBe(false);
    await expect(scope.navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array([1])]) })])).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(scope.navigator.clipboard.write([new ClipboardItem({ "text/plain": "a" }), new ClipboardItem({ "text/plain": "b" })])).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(() => new ClipboardItem({})).toThrow(TypeError);
    await expect(new ClipboardItem({ "text/plain": "a" }).getType("text/html")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  test("on a build without the native module navigator.clipboard is undefined (one warning), and ClipboardItem still exists", async () => {
    const { warn } = console;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
    try {
      const { scope } = await install({ clipboard: null });
      expect(scope.navigator.clipboard).toBeUndefined();
      expect(scope.navigator.clipboard).toBeUndefined();
      expect(typeof scope.ClipboardItem).toBe("function");
    } finally { console.warn = warn; }
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain("SvelteClipboard native module is not part of this app's build");
  });

  test("the clipboard is looked up on the first read, not when it is installed", async () => {
    const { scope, native } = await install();
    native.clipboard = null; // gone before the first read
    const { warn } = console;
    console.warn = () => {};
    try { expect(scope.navigator.clipboard).toBeUndefined(); } finally { console.warn = warn; }
  });
});

describe("navigator.share and canShare", () => {
  test("canShare: a title, a text or an absolute URL, and no files", async () => {
    const { scope } = await install();
    expect(scope.navigator.canShare()).toBe(false);
    expect(scope.navigator.canShare({})).toBe(false);
    expect(scope.navigator.canShare({ text: "hi" })).toBe(true);
    expect(scope.navigator.canShare({ title: "only a title" })).toBe(true);
    expect(scope.navigator.canShare({ url: "https://svelte.dev/docs" })).toBe(true);
    expect(scope.navigator.canShare({ url: "/relative" })).toBe(false);
    expect(scope.navigator.canShare({ text: "hi", files: [new Blob(["x"])] })).toBe(false);
    expect(scope.navigator.canShare({ text: "hi", files: [] })).toBe(true);
  });

  test("iOS shares the message and the URL as two items; Android one text with the URL on its own line", async () => {
    const ios = await install({ os: "ios" });
    await ios.scope.navigator.share({ title: "Svelte", text: "Read this", url: "https://svelte.dev" });
    expect(ios.native.shares).toEqual([{ content: { title: "Svelte", message: "Read this", url: "https://svelte.dev/" }, options: { dialogTitle: "Svelte", subject: "Svelte" } }]);
    await ios.scope.navigator.share({ title: "Just a title" });
    expect(ios.native.shares[1].content).toEqual({ title: "Just a title", message: "Just a title", url: undefined });
    const android = await install({ os: "android" });
    await android.scope.navigator.share({ title: "Svelte", text: "Read this", url: "https://svelte.dev" });
    expect(android.native.shares[0].content).toEqual({ title: "Svelte", message: "Read this\nhttps://svelte.dev/" });
    await android.scope.navigator.share({ url: "https://svelte.dev" });
    expect(android.native.shares[1].content).toEqual({ title: undefined, message: "https://svelte.dev/" });
    // An empty text is a text (canShare says yes): React Native's Android share needs a string message.
    await android.scope.navigator.share({ text: "" });
    expect(android.native.shares[2].content).toEqual({ title: undefined, message: "" });
  });

  test("a dismissed sheet is an AbortError, invalid data a TypeError, and a second share while one is open an InvalidStateError", async () => {
    const { scope, native } = await install({ os: "ios", shareResult: "dismissedAction" });
    await expect(scope.navigator.share({ text: "x" })).rejects.toMatchObject({ name: "AbortError" });
    await expect(scope.navigator.share({ url: "nope" })).rejects.toBeInstanceOf(TypeError);
    native.shareResult = "sharedAction";
    const first = scope.navigator.share({ text: "one" });
    await expect(scope.navigator.share({ text: "two" })).rejects.toMatchObject({ name: "InvalidStateError" });
    await first;
    await scope.navigator.share({ text: "three" }); // the first one's end lets the next one through
    expect(native.shares.map((entry) => entry.content.message)).toEqual(["x", "one", "three"]);
  });
});

describe("navigator.vibrate", () => {
  test("a duration, a web pattern (vibration first) as React Native's (pause first), and 0 or [] stops", async () => {
    const { scope, native } = await install();
    expect(scope.navigator.vibrate(200)).toBe(true);
    expect(scope.navigator.vibrate([100, 50, 200])).toBe(true);
    expect(scope.navigator.vibrate([100, 50, 200, 30])).toBe(true); // a trailing pause does nothing
    expect(scope.navigator.vibrate([])).toBe(true);
    expect(scope.navigator.vibrate(0)).toBe(true);
    expect(scope.navigator.vibrate([20_000, -5, 1.9])).toBe(true);
    // Each call first stops the pattern that plays (React Native's iOS would ignore a call while one plays).
    expect(native.vibrations).toEqual(["cancel", 200, "cancel", [0, 100, 50, 200], "cancel", [0, 100, 50, 200], "cancel", "cancel", "cancel", [0, 10_000, 0, 1]]);
    expect(scope.navigator.vibrate([100, Number.NaN])).toBe(false);
    expect(native.vibrations).toHaveLength(10);
  });

  test("iOS: one fixed vibration at the start of each of the web's, after the vibration and the pause before it", async () => {
    const { scope, native } = await install({ os: "ios" });
    scope.navigator.vibrate([100, 50, 200]);
    scope.navigator.vibrate([100, 50, 200, 300, 400, 30]);
    scope.navigator.vibrate(500);
    expect(native.vibrations).toEqual(["cancel", [0, 150], "cancel", [0, 150, 500], "cancel", 500]);
  });
});

describe("navigator.language and languages", () => {
  test("the device's locale as a BCP 47 tag, and the same languages array while it stays", async () => {
    const { scope, native } = await install({ locale: "ar_SA" });
    expect(scope.navigator.language).toBe("ar-SA");
    expect(scope.navigator.languages).toEqual(["ar-SA"]);
    expect(scope.navigator.languages).toBe(scope.navigator.languages);
    native.locale = "zh_Hans_CN";
    expect(scope.navigator.language).toBe("zh-Hans-CN");
    native.locale = "en_US@calendar=gregorian";
    expect(scope.navigator.language).toBe("en-US");
    // Android's identifier is Java's Locale.toString(): the script and the extensions after "_#".
    native.locale = "zh_CN_#Hans";
    expect(scope.navigator.language).toBe("zh-Hans-CN");
    native.locale = "sr_RS_#Latn";
    expect(scope.navigator.language).toBe("sr-Latn-RS");
    native.locale = "ar_SA_#u-nu-latn";
    expect(scope.navigator.language).toBe("ar-SA-u-nu-latn");
    native.locale = "en";
    expect(scope.navigator.language).toBe("en");
    native.locale = "not a locale";
    expect(scope.navigator.language).toBe(new Intl.DateTimeFormat().resolvedOptions().locale);
    native.locale = undefined;
    expect(scope.navigator.language).toBe(new Intl.DateTimeFormat().resolvedOptions().locale);
  });

  test("what the platform or a library defined already is kept", async () => {
    const { m } = await install();
    const own = () => true;
    const clipboard = {};
    const scope: any = { navigator: { language: "fr-FR", languages: ["fr-FR"], vibrate: own, share: own, canShare: own, clipboard } };
    m.installNavigator(scope);
    expect(scope.navigator).toEqual({ language: "fr-FR", languages: ["fr-FR"], vibrate: own, share: own, canShare: own, clipboard });
  });

  test("installing loads nothing of React Native or the native module", async () => {
    const { scope, native } = await install({ clipboard: null });
    // The stand-ins record every call; none was made, and the clipboard's lookup has not happened (it would warn).
    expect(native.shares).toEqual([]);
    expect(native.vibrations).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(scope.navigator, "clipboard")?.get).toBeDefined();
  });
});
