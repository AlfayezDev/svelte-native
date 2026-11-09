import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The library's source imports some of React Native's modules by path (`react-native/Libraries/…`), for which `react-native` ships no types, or none with
 * a default export; `src/fabric/react-native-internals.d.ts` declares them. An app's type check (`svelte-check`) reaches the library's source files, from a
 * workspace link and from `node_modules` alike, and only the declaration files that the files it reaches import or reference. So a file that imports one of
 * those modules has to reach the declarations from every entry of the package that reaches the file: otherwise the app fails with "Could not find a declaration
 * file for module 'react-native/Libraries/…'" in the library's own code, and has to declare the modules again itself.
 *
 * This is the static side of it (the import graph of each entry, read from the source); `node-modules.test.ts` runs `svelte-check` on an app that has the packed
 * package in its `node_modules`, which is the proof that the declarations arrive.
 */
const root = resolve(import.meta.dirname, "..");
const internals = join(root, "src/fabric/react-native-internals.d.ts");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, string | Record<string, string>> };

/** The source file each entry of the package types from (the `types` condition when there is one). */
const entries = Object.entries(manifest.exports)
  .map(([name, target]) => [name, typeof target === "string" ? target : (target.types ?? target.default ?? "")] as const)
  .filter(([, file]) => /\.(?:ts|svelte)$/.test(file) && file.startsWith("./src/"));

/** The files a source file imports or references by a relative path, as TypeScript's program would pull them in (a type-only or dynamic `import()` included, a `require()` call not). */
function dependenciesOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.[^"']+)["']|\/\/\/\s*<reference\s+path="([^"]+)"/g)) {
    const specifier = match[1] ?? match[2] ?? "";
    const base = resolve(dirname(file), specifier);
    const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".d.ts"), `${base}.ts`, `${base}.svelte`, join(base, "index.ts")];
    const target = candidates.find((candidate) => existsSync(candidate) && !readdirOrNull(candidate));
    if (target) found.push(target);
  }
  return found;
}
const readdirOrNull = (path: string) => { try { return readdirSync(path); } catch { return null; } };

function closureOf(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of dependenciesOf(file)) visit(next);
  };
  visit(entry);
  return seen;
}

/** The specifiers a file imports from React Native by a path that is not the index (`react-native/Libraries/…`, `react-native/src/…`): what the ambient declarations are for. */
const deepImports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](react-native\/(?:Libraries|src)\/[^"']+)["']/g)].map((match) => match[1] ?? "");

describe("the declarations of React Native's internal modules reach an app from every entry", () => {
  test("every entry that has a source file is checked", () => {
    expect(entries.map(([name]) => name)).toContain(".");
    expect(entries.map(([name]) => name)).toContain("./platform");
    expect(entries.length).toBeGreaterThan(15);
  });

  for (const [name, target] of entries) {
    test(`${name}: what imports an internal module of React Native reaches react-native-internals.d.ts`, () => {
      const closure = closureOf(resolve(root, target));
      const needing = [...closure].filter((file) => deepImports(file).length > 0).map((file) => relative(root, file));
      if (needing.length > 0) expect([name, closure.has(internals), needing]).toEqual([name, true, needing]);
    });
  }

  test("every internal module the sources import is declared (a missing one fails the app's type check, not the library's)", () => {
    const declared = new Set([...readFileSync(internals, "utf8").matchAll(/declare module "([^"]+)"/g)].map((match) => match[1]));
    const files = readdirSync(join(root, "src"), { recursive: true, withFileTypes: true })
      .filter((item) => item.isFile() && /\.(?:ts|svelte)$/.test(item.name) && !item.name.endsWith(".d.ts"))
      .map((item) => join(item.parentPath, item.name));
    const undeclared = files.flatMap((file) => deepImports(file).filter((specifier) => !declared.has(specifier)).map((specifier) => `${relative(root, file)}: ${specifier}`));
    expect(undeclared).toEqual([]);
  });

  test("the internal declarations are a script of `declare module`s, so a reference (not an import) is how they are reached", () => {
    const text = readFileSync(internals, "utf8");
    expect(/^(?:import|export)\s/m.test(text)).toBe(false);
    expect(readFileSync(join(root, "src/elements.d.ts"), "utf8")).toContain('/// <reference path="./fabric/react-native-internals.d.ts" />');
  });
});
