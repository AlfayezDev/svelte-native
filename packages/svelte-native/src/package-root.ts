import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Where the package is on disk, found from wherever its Node-side code runs: `src/` in the repository, `dist/node/` once built (the entries Node
 * loads, `scripts/build-node.ts`), in the repository's workspace link and in an app's `node_modules` alike. The Node-side code reaches the
 * TypeScript that Metro and Vite compile (the React Native runtime, the remote function shims) and the package's data (`patches/`) by path, never
 * by a relative import, which the built files do not share with the sources.
 */
function findPackageRoot(from: string): string {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (dirname(directory) === directory) throw new Error(`No package.json above ${from}: the package's files moved`);
  }
}

export const packageRoot = findPackageRoot(import.meta.dirname);

/** The TypeScript sources: what Metro and Vite compile. They ship in the package next to `dist/`. */
export const sourceDirectory = join(packageRoot, "src");

/** The absolute path of a source file given relative to `src/` (`fabric/react-native-lite.ts`, `./init.ts`); throws if the package does not carry it. */
export function sourceFile(path: string): string {
  const file = resolve(sourceDirectory, path);
  if (!existsSync(file)) throw new Error(`${file} is not in the package: the Node-side code names a source file that is missing`);
  return file;
}
