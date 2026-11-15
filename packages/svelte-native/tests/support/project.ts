import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A scratch project on disk for the tests of what Metro, the CLI and the build do with files: a directory in the temp folder that is always removed, whether the test passes,
 * fails or throws while it builds the files. `using project = createProject({...})` removes it when the block ends; `withProject(files, async (project) => ...)` does the same
 * around a callback.
 */
export type Project = {
  readonly directory: string;
  /** The absolute path of a file of the project. */
  path(...parts: string[]): string;
  /** Writes a file (and the directories above it) and returns its path. */
  write(file: string, content: string): string;
  read(file: string): string;
  remove(): void;
  [Symbol.dispose](): void;
};

/** `files` maps a path inside the project to its content. */
export function createProject(files: Record<string, string> = {}, prefix = "svelte-native-project-"): Project {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const project: Project = {
    directory,
    path: (...parts) => join(directory, ...parts),
    write(file, content) {
      const path = join(directory, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    read: (file) => readFileSync(join(directory, file), "utf8"),
    remove: () => rmSync(directory, { recursive: true, force: true }),
    [Symbol.dispose]: () => project.remove(),
  };
  try {
    for (const [file, content] of Object.entries(files)) project.write(file, content);
  } catch (error) {
    project.remove();
    throw error;
  }
  return project;
}

export async function withProject<T>(files: Record<string, string>, run: (project: Project) => T | Promise<T>): Promise<T> {
  const project = createProject(files);
  try {
    return await run(project);
  } finally {
    project.remove();
  }
}
