import { build } from "esbuild";
import { evaluate } from "../../support/bundle.ts";
import { nodeModules } from "../../support/paths.ts";

/**
 * A library's own source, bundled with the modules it takes from React Native and Expo replaced by stand-ins, and evaluated: the oracle of a differential test, which runs the
 * same inputs through the library's code and through this package's port of it. A stand-in is the source of an ES module, for an import path (a string) or every path a pattern
 * matches. The bundle is built once per run and evaluated afresh for each call, so the oracle's module state is the test's own.
 */
export type Stub = [match: string | RegExp, source: string];

type LibraryOptions = { entry: string; stubs: Stub[]; conditions?: string[]; /** `define` of esbuild, for example `{ __DEV__: "true" }`. */ define?: Record<string, string> };

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const built = new Map<string, Promise<string>>();

async function bundleLibrary(options: LibraryOptions): Promise<string> {
  const rules = options.stubs.map(([match, source]) => ({ filter: typeof match === "string" ? new RegExp(`^${escapeRegExp(match)}$`) : match, source }));
  const result = await build({
    stdin: { contents: options.entry, resolveDir: nodeModules },
    bundle: true, format: "esm", platform: "neutral", write: false, mainFields: ["main"],
    ...(options.conditions ? { conditions: options.conditions } : {}),
    ...(options.define ? { define: options.define } : {}),
    plugins: [{
      name: "library-stubs",
      setup(builder) {
        for (const { filter } of rules) builder.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: rules.find((rule) => rule.filter.test(args.path))?.source ?? "export {};", loader: "js" }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

/** The module `entry` (source text, imports resolved from `node_modules`) exports, with `stubs` in place of the imports they name. */
export function loadLibrary<T>(options: LibraryOptions): Promise<T> {
  const key = JSON.stringify([options.entry, options.conditions, options.define, options.stubs.map(([match, source]) => [String(match), source])]);
  let code = built.get(key);
  if (!code) {
    code = bundleLibrary(options);
    built.set(key, code);
    code.catch(() => built.delete(key));
  }
  return code.then((text) => evaluate<T>(text));
}
