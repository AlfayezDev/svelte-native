import { sourceDirectory, sourceFile } from "./package-root.ts";

/**
 * The files whose text is part of Metro's cache key for what the transformer makes (`getCacheKey` in `transformer.ts`): the transformer itself, and, when it runs from the sources,
 * the Node-side modules it imports (`lower.ts` and what the lowering of HTML imports: `lower-html.ts`, `html-tags.ts` and the converter of `css/` that converts a `style="..."` string;
 * `remote/transform.ts`; `compile-options.ts`; `svelte-compiler.ts`, which decides what Svelte's compiler accepts). Built (`dist/node/transformer.cjs`), the one file holds them all. `tests/cache-key.test.ts` follows the imports of `lower.ts` and fails
 * for a module that is not here.
 */
export function cacheKeyFiles(transformer: string, directory: string): string[] {
  const files = [transformer];
  if (directory === sourceDirectory) {
    files.push(
      sourceFile("transformer-cache.ts"), sourceFile("lower.ts"), sourceFile("lower-html.ts"), sourceFile("html-tags.ts"),
      ...["inline", "properties", "values", "color", "parse", "table"].map((name) => sourceFile(`css/${name}.ts`)),
      sourceFile("remote/transform.ts"), sourceFile("compile-options.ts"), sourceFile("svelte-compiler.ts"),
    );
  }
  return files;
}
