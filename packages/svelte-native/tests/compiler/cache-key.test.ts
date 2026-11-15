import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cacheKeyFiles } from "../../src/transformer-cache.ts";

/**
 * Metro keeps what the transformer made of a file until the cache key changes, so every module the lowering reads (what turns an HTML element into native ones, and the
 * converter of `css/` that turns a `style="..."` string into a style) has to be in the key, or an edit to it would leave the old output in the cache. The modules are found
 * from `lower.ts` by their imports, so a new one is caught.
 */
const source = resolve(import.meta.dirname, "../../src");

/** The files `entry` imports by a relative path, and what they import, in the package's source. */
function imported(entry: string, found = new Set<string>()): Set<string> {
  if (found.has(entry)) return found;
  found.add(entry);
  for (const match of readFileSync(entry, "utf8").matchAll(/^(?:import|export)\s[^"']*?from\s+["'](\.[^"']+)["']/gm)) imported(resolve(dirname(entry), match[1] as string), found);
  return found;
}

test("the cache key holds every module the lowering of a .svelte file is made of", () => {
  const files = new Set(cacheKeyFiles(resolve(source, "transformer.ts"), source));
  const missing = [...imported(resolve(source, "lower.ts")), ...imported(resolve(source, "transformer-cache.ts"))].filter((file) => !files.has(file) && !file.endsWith("package-root.ts"));
  expect(missing).toEqual([]);
  // The converter of the style strings is one of them.
  expect([...files].some((file) => file.endsWith("css/inline.ts"))).toBe(true);
  expect([...files].some((file) => file.endsWith("css/properties.ts"))).toBe(true);
});
