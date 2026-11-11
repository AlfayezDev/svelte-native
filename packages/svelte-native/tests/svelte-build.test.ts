import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertCustomRenderer, customRendererMessage, inspectSvelte, requiredSvelte } from "../src/svelte-build.ts";

// The library compiles with the custom-renderer build of Svelte (an unmerged pull request) whose version string is the release's, so an app that
// installs `svelte` from the registry gets the wrong compiler and nothing says so until the compiler rejects an option. The Metro integration,
// the transformer and the Vite plugin check the installed package for the `./renderer` export first and name the fix.
const made: string[] = [];
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

/** A `svelte` package directory as the registry's release (no `./renderer`) or the pull request's build has it. */
function fakeSvelte(options: { renderer: boolean; file?: boolean; version?: string }): string {
  const directory = mkdtempSync(join(tmpdir(), "svelte-native-svelte-"));
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

describe("the Svelte build this library needs", () => {
  test("the Svelte this repository installs is that build", () => {
    const inspection = inspectSvelte();
    expect(inspection.ok).toBe(true);
    expect(inspection.ok && inspection.version).toBe(requiredSvelte.version);
    expect(() => assertCustomRenderer("a test")).not.toThrow();
  });

  test("the vendored tarball, the pinned commit and the peer range name one build", () => {
    const vendored = resolve(import.meta.dirname, "../../..", requiredSvelte.vendored);
    expect(vendored).toContain(requiredSvelte.commit.slice(0, 7));
    expect(requiredSvelte.preview.endsWith(requiredSvelte.commit)).toBe(true);
    const manifest = JSON.parse(Bun.spawnSync(["tar", "-xzOf", vendored, "package/package.json"]).stdout.toString()) as { version: string; exports: Record<string, unknown> };
    expect(manifest.version).toBe(requiredSvelte.version);
    expect(Object.keys(manifest.exports)).toContain("./renderer");
    const own = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as { peerDependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(own.peerDependencies.svelte).toBe(requiredSvelte.version);
    expect(own.devDependencies.svelte).toBe(`file:../../${requiredSvelte.vendored}`);
  });

  test("a stock release (same version, no ./renderer) is refused with the fix", () => {
    const stock = fakeSvelte({ renderer: false });
    const inspection = inspectSvelte(stock);
    expect(inspection).toMatchObject({ ok: false, reason: "stock-release", version: requiredSvelte.version });
    let message = "";
    try {
      assertCustomRenderer("The Metro transformer of @rasheed/svelte-native", stock);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("The Metro transformer of @rasheed/svelte-native needs the custom-renderer build of Svelte");
    expect(message).toContain("has no `./renderer` export");
    expect(message).toContain(requiredSvelte.pullRequest);
    expect(message).toContain(`pnpm add svelte@${requiredSvelte.preview}`);
    expect(message).toContain(requiredSvelte.vendored);
  });

  test("a build whose ./renderer file is missing is refused too, and the pull request's build is accepted", () => {
    expect(inspectSvelte(fakeSvelte({ renderer: true, file: false }))).toMatchObject({ ok: false, reason: "stock-release" });
    expect(inspectSvelte(fakeSvelte({ renderer: true }))).toMatchObject({ ok: true, version: requiredSvelte.version });
    expect(() => assertCustomRenderer("a test", fakeSvelte({ renderer: true }))).not.toThrow();
  });

  test("a missing svelte says so", () => {
    const message = customRendererMessage({ ok: false, version: null, directory: null, reason: "missing" }, "withSvelteNative");
    expect(message).toContain("No `svelte` package can be resolved");
    expect(message).toContain(requiredSvelte.preview);
  });

  test("the Metro integration, the transformer and the native Vite target check before they need the renderer", () => {
    const source = (file: string) => readFileSync(resolve(import.meta.dirname, "../src", file), "utf8");
    expect(source("metro.ts")).toContain('assertCustomRenderer("withSvelteNative (@rasheed/svelte-native/metro)")');
    expect(source("transformer.ts")).toMatch(/requireCustomRenderer\(\);\s+const result = svelteCompiler\(\)\.compile\(/);
    expect(source("vite.ts")).toContain("assertCustomRenderer(");
  });
});
