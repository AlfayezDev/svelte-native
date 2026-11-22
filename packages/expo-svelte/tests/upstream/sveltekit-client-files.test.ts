// biome-ignore-all lint/suspicious/noExplicitAny: a structural walk of the Babel AST
// SvelteKit's client files, which run on the device (`src/remote` brings them in through the transformer and the resolver of `src/remote/transform.ts`), read as text: what the
// files that were reviewed use, and the versions of SvelteKit that were. These fail on a SvelteKit update on purpose, until the update is compared with the port (`src/remote/form.svelte.ts`,
// README "Forms", REFERENCE "The native form") and with the globals the transformer gives the files; `kit/remote-transform.test.ts` is what the build does with them.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import globals from "globals";
import { kitGlobalsImport, kitRoot } from "../../src/remote/transform.ts";
import { peerRange } from "../support/versions.ts";

const nodeRequire = createRequire(import.meta.url);

describe("SvelteKit's client files", () => {
  const kit = kitRoot();
  const functions = join(kit, "src/runtime/client/remote-functions");
  const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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
    // 3.1.1. After comparing the new file with `src/remote/form.svelte.ts` (README, "Forms"; REFERENCE, "The native form"), put its hash here.
    expect(hash).toBe("249ac3ccb82d2125631a8fcae73a3f28757c7a356fd556e195ab2977a8a39696");
  });

  test("the peer dependency on SvelteKit is the version that was reviewed, and Expo's constants are a peer", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as { peerDependenciesMeta?: Record<string, unknown> };
    const version = (JSON.parse(readFileSync(join(kit, "package.json"), "utf8")) as { version: string }).version;
    expect(peerRange("@sveltejs/kit")).toBe(version);
    expect(peerRange("expo-constants")).toBeDefined();
    expect(manifest.peerDependenciesMeta?.["expo-constants"]).toBeUndefined();
  });

  test("every import of the on-device files is a relative file, a package, or one of the specifiers that is redirected", () => {
    const redirected = new Set(["#internal", "#app/internal/transport", "#app/paths", "#app/state/client", "$app/env", "@sveltejs/kit/internal", "esm-env", "svelte", "devalue"]);
    const unexpected = [...onDevice().keys()].flatMap((path) => [...code(path).matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith(".") && !redirected.has(specifier)).map((specifier) => `${relative(kit, path)}: ${specifier}`));
    expect(unexpected).toEqual([]);
  });});
