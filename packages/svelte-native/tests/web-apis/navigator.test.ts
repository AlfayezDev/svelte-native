// `navigator.clipboard`, `ClipboardItem`, `share`, `canShare`, `vibrate`, `language` and `languages` on the device, against stand-ins for React Native's modules and the
// library's SvelteClipboard native module. The stand-ins are one module of the bundle, which records what each was asked and is exported with `installNavigator`, so each test
// has a state of its own.
import { describe, expect, test } from "bun:test";
import { load, src } from "../support/bundle.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Native = {
  os: "ios" | "android";
  locale?: string;
  clipboard: Record<string, string> | null;
  writes: [string, string | null][];
  shares: { content: any; options: any }[];
  shareResult: string;
  vibrations: (number | number[] | "cancel")[];
  location?: ReturnType<typeof locationModule> | null;
  appState?: (state: string) => void;
};

const stubs: Record<string, string> = {
  "navigator-test-state": "export const native = { os: 'android', locale: 'en_US', clipboard: {}, writes: [], shares: [], shareResult: 'sharedAction', vibrations: [] };",
  "react-native/Libraries/Share/Share": `import { native } from "navigator-test-state"; export default { dismissedAction: "dismissedAction", sharedAction: "sharedAction", share: async (content, options) => { native.shares.push({ content, options }); return { action: native.shareResult }; } };`,
  "react-native/Libraries/Vibration/Vibration": `import { native } from "navigator-test-state"; export default { vibrate: (pattern) => { native.vibrations.push(pattern); }, cancel: () => { native.vibrations.push("cancel"); } };`,
  "react-native/Libraries/Utilities/Platform": `import { native } from "navigator-test-state"; export default { get OS() { return native.os; } };`,
  "react-native/Libraries/ReactNative/I18nManager": `import { native } from "navigator-test-state"; export default { getConstants: () => ({ isRTL: false, localeIdentifier: native.locale }) };`,
  "react-native/Libraries/AppState/AppState": `import { native } from "navigator-test-state"; export default { addEventListener: (type, listener) => { native.appState = listener; return { remove() {} }; } };`,
  "expo-modules-core": `import { native } from "navigator-test-state"; export const requireOptionalNativeModule = (name) => {
    if (name === "ExpoLocation") return native.location ?? null;
    return name !== "SvelteClipboard" || native.clipboard === null ? null : {
      read: async () => ({ ...native.clipboard }),
      write: async (text, html) => { native.writes.push([text, html]); native.clipboard = html === null ? { "text/plain": text } : { "text/plain": text, "text/html": html }; },
    };
  };`,
};

/** A stand-in for expo-location's native module: the permission granted, one position. */
const locationModule = () => ({
  getForegroundPermissionsAsync: async () => ({ status: "granted", granted: true, canAskAgain: true }),
  requestForegroundPermissionsAsync: async () => ({ status: "granted", granted: true, canAskAgain: true }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 24.71, longitude: 46.67, accuracy: 12 }, timestamp: 1_800_000_000_000 }),
  getLastKnownPositionAsync: async () => null,
  watchPositionImplAsync: async () => {},
  removeWatchAsync: async () => {},
  addListener: () => ({ remove() {} }),
});

/** A fresh copy of `navigator.ts`, installed on a scope of its own with the stand-ins above and `native` as the state the stand-ins start from, over what the test gives. */
async function install(given: Partial<Native> = {}): Promise<{ scope: any; native: Native; m: any }> {
  const m = await load<any>({
    entry: `export * from ${JSON.stringify(src("navigator.ts"))}; export { native } from "navigator-test-state";`,
    stubs,
    converters: false,
  });
  const native: Native = Object.assign(m.native, given);
  const scope: any = { navigator: { product: "ReactNative" } };
  m.installNavigator(scope);
  return { scope, native, m };
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

  test("installing loads nothing of React Native or the native modules", async () => {
    const { scope, native } = await install({ clipboard: null });
    // The stand-ins record every call; none was made, and the clipboard's lookup has not happened (it would warn).
    expect(native.shares).toEqual([]);
    expect(native.vibrations).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(scope.navigator, "clipboard")?.get).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(scope.navigator, "geolocation")?.get).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(scope.navigator, "permissions")?.get).toBeDefined();
  });
});

describe("navigator.geolocation and navigator.permissions", () => {
  test("in a build with the location capability: one Geolocation over expo-location's module, and the web's classes as globals", async () => {
    const { scope, native } = await install({ location: locationModule() });
    const geolocation = scope.navigator.geolocation;
    expect(Object.prototype.toString.call(geolocation)).toBe("[object Geolocation]");
    expect(scope.navigator.geolocation).toBe(geolocation);
    const position: any = await new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject));
    expect([position.coords.latitude, position.coords.longitude, position.coords.accuracy, position.timestamp]).toEqual([24.71, 46.67, 12, 1_800_000_000_000]);
    expect(position).toBeInstanceOf(scope.GeolocationPosition);
    expect(position.coords).toBeInstanceOf(scope.GeolocationCoordinates);
    expect(scope.GeolocationPositionError.TIMEOUT).toBe(3);
    const status = await scope.navigator.permissions.query({ name: "geolocation" });
    expect([status.state, status instanceof scope.PermissionStatus]).toEqual(["granted", true]);
    // The status follows the app coming back to the foreground, through AppState.
    expect(typeof native.appState).toBe("function");
  });

  test("in a build without it: navigator.geolocation is undefined with one warning that says how to turn it on, and the permission reads denied", async () => {
    const { warn } = console;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
    try {
      const { scope } = await install({ location: null });
      expect(scope.navigator.geolocation).toBeUndefined();
      expect(scope.navigator.geolocation).toBeUndefined();
      expect((await scope.navigator.permissions.query({ name: "geolocation" })).state).toBe("denied");
      expect(typeof scope.GeolocationPositionError).toBe("function");
    } finally { console.warn = warn; }
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain("the location capability is not part of this app's build: install expo-location, add `capabilities: { location:");
  });
});
