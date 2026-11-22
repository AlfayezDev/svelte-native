import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vendoredRoot } from "../../src/vendored.ts";
import { createProject } from "../support/project.ts";

/**
 * The Worklets Babel plugin comes from the library's own copy (`vendor/react-native-worklets`, VENDORING.md). `babel-preset-expo` adds it when it can resolve `react-native-worklets/plugin` from the
 * app, and no app has that package any more; one that has (pnpm installs it beside Expo Router, which asks for it as a peer) has another version than the copy the library links and bundles. The
 * transformer makes that name resolve to the copy's plugin (`src/transformer.ts`), so the preset adds it once, where it always does, and it is the copy's. These run the real transformer in Node, in app
 * directories made here: one with no `react-native-worklets` in its `node_modules`, and one with an original whose plugin must never load.
 */
const copy = join(vendoredRoot("react-native-worklets"), "plugin/index.js");
const projects: { remove(): void }[] = [];
afterAll(() => { for (const project of projects) project.remove(); });

type Outcome = { code: string; fromApp: string; fromPreset: string; reanimatedFromApp: string; loaded: string[] };
function run(files: Record<string, string> = {}): Outcome {
  const project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies: {} }), ...files }, "worklets-plugin-");
  projects.push(project);
  const done = spawnSync("node", [join(import.meta.dirname, "fixtures/worklets-plugin-probe.ts"), project.directory, "src/styles.ts"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: project.directory });
  if (done.status !== 0) throw new Error(`the worklets probe failed:\n${done.stderr.slice(-2500)}`);
  return JSON.parse(done.stdout.trim().split("\n").at(-1) as string) as Outcome;
}

describe("the transformer adds the Worklets plugin from the vendored copy", () => {
  const without = run();

  test("in an app that has no react-native-worklets: the worklets of a file are workletized, each once, by the copy's plugin", () => {
    // `__workletHash` and `__initData` are what the plugin puts on a function with the "worklet" directive.
    expect(without.code.match(/__workletHash/g)?.length).toBe(2);
    expect(without.code.match(/__initData/g)?.length).toBe(2);
    expect(without.code).not.toContain('"worklet"');
    // The closure (an array of the variables since Worklets 0.13) of the first worklet is `width`, and of the second `grow`: what each captures, no more (the plugin names a worklet after its file and its place in it).
    expect(without.code).toMatch(/stylesTs1\.__closure = \[\s*width\s*\]/);
    expect(without.code).toMatch(/stylesTs2\.__closure = \[\s*grow\s*\]/);
  });

  test("the name is the copy's plugin for whoever resolves it: the app's directory and babel-preset-expo's own lookup", () => {
    expect(without.fromApp).toBe(copy);
    expect(without.fromPreset).toBe(copy);
    // Reanimated's name for it, which an app's Babel config from before Reanimated 4 lists, is Reanimated's copy, which re-exports the Worklets plugin.
    expect(without.reanimatedFromApp).toBe(join(vendoredRoot("react-native-reanimated"), "plugin/index.js"));
    expect(without.loaded.length).toBeGreaterThan(0);
    expect(without.loaded.every((path) => path.startsWith(vendoredRoot("react-native-worklets")))).toBe(true);
  });

  test("in an app that has an original (a peer of another library, at another version): the copy's plugin runs, once, and the original's never loads", () => {
    const original = {
      "node_modules/react-native-worklets/package.json": JSON.stringify({ name: "react-native-worklets", version: "0.5.0" }),
      "node_modules/react-native-worklets/plugin/index.js": 'throw new Error("the original Worklets plugin must not load: the library carries its own");\n',
    };
    const found = run(original);
    expect(found.fromApp).toBe(copy);
    expect(found.fromPreset).toBe(copy);
    expect(found.code.match(/__workletHash/g)?.length).toBe(2);
    expect(found.code).toBe(without.code);
  });

  test("the plugin the copy carries is the one the patches and the version pin are about: 0.13.0, with the Babel packages it requires declared by the library", () => {
    const manifest = JSON.parse(readFileSync(join(vendoredRoot("react-native-worklets"), "package.json"), "utf8")) as { version: string };
    expect(manifest.version).toBe("0.13.0");
    const library = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as { dependencies: Record<string, string> };
    const required = [...readFileSync(copy, "utf8").matchAll(/require\("(@babel\/[\w-]+|convert-source-map)"\)/g)].map((match) => match[1] ?? "");
    for (const name of new Set(required)) expect([name, name === "@babel/core" || name in library.dependencies]).toEqual([name, true]);
  });
});
