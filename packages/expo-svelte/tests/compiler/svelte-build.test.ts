import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertCustomRenderer, customRendererMessage, inspectSvelte, requiredSvelte } from "../../src/svelte-build.ts";
import { packageRoot, repoRoot } from "../support/paths.ts";

// The library compiles with Svelte 5.59.1 from the registry. A release before 5.59.0 has no custom renderers, so an app that installs an older `svelte` gets a compiler that
// rejects the `customRenderer` option and nothing says why. The Metro integration, the transformer and the Vite plugin check the installed package for the `./renderer` export first and name the fix.
const made: string[] = [];
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

/** A `svelte` package directory as a release before 5.59.0 (no `./renderer`) or one with custom renderers has it. */
function fakeSvelte(options: { renderer: boolean; file?: boolean; version?: string }): string {
  const directory = mkdtempSync(join(tmpdir(), "expo-svelte-svelte-"));
  made.push(directory);
  const exports: Record<string, unknown> = { ".": "./src/index-server.js", "./compiler": "./src/compiler/index.js", "./package.json": "./package.json" };
  if (options.renderer) exports["./renderer"] = { default: "./src/renderer/index.js" };
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "svelte", version: options.version ?? requiredSvelte.version, exports }));
  if (options.renderer && options.file !== false) {
    mkdirSync(join(directory, "src/renderer"), { recursive: true });
    writeFileSync(join(directory, "src/renderer/index.js"), "export {};");
  }
  return join(directory, "package.json");
}

describe("the Svelte this library needs", () => {
  test("the Svelte this repository installs is that release", () => {
    const inspection = inspectSvelte();
    expect(inspection.ok).toBe(true);
    expect(inspection.ok && inspection.version).toBe(requiredSvelte.version);
    expect(() => assertCustomRenderer("a test")).not.toThrow();
  });

  test("the peer range and the repository's own dependency name that release, and the repository's patch is for it", () => {
    const own = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { peerDependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(own.peerDependencies.svelte).toBe(requiredSvelte.version);
    expect(own.devDependencies.svelte).toBe(requiredSvelte.version);
    expect(readFileSync(resolve(repoRoot, "pnpm-workspace.yaml"), "utf8")).toContain(`svelte@${requiredSvelte.version}: patches/svelte@${requiredSvelte.version}.patch`);
  });

  test("a release before custom renderers (no ./renderer) is refused with the fix", () => {
    const old = fakeSvelte({ renderer: false, version: "5.56.7" });
    const inspection = inspectSvelte(old);
    expect(inspection).toMatchObject({ ok: false, reason: "no-renderer", version: "5.56.7" });
    let message = "";
    try {
      assertCustomRenderer("The Metro transformer of expo-svelte", old);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`The Metro transformer of expo-svelte needs Svelte ${requiredSvelte.version}, with custom renderers`);
    expect(message).toContain("has no `./renderer` export");
    expect(message).toContain(requiredSvelte.firstWithRenderer);
    expect(message).toContain(`pnpm add svelte@${requiredSvelte.version}`);
  });

  test("a build whose ./renderer file is missing is refused too, and one with custom renderers is accepted", () => {
    expect(inspectSvelte(fakeSvelte({ renderer: true, file: false }))).toMatchObject({ ok: false, reason: "no-renderer" });
    expect(inspectSvelte(fakeSvelte({ renderer: true }))).toMatchObject({ ok: true, version: requiredSvelte.version });
    expect(() => assertCustomRenderer("a test", fakeSvelte({ renderer: true }))).not.toThrow();
  });

  test("a missing svelte says so", () => {
    const message = customRendererMessage({ ok: false, version: null, directory: null, reason: "missing" }, "withExpoSvelte");
    expect(message).toContain("No `svelte` package can be resolved");
    expect(message).toContain(`pnpm add svelte@${requiredSvelte.version}`);
  });

  test("the Metro integration, the transformer and the native Vite target check before they need the renderer", () => {
    const source = (file: string) => readFileSync(resolve(packageRoot, "src", file), "utf8");
    expect(source("metro.ts")).toContain('assertCustomRenderer("withExpoSvelte (expo-svelte/metro)")');
    expect(source("transformer.ts")).toMatch(/requireCustomRenderer\(\);\s+const result = svelteCompiler\(\)\.compile\(/);
    expect(source("vite.ts")).toContain("assertCustomRenderer(");
  });
});
