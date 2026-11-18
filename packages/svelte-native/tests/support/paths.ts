import { resolve } from "node:path";
import { vendoredNames } from "../../src/vendored.ts";

/** Where the package, the repository around it and the libraries installed in it are, for a test that reads what a library or the package ships. */
export const packageRoot = resolve(import.meta.dirname, "../..");
export const repoRoot = resolve(packageRoot, "../..");
export const nodeModules = resolve(repoRoot, "node_modules");

/** The library's copies of the third-party packages it carries (`vendor/<name>`, VENDORING.md): what a test reads when it checks what the packages ship, and what its bundles resolve the packages' names to. */
export const vendorRoot = resolve(packageRoot, "vendor");
export const vendored = (name: string): string => resolve(vendorRoot, name);

/**
 * `esbuild`'s `alias` for the vendored packages: each name to the directory of its copy, so `react-native-svg/src/lib/units` is a file of `vendor/react-native-svg/`. What Metro does for every
 * importer (`withSvelteNative`), for the bundles of the tests that read a package's real sources.
 */
export const vendorAliases = (): Record<string, string> => Object.fromEntries(vendoredNames.map((name) => [name, vendored(name)]));
