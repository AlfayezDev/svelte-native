import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Plugin } from "esbuild";
import { dispatchCommand } from "../../src/fabric/renderer-stub.ts";
import { type FakeNode, type Module, all, emit, host, load, settle } from "../support/html-harness.ts";
import { type Platform, reactNativeSources } from "../support/rn-reference.ts";
import { type GlobalSnapshot, snapshotGlobals } from "../support/globals.ts";

/**
 * `Keyboard.dismiss()` closes the keyboard of a focused `TextInput` (#110). React Native's dismiss is `dismissKeyboard()`:
 * `TextInputState.blurTextInput(TextInputState.currentlyFocusedInput())`, which sends `blur` to the input with the native component's command helper. Those are
 * React Native's own here, with the renderer module the Fabric entry has (`fabric/renderer-stub.ts`), and the page's inputs are mounted on the fake Fabric host:
 * the command is what the host asks of the binding. Of the native component modules `TextInputState` imports, only the commands are kept, built as React Native
 * builds them (`codegenNativeCommands`). Each platform's: `TextInputState` sends Android's commands or iOS's.
 */
const require = createRequire(import.meta.url);
const commands = require.resolve("react-native/Libraries/Utilities/codegenNativeCommands");
// The plugin's name is part of the bundle's cache key (`html-harness.ts`): one bundle per platform.
const reactNativeKeyboard = (platform: Platform): Plugin => ({
  name: `react-native-dismiss-keyboard-${platform}`,
  setup(builder) {
    builder.onResolve({ filter: /^react-native\/Libraries\/(Utilities\/dismissKeyboard|Components\/TextInput\/TextInputState)$/ }, (args) => ({ path: require.resolve(args.path) }));
    builder.onResolve({ filter: /\/(AndroidTextInputNativeComponent|RCTSingelineTextInputNativeComponent)$/ }, () => ({ path: "commands", namespace: "text-input-commands" }));
    builder.onLoad({ filter: /.*/, namespace: "text-input-commands" }, () => ({
      contents: `import codegenNativeCommands from ${JSON.stringify(commands)}; export const Commands = codegenNativeCommands({ supportedCommands: ["focus", "blur", "setTextAndSelection"] });`,
      loader: "js", resolveDir: dirname(commands),
    }));
  },
});

type Page = { dismiss(): void; hide(): void; given(): unknown };
const globals = globalThis as unknown as { __htmlLog: (entry: string) => void; __events: Page };

let world: GlobalSnapshot;
beforeAll(() => { world = snapshotGlobals(); });
afterAll(() => world.restore());

let surface = 900;
let started: { m: Module; tag: number } | undefined;
async function mount(platform: Platform) {
  const m = await load(resolve(import.meta.dirname, "fixtures/keyboard-dismiss-fixture.svelte"), [reactNativeKeyboard(platform), reactNativeSources(platform)]);
  host.roots = {};
  const log: string[] = [];
  globals.__htmlLog = (entry) => log.push(entry);
  const tag = ++surface;
  m.startSurface(tag, m.Fixture, {});
  started = { m, tag };
  await settle(m);
  const byID = (testID: string): FakeNode => {
    const found = all(host.roots[tag] ?? []).find((node) => node.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found;
  };
  const focus = (node: FakeNode) => emit(node.target, "topFocus", { target: node.tag });
  const blur = (node: FakeNode) => emit(node.target, "topBlur", { target: node.tag });
  /** The `blur` commands the host sends while `run` runs. */
  const blurs = async (run: () => void) => {
    const before = host.calls.length;
    run();
    await settle(m);
    return host.calls.slice(before).filter((line) => /^dispatchCommand \d+ blur /.test(line));
  };
  return { m, log, byID, focus, blur, blurs, page: globals.__events, settle: () => settle(m) };
}
afterEach(() => {
  if (started) started.m.stopSurface(started.tag);
  started = undefined;
});

for (const platform of ["android", "ios"] as const) describe(platform, () => {
  test("Keyboard.dismiss() blurs the focused TextInput through its handle, once", async () => {
    const t = await mount(platform);
    const name = t.byID("name");
    expect(await t.blurs(() => t.page.dismiss())).toEqual([]);
    t.focus(name);
    // The input's own handler still hears the event, and its `ref` still gets the handle.
    expect(t.log).toEqual(["name focus"]);
    expect(typeof (t.page.given() as { blur?: unknown } | null)?.blur).toBe("function");
    expect(await t.blurs(() => t.page.dismiss())).toEqual([`dispatchCommand ${name.tag} blur []`]);
    // React Native's dismiss forgets the input it blurred: a second one sends nothing.
    expect(await t.blurs(() => t.page.dismiss())).toEqual([]);
  });

  test("the input that has focus last is the one blurred", async () => {
    const t = await mount(platform);
    t.focus(t.byID("name"));
    t.focus(t.byID("other"));
    expect(await t.blurs(() => t.page.dismiss())).toEqual([`dispatchCommand ${t.byID("other").tag} blur []`]);
  });

  test("an input that lost focus is not blurred; a focused one that goes is blurred once, as it goes", async () => {
    const t = await mount(platform);
    const name = t.byID("name");
    t.focus(name);
    t.blur(name);
    expect(t.log).toEqual(["name focus", "name blur"]);
    expect(await t.blurs(() => t.page.dismiss())).toEqual([]);
    // A focused input that is destroyed is blurred as it goes, as React Native's is, and forgotten.
    const gone = t.byID("gone");
    t.focus(gone);
    expect(await t.blurs(() => t.page.hide())).toEqual([`dispatchCommand ${gone.tag} blur []`]);
    expect(() => t.byID("gone")).toThrow();
    expect(await t.blurs(() => t.page.dismiss())).toEqual([]);
  });
});

test("the renderer module sends a command through an element's handle and refuses anything else", () => {
  const sent: unknown[] = [];
  dispatchCommand({ dispatchCommand: (name: string, args: unknown[]) => sent.push([name, args]) }, "setTextAndSelection", [1, "a", 0, 1]);
  expect(sent).toEqual([["setTextAndSelection", [1, "a", 0, 1]]]);
  expect(() => dispatchCommand({ _nativeTag: 3 }, "blur", [])).toThrow(/handle of an element/);
  expect(() => dispatchCommand(null, "blur", [])).toThrow(/handle of an element/);
});
