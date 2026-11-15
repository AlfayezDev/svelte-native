import { readFileSync } from "node:fs";
import { resolve } from "node:path";


/** The names a `declare module` of SvelteKit's types exports as values (a function, a constant or a class), sorted: what the device's module has to have. */
export function kitExports(module: string): string[] {
  const types = readFileSync(resolve(import.meta.dirname, "../../../../../node_modules/@sveltejs/kit/types/index.d.ts"), "utf8");
  const start = types.indexOf(`declare module '${module}' {`);
  const block = types.slice(start, types.indexOf("\n}\n", start));
  return [...block.matchAll(/^\texport (?:declare )?(?:function|const|class) (\w+)/gm)].map((match) => match[1] ?? "").toSorted();
}
