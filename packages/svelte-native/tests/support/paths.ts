import { resolve } from "node:path";
import { vendoredNames, vendoredRoot } from "../../src/vendored.ts";

/** Where the package, the repository around it and the libraries installed in it are, for a test that reads what a library or the package ships. */
export const packageRoot = resolve(import.meta.dirname, "../..");
export const repoRoot = resolve(packageRoot, "../..");
export const nodeModules = resolve(repoRoot, "node_modules");

/**
 * Where a file of a library is, given as the path below `node_modules` (`react-native-video/src/Video.tsx`): in the package's own `vendor/` for a library the package carries
 * (`src/vendored.ts`: the copy is what an app runs), in the repository's `node_modules` for any other.
 */
export function libraryPath(file: string): string {
  const carried = vendoredNames.filter((name) => file === name || file.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0];
  return carried === undefined ? resolve(nodeModules, file) : resolve(vendoredRoot(carried, packageRoot), file.slice(carried.length + 1));
}

/** esbuild's `alias` for the libraries the package carries: their names resolve to the copies, as Metro's do. */
export const vendoredAliases: Record<string, string> = Object.fromEntries(vendoredNames.map((name) => [name, vendoredRoot(name, packageRoot)]));
