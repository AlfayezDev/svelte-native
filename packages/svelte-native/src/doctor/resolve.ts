import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** The files of one installed package, by path relative to its directory: what the shape detectors read (the tests give them fixtures and the repository's own install through the same type). */
export type Reader = {
  /** The file's text, or undefined when it is not there. */
  read(path: string): string | undefined;
  /** The names in a directory, or an empty list when it is not there. */
  list(path: string): string[];
};

export function readerFor(directory: string): Reader {
  return {
    read(path) {
      try {
        return readFileSync(join(directory, path), "utf8");
      } catch {
        return undefined;
      }
    },
    list(path) {
      try {
        return readdirSync(join(directory, path));
      } catch {
        return [];
      }
    },
  };
}

export type InstalledPackage = { name: string; version: string; directory: string; json: Record<string, unknown> };

export function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The package `name` as `from` would resolve it, by Node's rule: `node_modules/<name>` in `from` and in each directory above it, where a
 * directory that is itself a `node_modules` holds `<name>` directly. That finds a hoisted install's package, a workspace's (the root's
 * `node_modules`), pnpm's link into `.pnpm`, and, from the real directory of a package, its own dependencies (the siblings pnpm puts beside it in
 * `.pnpm/<package>/node_modules`). Walking the directories is used instead of `require.resolve`, which refuses a package whose `exports` hide `package.json`.
 */
export function findPackage(name: string, from: string): InstalledPackage | undefined {
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    const candidate = join(basename(directory) === "node_modules" ? directory : join(directory, "node_modules"), name);
    const json = readJson(join(candidate, "package.json"));
    if (json && typeof json.version === "string") return { name, version: json.version, directory: realpathSync(candidate), json };
    if (dirname(directory) === directory) return undefined;
  }
}

/** The nearest ancestor of `from` (itself included) that holds `file`. */
export function findUp(file: string, from: string): string | undefined {
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    if (existsSync(join(directory, file))) return directory;
    if (dirname(directory) === directory) return undefined;
  }
}
