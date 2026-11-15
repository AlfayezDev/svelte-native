import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * `mobile` is `false` in the web build. The Vite plugin the app's `vite.config.ts` has (`svelteNative()`) answers `$app/env` and `$app/environment` with SvelteKit's own module plus `mobile`.
 * The fixture is a real SvelteKit app (tests/kit/fixtures/web-mobile-app) and a real Vite: `vite dev` rendering on the server and serving the client's modules, and the production build of the client and the server.
 */
const fixture = join(import.meta.dirname, "fixtures/web-mobile-app");
// SvelteKit's own directory of the fixture (git ignores it): its build output has to sit below the app, where the packages it imports resolve.
const kitDirectory = join(fixture, ".svelte-kit");
afterAll(() => rmSync(kitDirectory, { recursive: true, force: true }));

function probe<T>(mode: "dev" | "build"): T {
  const done = Bun.spawnSync(["node", join(import.meta.dirname, "fixtures/web-mobile-probe.ts"), mode, kitDirectory], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`the web probe failed:\n${done.stderr.toString().slice(-2000)}`);
  return JSON.parse(done.stdout.toString().trim().split("\n").at(-1) as string) as T;
}

describe("mobile in the web build", () => {
  test("vite dev: the page renders mobile as false on the server, and the client gets SvelteKit's module with mobile = false added", () => {
    const { rendered, modules } = probe<{ rendered: string; modules: string[] }>("dev");
    expect(rendered).toBe("mobile=false deprecated=false shared=on the web browser=false");
    // One module per name (`$app/env` and `$app/environment`), each re-exporting SvelteKit's real file.
    expect(modules).toHaveLength(2);
    expect(modules.map((text) => /^export \* from "\/@fs\/.+\/@sveltejs\/kit\/src\/runtime\/app\/(env|environment)\/index\.js[^"]*";\nexport const mobile = false;$/.exec(text)?.[1])).toEqual(["env", "environment"]);
  }, 60_000);

  test("vite build: the server renders mobile as false, and the client's page and shared module hold the web side of `mobile ? … : …`", () => {
    const { server, client } = probe<{ server: string; client: string[] }>("build");
    expect(server).toContain(`mobile=\${escape_html(String(false))} deprecated=\${escape_html(String(false))}`);
    expect(server).toContain('var shared = "on the web";');
    expect(server).not.toContain("on a phone");
    const page = client.find((text) => text.includes("on the web"));
    expect(page).toBeDefined();
    expect(client.some((text) => text.includes("on a phone"))).toBe(false);
  }, 120_000);
});

describe("mobile in an app's type check", () => {
  // The fixture's tsconfig has what a SvelteKit project's generated one has (SvelteKit's declarations in every program). `mobile` comes from the library's declaration, which a program
  // reaches through the plugin its `vite.config.ts` imports (the web's) or through the router its screens import (the device's).
  const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");
  const check = (config: string) => {
    const done = Bun.spawnSync(["node", tsc, "-p", join(fixture, config)], { stdout: "pipe", stderr: "pipe" });
    return { exitCode: done.exitCode, output: done.stdout.toString() };
  };

  test("a program with vite.config.ts types `mobile` as a boolean next to SvelteKit's own names of `$app/env` and `$app/environment`", () => {
    expect(check("tsconfig.json")).toEqual({ exitCode: 0, output: "" });
  });

  test("a program of the device's files, which import the router and not the Vite plugin, types it too", () => {
    expect(check("tsconfig.native.json")).toEqual({ exitCode: 0, output: "" });
  });

  test("without either, `mobile` is the name missing: the declaration is what adds it, and SvelteKit's own names are untouched", () => {
    const { exitCode, output } = check("tsconfig.bare.json");
    expect(exitCode).not.toBe(0);
    expect(output).toContain(`src/shared.ts(2,34): error TS2305: Module '"$app/env"' has no exported member 'mobile'.`);
    // SvelteKit 3 declares no `$app/environment`; the library's declaration does.
    expect(output).toContain(`error TS2307: Cannot find module '$app/environment'`);
    expect(output).not.toMatch(/has no exported member '(browser|building|dev|version)'/);
  });
});
