// biome-ignore-all lint/suspicious/noExplicitAny: a structural walk of the Babel AST
// What the build does with SvelteKit remote functions: the ids (SvelteKit's own hash, over the same paths), the client stubs of a `*.remote.ts` module, and
// where SvelteKit's client files and their shims are found. Pure Node: nothing here runs React Native.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@babel/parser";
import { transform } from "esbuild";
import globals from "globals";
import { hash, isRemoteModule, kitGlobalsImport, kitRoot, remoteExports, remoteHash, remoteResolution, remoteStub, RemoteModuleError, transformRemoteModule } from "../src/remote/transform.ts";

const nodeRequire = createRequire(import.meta.url);
const kitHash = (await import(pathToFileURL(join(kitRoot(), "src/utils/hash.js")).href)).hash as (...values: string[]) => string;
const ROOT = "/work/apps/example";

describe("ids", () => {
  const paths = [
    "src/lib/api.remote.ts", "src/routes/(account)/[slug]/settings/data.remote.ts", "src/remote.js", "a.remote.ts", "src/lib/ünïcode/ラベル.remote.ts",
    "../shared/outside.remote.ts", "src/routes/__dev/remote/lab.remote.ts", `${"x".repeat(300)}.remote.ts`, "",
  ];
  test("hash is SvelteKit's hash, on the paths remote modules have", () => {
    for (const path of paths) expect([path, hash(path)]).toEqual([path, kitHash(path)]);
    expect(hash("src/lib/api.remote.ts")).toBe("1ic5y8r");
  });
  test("the id is the hash of the path from the project root, with forward slashes", () => {
    expect(remoteHash(`${ROOT}/src/lib/api.remote.ts`, ROOT)).toBe(kitHash("src/lib/api.remote.ts"));
    expect(remoteHash(`${ROOT}/../shared/outside.remote.ts`, ROOT)).toBe(kitHash("../shared/outside.remote.ts"));
    expect(remoteHash(`${ROOT}/src/lib/api.remote.ts`, `${ROOT}/`)).toBe(kitHash("src/lib/api.remote.ts"));
  });
  test("which files are remote modules", () => {
    for (const file of ["/p/src/lib/api.remote.ts", "/p/src/api.remote.js", "/p/src/remote.ts", "/p/src/a.b.remote.mts"]) expect([file, isRemoteModule(file)]).toEqual([file, true]);
    for (const file of ["/p/src/lib/remote.svelte", "/p/src/api.ts", "/p/src/remoter.ts", "/p/src/remote/index.ts", "/p/node_modules/pkg/x.remote.ts", "/p/src/a.remote.ts/b.ts"]) expect([file, isRemoteModule(file)]).toEqual([file, false]);
  });
});

describe("exports and kinds", () => {
  const file = `${ROOT}/src/lib/api.remote.ts`;
  test("every kind, however it is imported or typed", () => {
    const found = remoteExports(`
      import { query as q, command, form, prerender, getRequestEvent, type RemoteQuery } from "$app/server";
      import * as server from "$app/server";
      import type * as types from "$app/server";
      import { db } from "$lib/server/db";
      import * as v from "valibot";
      export type Post = { id: number };
      export interface Options { limit: number }
      export const list = q(async () => db.all());
      export const one = q(v.string(), async (id) => db.get(id));
      export const many = q.batch(v.number(), async (ids) => (id) => id);
      export const live = q.live(async function* () { yield 1; });
      export const save = command(v.object({}), async () => {});
      export const signup = form(v.object({ name: v.string() }), async (data) => data);
      export const pre = prerender("unchecked", async () => 1, { dynamic: true }) as never;
      export const checked = (server.query(async () => 1)) satisfies unknown;
      export const nsLive = server.query.live(async function* () {});
      export const nsBatch = server["query"]["batch"](v.string(), async () => () => 1);
      const hidden = command(async () => {});
      export { hidden as reveal };
      export let late = q(async () => 1), also = command(async () => {});
    `, file);
    expect(found).toEqual([
      { name: "list", kind: "query" }, { name: "one", kind: "query" }, { name: "many", kind: "query_batch" }, { name: "live", kind: "query_live" },
      { name: "save", kind: "command" }, { name: "signup", kind: "form" }, { name: "pre", kind: "prerender" }, { name: "checked", kind: "query" },
      { name: "nsLive", kind: "query_live" }, { name: "nsBatch", kind: "query_batch" }, { name: "reveal", kind: "command" },
      { name: "late", kind: "query" }, { name: "also", kind: "command" },
    ]);
  });
  test("a .js remote module is read as JavaScript", () => {
    expect(remoteExports(`import { query } from "$app/server";\nexport const a = query(async () => 1);`, `${ROOT}/src/a.remote.js`)).toEqual([{ name: "a", kind: "query" }]);
  });
  const rejects = (source: string, message: RegExp) => {
    let error: unknown;
    try { remoteExports(source, file); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RemoteModuleError);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).toStartWith(`${file}:`);
  };
  test("an export that is not a remote function is refused, with its position", () => {
    rejects(`import { query } from "$app/server";\nexport const ok = query(async () => 1);\nexport const nope = 42;`, /^.*:3:\d+: `nope` is exported from a remote module but is not the result of a call to `query`/);
    rejects(`export const helper = (x: number) => x;`, /`helper` is exported/);
    // `query` that is not the one of $app/server
    rejects(`import { query } from "./mine.ts";\nexport const a = query(async () => 1);`, /`a` is exported/);
    rejects(`import { query } from "$app/server";\nconst make = () => query(async () => 1);\nexport const a = make();`, /`a` is exported/);
    rejects(`import { query } from "$app/server";\nexport const { a, b } = { a: query(async () => 1), b: 2 };`, /destructured/);
    rejects(`import { query } from "$app/server";\nexport function f() {}`, /`f` exported from a remote module is invalid/);
    rejects(`import { query } from "$app/server";\nexport class C {}`, /`C` exported from a remote module is invalid/);
    rejects(`import { query } from "$app/server";\nconst a = query(async () => 1);\nexport default a;`, /Cannot export `default`/);
    rejects(`export * from "./other.remote.ts";`, /`export \*`/);
    rejects(`export { a } from "./other.remote.ts";`, /re-export/);
    rejects(`import { a } from "./other.remote.ts";\nexport { a };`, /`a` is exported/);
    rejects(`export const = ;`, /cannot be parsed/);
  });
  test("a type-only export is not an export", () => {
    expect(remoteExports(`import { query } from "$app/server";\nexport type { A } from "./types.ts";\nexport type * from "./more.ts";\nexport const a = query(async () => 1);\nexport { type B };\ntype B = 1;`, file)).toEqual([{ name: "a", kind: "query" }]);
  });
});

describe("stubs", () => {
  test("what SvelteKit's plugin generates: one declaration per export, calling the client function of its kind with `<hash>/<name>`", () => {
    const source = `import { query, command } from "$app/server";\nexport const a = query(async () => 1);\nexport const b = command(async () => 1);`;
    expect(transformRemoteModule(source, `${ROOT}/src/lib/api.remote.ts`, ROOT)).toBe(
      `import * as __remote from "@rasheed/svelte-native/remote/runtime";\n\nexport const a = __remote.query("1ic5y8r/a");\nexport const b = __remote.command("1ic5y8r/b");\n`,
    );
  });
  test("reserved words are declared under an alias and exported by name; the namespace avoids the export names", () => {
    expect(remoteStub([{ name: "delete", kind: "command" }, { name: "__remote", kind: "query" }, { name: "_0", kind: "query" }, { name: "class", kind: "query_live" }, { name: "odd-name", kind: "form" }], "h")).toBe(
      `import * as __remote0 from "@rasheed/svelte-native/remote/runtime";\n\n` +
      `const _1 = __remote0.command("h/delete");\nexport const __remote = __remote0.query("h/__remote");\nexport const _0 = __remote0.query("h/_0");\n` +
      `const _2 = __remote0.query_live("h/class");\nconst _3 = __remote0.form("h/odd-name");\nexport { _1 as delete, _2 as class, _3 as "odd-name" };\n`,
    );
  });
  test("the stub is valid JavaScript", async () => {
    const stub = remoteStub([{ name: "delete", kind: "command" }, { name: "odd-name", kind: "form" }, { name: "plain", kind: "query" }], "h");
    await expect(transform(stub, { loader: "js", format: "esm" })).resolves.toBeDefined();
  });
});

describe("SvelteKit's client files", () => {
  const kit = kitRoot();
  const clientFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile() && /\.js$/.test(entry.name)).map((entry) => join(entry.parentPath, entry.name));
  const functions = join(kit, "src/runtime/client/remote-functions");
  const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the globals a file uses that a native lacks are given to it, as names of that module only", async () => {
    const prelude = kitGlobalsImport(join(functions, "shared.svelte.js"));
    expect(prelude).toBe(`\nimport { fetch, location, navigator, window, FinalizationRegistry, WeakRef, __SVELTEKIT_DEV__ } from "@rasheed/svelte-native/remote/globals";\n`);
    expect(kitGlobalsImport(join(kit, "src/runtime/form-utils.js"))).toBe(`\nimport { Blob } from "@rasheed/svelte-native/remote/globals";\n`);
    expect(kitGlobalsImport(join(kit, "src/runtime/utils.js"))).toBe(`\nimport { btoa, atob } from "@rasheed/svelte-native/remote/globals";\n`);
    expect(kitGlobalsImport(join(kit, "src/runtime/shared.js"))).toBeUndefined();
    expect(kitGlobalsImport("/app/src/routes/page.svelte")).toBeUndefined();
    // Appended, so no line of the file moves; and it still compiles (no file declares one of these names itself).
    for (const path of clientFiles(functions).filter((file) => !file.endsWith("form.svelte.js"))) {
      const source = readFileSync(path, "utf8");
      const shadowed = kitGlobalsImport(path) as string;
      expect(shadowed).toBeDefined();
      const result = await transform(source + shadowed, { loader: "js", format: "esm", sourcefile: path });
      expect(result.code.length).toBeGreaterThan(0);
      expect(source + shadowed).toStartWith(source);
    }
  });

  /**
   * The SvelteKit files that run on the device: the transitive closure of the relative imports of what `remote/runtime.ts` and the rest of the package import
   * (`runtime.ts`, `form.svelte.ts`, `config.ts`, `shims/client.ts`), less the router client the shims replace, with the free names of each (Babel's scope analysis).
   */
  const roots = [
    "src/runtime/client/remote-functions/command.svelte.js", "src/runtime/client/remote-functions/prerender.svelte.js", "src/runtime/client/remote-functions/query/index.js",
    "src/runtime/client/remote-functions/query-batch.svelte.js", "src/runtime/client/remote-functions/query-live/index.js", "src/runtime/client/remote-functions/shared.svelte.js",
    "src/runtime/form-utils.js", "src/runtime/app/internal/transport.js", "src/exports/internal/index.js", "src/exports/internal/client.js",
  ].map((path) => join(kit, path));
  function onDevice() {
    const traverse = nodeRequire("@babel/traverse").default as (ast: unknown, visitor: Record<string, (path: any) => void>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    const found = new Map<string, Set<string>>();
    const visit = (file: string) => {
      if (found.has(file)) return;
      const ast = parse(readFileSync(file, "utf8"), { sourceType: "module" });
      const free = new Set<string>();
      traverse(ast, { Program: (path) => { for (const name of Object.keys(path.scope.globals)) free.add(name); } });
      found.set(file, free);
      traverse(ast, {
        "ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration": (path) => {
          const specifier = path.node.source?.value as string | undefined;
          if (!specifier?.startsWith(".")) return;
          let next = resolve(dirname(file), specifier);
          if (!existsSync(next) && existsSync(`${next}.js`)) next += ".js";
          if (next !== join(kit, "src/runtime/client/client.js")) visit(next);
        },
      });
    };
    roots.forEach(visit);
    return found;
  }
  /** What the file is given by the transformer, by name. */
  const shadowsOf = (file: string): string[] => /import \{ ([^}]+) \}/.exec(kitGlobalsImport(file) ?? "")?.[1].split(", ") ?? [];
  /** What React Native 0.86 (Hermes 0.17), Expo SDK 57's winter runtime and the streams polyfill Expo's Metro adds give every module. */
  const platform = new Set(["AbortController", "Blob", "File", "Headers", "Response", "Request", "ReadableStream", "TextDecoder", "TextEncoder", "URL", "URLSearchParams", "console", "setTimeout", "clearTimeout", "queueMicrotask", "DOMException"]);
  /**
   * Names that are in the files but behind `typeof x !== 'undefined'`, or in code the device never runs: `file` -> names. (`DataTransfer` is in the field proxy's
   * `as('file')`, which the native `as` replaces; `caches` is the Cache API `prerender` uses when it is there; `get_origin` is the browser router's.)
   */
  const guardedIn: Record<string, string[]> = { "src/runtime/form-utils.js": ["DataTransfer"], "src/runtime/client/remote-functions/prerender.svelte.js": ["caches"], "src/exports/internal/client.js": ["window"] };
  const guarded = (file: string, name: string) => (guardedIn[relative(kit, file)] ?? []).includes(name);
  const runes = (name: string) => name.startsWith("$");
  // Hermes has none of FinalizationRegistry: it is not a builtin here, so a file that names it must be given one.
  const builtin = new Set(Object.keys(globals.builtin).filter((name) => name !== "FinalizationRegistry"));
  const dom = new Set([...readFileSync(nodeRequire.resolve("typescript/lib/lib.dom.d.ts"), "utf8").matchAll(/^declare (?:var|function) (\w+)\b/gm)].map((match) => match[1]));

  test("the on-device files are found as a closure of imports, not a list: the roots' relative imports, transport, internal, utils", () => {
    const files = [...onDevice().keys()].map((file) => relative(kit, file));
    for (const expected of ["src/runtime/form-utils.js", "src/runtime/app/internal/transport.js", "src/exports/internal/shared.js", "src/utils/functions.js", "src/utils/promise.js", "src/utils/shared-iterator.js", "src/runtime/client/sse.js", "src/runtime/client/stream.js", "src/runtime/utils.js", "src/runtime/shared.js", "src/runtime/client/remote-functions/cache.svelte.js"]) expect(files).toContain(expected);
    expect(files).not.toContain("src/runtime/client/client.js");
    expect(files).not.toContain("src/runtime/client/remote-functions/form.svelte.js");
  });

  test("they use no browser global that this package does not provide (review a SvelteKit update that changes this)", () => {
    const problems: string[] = [];
    for (const [file, free] of onDevice()) {
      const given = new Set([...shadowsOf(file), ...platform]);
      for (const name of free) {
        if (runes(name) || builtin.has(name) || given.has(name) || guarded(file, name)) continue;
        problems.push(`${relative(kit, file)}: ${name} (${dom.has(name) ? "a browser global" : "not a global the engine is known to have"})`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the browser globals the files use are exactly the ones the transformer gives them, and the platform's", () => {
    const used = new Map<string, string[]>();
    for (const [file, free] of onDevice()) for (const name of free) if (dom.has(name) && !builtin.has(name) && !runes(name)) used.set(name, [...(used.get(name) ?? []), relative(kit, file)]);
    const names = [...used.keys()].toSorted();
    // Every one of them is given by a shadow, by the platform, or is behind a guard; a name added to a list above without being used here is dead.
    for (const name of names) {
      const files = used.get(name) as string[];
      const given = platform.has(name) || files.every((file) => shadowsOf(join(kit, file)).includes(name) || guarded(join(kit, file), name));
      expect([name, given]).toEqual([name, true]);
    }
    expect(names).toEqual(expect.arrayContaining(["fetch", "location", "navigator", "window", "Blob", "atob", "btoa"]));
  });

  test("SvelteKit's form.svelte.js, which remote/form.svelte.ts is ported from, is the file that was reviewed: a change to it fails here until the port is compared", () => {
    const hash = createHash("sha256").update(readFileSync(join(functions, "form.svelte.js"))).digest("hex");
    // 3.0.0-next.27. After comparing the new file with `src/remote/form.svelte.ts` (README, "Forms"; REFERENCE, "The native form"), put its hash here.
    expect(hash).toBe("a25759090af9eb8e09571cd54af982d15bb8d308e9abc187e97da884533eadfa");
  });

  test("the peer dependency on SvelteKit is the version that was reviewed, and Expo's constants are a peer", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { peerDependencies: Record<string, string>; peerDependenciesMeta?: Record<string, unknown> };
    const version = (JSON.parse(readFileSync(join(kit, "package.json"), "utf8")) as { version: string }).version;
    expect(manifest.peerDependencies["@sveltejs/kit"]).toBe(version);
    expect(manifest.peerDependencies["expo-constants"]).toBeDefined();
    expect(manifest.peerDependenciesMeta?.["expo-constants"]).toBeUndefined();
  });

  test("remote function imports resolve to SvelteKit's files, the shims or nothing", () => {
    const at = (name: string) => join(functions, name);
    expect(remoteResolution("@sveltejs/kit/src/runtime/form-utils.js", "/x/src/remote/form.svelte.ts")).toBe(join(kit, "src/runtime/form-utils.js"));
    expect(remoteResolution("@sveltejs/kit/internal", "/x/y.ts")).toBe(join(kit, "src/exports/internal/index.js"));
    expect(remoteResolution("#internal", at("shared.svelte.js"))).toBe(join(kit, "src/exports/internal/client.js"));
    expect(remoteResolution("#app/internal/transport", join(kit, "src/runtime/shared.js"))).toBe(join(kit, "src/runtime/app/internal/transport.js"));
    expect(remoteResolution("#app/paths", at("command.svelte.js"))).toEndWith("remote/shims/paths.ts");
    expect(remoteResolution("#app/state/client", at("shared.svelte.js"))).toEndWith("remote/shims/state.ts");
    expect(remoteResolution("$app/env", at("prerender.svelte.js"))).toEndWith("remote/shims/env.ts");
    expect(remoteResolution("../client.js", at("shared.svelte.js"))).toEndWith("remote/shims/client.ts");
    expect(remoteResolution("../../client.js", at("query/proxy.js"))).toEndWith("remote/shims/client.ts");
    // Only from inside SvelteKit.
    expect(remoteResolution("#app/paths", "/app/src/lib/x.ts")).toBeUndefined();
    expect(remoteResolution("../client.js", "/app/src/lib/x.ts")).toBeUndefined();
    expect(remoteResolution("./utils.js", at("shared.svelte.js"))).toBeUndefined();
    expect(remoteResolution("svelte", at("shared.svelte.js"))).toBeUndefined();
  });

  test("every import of the on-device files is a relative file, a package, or one of the specifiers that is redirected", () => {
    const redirected = new Set(["#internal", "#app/internal/transport", "#app/paths", "#app/state/client", "$app/env", "@sveltejs/kit/internal", "esm-env", "svelte", "devalue"]);
    const unexpected = [...onDevice().keys()].flatMap((path) => [...code(path).matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith(".") && !redirected.has(specifier)).map((specifier) => `${relative(kit, path)}: ${specifier}`));
    expect(unexpected).toEqual([]);
  });
});
