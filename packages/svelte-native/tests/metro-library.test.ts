import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { libraryChanged, withSvelteNative } from "../src/metro.ts";

// Updating the library moves it to another directory of node_modules/.pnpm, and Metro's file map cache kept the old one after a restart: a project
// updated to 0.4.0-rc.2 ran 0.4.0-rc.1's entry (no colorScheme). Metro starts from empty caches when the library's directory is not the last one seen.

test("the caches are reset the first time, when the library moves, and not when it stays", () => {
  const root = mkdtempSync(join(tmpdir(), "metro-library-"));
  const rc1 = "/app/node_modules/.pnpm/@alfayez+svelte-native@git+dcb073f/node_modules/@alfayez/svelte-native";
  const rc2 = "/app/node_modules/.pnpm/@alfayez+svelte-native@git+c7200da/node_modules/@alfayez/svelte-native";
  // A project whose Metro ran before the record existed may hold a stale cache: reset once.
  expect(libraryChanged(root, rc1)).toBe(true);
  expect(readFileSync(join(root, ".svelte-native/metro-library"), "utf8")).toBe(`${rc1}\n`);
  expect(libraryChanged(root, rc1)).toBe(false);
  expect(libraryChanged(root, rc2)).toBe(true);
  expect(libraryChanged(root, rc2)).toBe(false);
});

test("withSvelteNative passes the decision to Metro as resetCache, and keeps a reset Metro was asked for", () => {
  const root = mkdtempSync(join(tmpdir(), "metro-library-"));
  const fake = (resetCache: boolean) => ({ projectRoot: root, resetCache, resolver: { sourceExts: ["ts"], resolveRequest: undefined }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} }) as unknown as ConfigT;
  // The first load in a process decides (a fresh project: no record yet), and later loads in the same process give the same answer.
  expect(withSvelteNative(fake(false)).resetCache).toBe(true);
  expect(withSvelteNative(fake(false)).resetCache).toBe(true);
  expect(withSvelteNative(fake(true)).resetCache).toBe(true);
});
