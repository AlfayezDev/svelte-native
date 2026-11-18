import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { packageRoot } from "../support/paths.ts";

/**
 * The types of a vendored package for an app that does not have it (VENDORING.md). `@alfayez/svelte-native/mmkv` names MMKV's types through the library's `imports` map, and MMKV's
 * declarations name the Nitro runtime's by the package's own name, which the app does not install: `src/vendor-types.d.ts` answers to that name. The app here is a scratch directory
 * with a *copy* of what the package packs (a link would let TypeScript find the repository's own `node_modules` above the real path, where a Nitro runtime that quick-crypto's peer
 * installed may be), and nothing else: the checker has to find everything in the package.
 */
const scratch = mkdtempSync(join(tmpdir(), "svelte-native-vendored-types-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const node = Bun.which("node");

const installed = join(scratch, "node_modules/@alfayez/svelte-native");
mkdirSync(installed, { recursive: true });
for (const entry of ["package.json", "dist/types", "vendor"]) cpSync(join(packageRoot, entry), join(installed, entry), { recursive: true });

const source = `import { createMMKV, localStorageMMKV, type MMKV, type Configuration, type Mode } from "@alfayez/svelte-native/mmkv";

const storage: MMKV = createMMKV({ id: "app", mode: "multi-process" satisfies Mode } satisfies Configuration);
storage.set("name", "value");
const read: string | undefined = storage.getString("name");
// The members MMKV has from Nitro's HybridObject: only a resolved \`react-native-nitro-modules\` gives them types, an unresolved one makes them \`any\`, and these lines then do not fail.
const name: string = storage.name;
// @ts-expect-error -- \`name\` is a string (HybridObject), not a number
const wrong: number = storage.name;
// @ts-expect-error -- no such member
storage.nothingOfTheKind();
const behind: MMKV = localStorageMMKV();
export { read, name, wrong, behind };
`;
writeFileSync(join(scratch, "app.ts"), source);
const options = { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, types: [] };
writeFileSync(join(scratch, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...options, skipLibCheck: true }, files: ["app.ts"] }));

describe.skipIf(!node)("an app without MMKV or the Nitro runtime in its dependencies", () => {
  const check = (config: string) => Bun.spawnSync([node ?? "node", tsc, "-p", join(scratch, config)], { cwd: scratch, stdout: "pipe", stderr: "pipe" });

  test("`@alfayez/svelte-native/mmkv` has MMKV's types, with the Nitro runtime's under them", () => {
    const result = check("tsconfig.json");
    expect([result.exitCode, result.stdout.toString()]).toEqual([0, ""]);
  });

  test("the vendored declarations are clean on their own (skipLibCheck off), but for the two packages an app has and this scratch app lacks: react and react-native", () => {
    writeFileSync(join(scratch, "tsconfig.strict.json"), JSON.stringify({ compilerOptions: { ...options, skipLibCheck: false }, files: ["app.ts"] }));
    const result = check("tsconfig.strict.json");
    const findings = result.stdout.toString().split("\n").filter((line) => /error TS/.test(line));
    // Anything else is the copy's, or the shim's, to fix: above all a module the declarations name that nothing answers to.
    const unexpected = findings.filter((line) => !/TS2307: Cannot find module '(?:react|react-native)'/.test(line) && !/TS7016: Could not find a declaration file for module 'react(?:-native)?'/.test(line) && !/'JSX'|TS7026|TS2503|TS7006|TS7031/.test(line));
    expect(unexpected).toEqual([]);
    expect(findings.filter((line) => /Cannot find module 'react-native-nitro-modules'|Cannot find module '#vendor/.test(line))).toEqual([]);
  });

  test("without the shim the Nitro runtime's types are not found, so the test above does tell: an emptied declaration fails the app", () => {
    writeFileSync(join(installed, "dist/types/vendor-types.d.ts"), "// emptied by the test\n");
    const result = check("tsconfig.json");
    expect(result.exitCode).not.toBe(0);
  });
});

describe.skipIf(!node)("createVideoPlayer, typed from the copy of expo-video (an optional library the app does not install)", () => {
  const ts = require("typescript") as typeof import("typescript");
  const containing = join(installed, "dist/types/fabric/foreign-video-player.d.ts");
  const resolve = (name: string) => ts.resolveModuleName(name, containing, { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, ts.sys).resolvedModule?.resolvedFileName;

  test("the declaration names the copy through the library's imports map (`#vendor/expo-video/*`), which resolves to the copy's own declarations in the installed package", () => {
    const declaration = ts.sys.readFile(containing) ?? "";
    expect(declaration).toContain('"#vendor/expo-video/build/VideoPlayer"');
    expect(resolve("#vendor/expo-video/build/VideoPlayer")).toBe(join(installed, "vendor/expo-video/build/VideoPlayer.d.ts"));
    expect(resolve("#vendor/expo-video/build/VideoPlayer.types")).toBe(join(installed, "vendor/expo-video/build/VideoPlayer.types.d.ts"));
  });
});
