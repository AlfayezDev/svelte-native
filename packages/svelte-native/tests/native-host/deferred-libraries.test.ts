import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hostTools, kotlinHost } from "../support/native-host.ts";

/**
 * The rules of the deferred native libraries (DeferredLoadsCore.kt: the Nitro modules' libraries the start leaves out, loaded in the background
 * after the first mount or by the first JavaScript use of Nitro, whichever comes first), compiled for the host and run against a fake platform.
 * `DeferredLibraries.kt` only gives these rules the platform (System.loadLibrary, a Handler, a thread) and holds the two packages autolinking links
 * (`autolinking.ts`); what this test reads of it is below. Skipped when `kotlinc` or `java` is not on the path.
 */
const core = resolve(import.meta.dirname, "../../native/svelte-core/android/src/main/java/expo/modules/sveltecore");
const sources = { core: resolve(core, "DeferredLoadsCore.kt"), host: resolve(import.meta.dirname, "fixtures/DeferredLoadsHost.kt") };
const tools = hostTools("kotlinc", "java");
const { run } = kotlinHost({ name: "deferred-libraries", sources: [sources.host, sources.core] });

const scenarios = ["background", "first-mount-twice", "asked-first", "register-again", "nothing", "failure", "background-failure", "while-loading"];

let answered: Record<string, string> | undefined;
function answers(): Record<string, string> {
  answered ??= Object.fromEntries(run(scenarios).map((line, i) => [scenarios[i], line]));
  return answered;
}

const failed = "throws Svelte native: the native library a could not be loaded: dlopen failed: liba.so not found (cause UnsatisfiedLinkError)";

test.skipIf(!tools)("the libraries load in the background a second after the first mount, once, in order", () => {
  const by = answers();
  expect(by.background).toBe("post 1000 | mounted | thread svelte-deferred-load | load a | load b");
  expect(by["first-mount-twice"]).toBe("post 1000 | thread svelte-deferred-load | load a");
  expect(by.nothing).toBe("ready | post 1000 | thread svelte-deferred-load");
});

test.skipIf(!tools)("a use before the background load loads them on the asking thread, and each library loads once", () => {
  const by = answers();
  expect(by["asked-first"]).toBe("post 1000 | load a | load b | ready | thread svelte-deferred-load");
  expect(by["register-again"]).toBe("load a | ready | load c | ready | ready");
});

test.skipIf(!tools)("a library that cannot load is logged once and every ask throws its error", () => {
  const by = answers();
  const warned = "warn Svelte native: could not load the native library a (UnsatisfiedLinkError)";
  expect(by.failure).toBe(`load a | ${warned} | load b | ${failed} | ${failed}`);
  expect(by["background-failure"]).toBe(`post 1000 | thread svelte-deferred-load | load a | ${warned} | ${failed}`);
});

test.skipIf(!tools)("an ask during a background load waits for it, and returns once the rest is loaded: two loads never overlap", () => {
  expect(answers()["while-loading"]).toBe("post 1000 | thread svelte-deferred-load | load a | a finishes | load b | ready");
});

test("the packages autolinking links: one registers its library and loads nothing, the gate loads every registered library before Nitro's module is made", () => {
  const source = readFileSync(resolve(core, "DeferredLibraries.kt"), "utf8");
  const deferred = /class DeferredNitroPackage\(library: String\) : BaseReactPackage\(\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  expect(deferred).toContain("DeferredLibraries.register(library)");
  expect(deferred).not.toContain("loadLibrary");
  expect(deferred).toContain("getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null");
  const gate = /class NitroGate\(private val nitro: BaseReactPackage\) : BaseReactPackage\(\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  expect(gate.indexOf("DeferredLibraries.awaitAll()")).toBeGreaterThan(-1);
  expect(gate.indexOf("DeferredLibraries.awaitAll()")).toBeLessThan(gate.indexOf("nitro.getModule(name, reactContext)"));
  // The background load starts at the first mount: BootBoost.release, which the mounting manager calls on the first transaction.
  const boot = readFileSync(resolve(core, "../svelteengine/BootBoost.kt"), "utf8");
  expect(/@JvmStatic fun release\(\) \{\s*core\.release\(\)\s*expo\.modules\.sveltecore\.DeferredLibraries\.firstMount\(\)\s*\}/.test(boot)).toBe(true);
});
