import { afterEach } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../../src/init-app.ts";
import { createProject, type Project } from "../../support/project.ts";

/**
 * The projects `expo-svelte init` is run on (`cli/init-app.test.ts`, `package/docs-examples.test.ts`): a copy of `tests/cli/fixtures/sv-minimal`, which is what sv 1.3.0 writes for the
 * minimal template with TypeScript, no add-ons and pnpm.
 */
export const fixture = join(import.meta.dirname, "../fixtures/sv-minimal");
export const library = "git+ssh://git@github.com/AlfayezDev/svelte-native.git#v0.3.0&path:packages/expo-svelte";

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON of a project's files, read by path in the assertions */
// biome-ignore lint/suspicious/noExplicitAny: the same
export type Json = Record<string, any>;
export const readJson = (root: string, file: string): Json => JSON.parse(readFileSync(join(root, file), "utf8")) as Json;

/** Call it at the top level of a file: the projects its tests make are removed after each test. */
export function initProjects() {
  const projects: Project[] = [];
  afterEach(() => { for (const made of projects.splice(0)) made.remove(); });
  return {
    /** A copy of the sv project with the library added to its dependencies, which is what `pnpm add` does before `init`. */
    project(adjust?: (root: string) => void): string {
      const made = createProject({}, "expo-svelte-init-");
      projects.push(made);
      const root = made.directory;
      cpSync(fixture, root, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      manifest.dependencies = { "expo-svelte": library };
      writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
      adjust?.(root);
      return root;
    },
    /** `expo-svelte init --no-install` in the project, with what it said. */
    run(root: string, args: string[] = []) {
      const out: string[] = [];
      const err: string[] = [];
      const status = runInit(root, ["--no-install", ...args], { out: (text) => out.push(text), err: (text) => err.push(text) });
      return { status, out: out.join("\n"), err: err.join("\n") };
    },
  };
}
