import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { libraryChanged, withExpoSvelte } from "../../../src/metro.ts";
import { fakeConfig } from "../../support/metro.ts";
import { createProject } from "../../support/project.ts";

// Updating the library moves it to another directory of node_modules/.pnpm, and Metro's file map cache kept the old one after a restart: a project
// updated to 0.4.0-rc.2 ran 0.4.0-rc.1's entry (no colorScheme). Metro starts from empty caches when the library's directory is not the last one seen.

test("the caches are reset the first time, when the library moves, and not when it stays", () => {
  using project = createProject({}, "metro-library-");
  const root = project.directory;
  const rc1 = "/app/node_modules/.pnpm/expo-svelte@git+dcb073f/node_modules/expo-svelte";
  const rc2 = "/app/node_modules/.pnpm/expo-svelte@git+c7200da/node_modules/expo-svelte";
  // A project whose Metro ran before the record existed may hold a stale cache: reset once.
  expect(libraryChanged(root, rc1)).toBe(true);
  expect(readFileSync(join(root, ".expo-svelte/metro-library"), "utf8")).toBe(`${rc1}\n`);
  expect(libraryChanged(root, rc1)).toBe(false);
  expect(libraryChanged(root, rc2)).toBe(true);
  expect(libraryChanged(root, rc2)).toBe(false);
});

test("withExpoSvelte passes the decision to Metro as resetCache, and keeps a reset Metro was asked for", () => {
  using project = createProject({}, "metro-library-");
  const fake = (resetCache: boolean) => fakeConfig(project.directory, { resetCache });
  // The first load in a process decides (`resetForLibrary` in `src/metro.ts` is a memo of the process: whichever file loads a config first, a fresh project with no record
  // yet, decides for all of them), and later loads in the same process give the same answer.
  expect(withExpoSvelte(fake(false)).resetCache).toBe(true);
  expect(withExpoSvelte(fake(false)).resetCache).toBe(true);
  expect(withExpoSvelte(fake(true)).resetCache).toBe(true);
});
