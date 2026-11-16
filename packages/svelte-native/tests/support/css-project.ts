import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The repository's Tailwind, which the test projects link as their own (the build loads the app's `tailwindcss` from its project). */
export const tailwindDirectory = dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json"));

const made: string[] = [];

/** Removes every project `cssProject` made; call it from `afterAll`. */
export function removeCssProjects(): void {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
}

/**
 * A project directory with `files` (paths relative to it), the app's `src/global.css` and a `src/routes/+mobile.svelte` that uses classes, unless
 * `files` says otherwise, and Tailwind linked into its `node_modules` unless `tailwind` is false.
 */
export function cssProject(files: Record<string, string> = {}, { tailwind = true }: { tailwind?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "svelte-native-css-"));
  made.push(root);
  const all: Record<string, string> = {
    "src/global.css": '@import "tailwindcss";\n\n.card { padding: 4px; }\n',
    "src/routes/+mobile.svelte": '<View class="p-4 card dark:bg-slate-900 md:p-10" />\n<Text class={["text-sm", on && "text-red-500"]} class:tracking-wide={on}>hi</Text>\n',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  // A project always has a `node_modules`: Bun (which runs the build's child process in these tests) installs a missing package from the registry when it finds none.
  mkdirSync(join(root, "node_modules"), { recursive: true });
  if (tailwind) symlinkSync(tailwindDirectory, join(root, "node_modules/tailwindcss"));
  return root;
}
