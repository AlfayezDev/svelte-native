import { resolve } from "node:path";

/** Where the package, the repository around it and the libraries installed in it are, for a test that reads what a library or the package ships. */
export const packageRoot = resolve(import.meta.dirname, "../..");
export const repoRoot = resolve(packageRoot, "../..");
export const nodeModules = resolve(repoRoot, "node_modules");
