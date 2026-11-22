import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchTree } from "../../src/watch-tree.ts";
import { until as waitFor } from "../support/metro.ts";

// A recursive `fs.watch` on Linux stops reporting a file once it is replaced by a rename (how sed -i, vim and many editors save); `watchTree`
// keeps a watch per directory, which reports every change of an entry.
const roots: string[] = [];
const closers: { close(): void }[] = [];
afterEach(() => {
  for (const closer of closers.splice(0)) closer.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const until = (condition: () => boolean) => waitFor(condition, 3000);
function tree() {
  const root = mkdtempSync(join(tmpdir(), "expo-svelte-watch-"));
  roots.push(root);
  mkdirSync(join(root, "routes", "a"), { recursive: true });
  writeFileSync(join(root, "routes", "a", "page.svelte"), "one");
  return root;
}
/** Saves `file` the way sed -i and many editors do: a new file renamed over the old one. */
function replace(file: string, content: string) {
  writeFileSync(`${file}.tmp`, content);
  renameSync(`${file}.tmp`, file);
}

test("a file replaced by a rename keeps being reported, again and again, and so is an append", async () => {
  const root = tree();
  let calls = 0;
  closers.push(watchTree(root, () => calls++, { debounceMs: 10 }));
  const file = join(root, "routes", "a", "page.svelte");
  for (let round = 1; round <= 4; round++) {
    const before = calls;
    replace(file, `round ${round}`);
    await until(() => calls > before);
    expect(calls).toBeGreaterThan(before);
    await pause(30);
  }
  const before = calls;
  appendFileSync(file, " more");
  await until(() => calls > before);
  expect(calls).toBeGreaterThan(before);
});

test("a directory that appears is watched, and one that goes is dropped without an error", async () => {
  const root = tree();
  let calls = 0;
  closers.push(watchTree(root, () => calls++, { debounceMs: 10 }));
  mkdirSync(join(root, "routes", "b"));
  await pause(100);
  let before = calls;
  writeFileSync(join(root, "routes", "b", "page.svelte"), "new");
  await until(() => calls > before);
  expect(calls).toBeGreaterThan(before);
  rmSync(join(root, "routes", "b"), { recursive: true });
  await pause(100);
  before = calls;
  replace(join(root, "routes", "a", "page.svelte"), "still watched");
  await until(() => calls > before);
  expect(calls).toBeGreaterThan(before);
});

test("node_modules and dot directories are not watched; closing stops the calls", async () => {
  const root = tree();
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  let calls = 0;
  const watcher = watchTree(root, () => calls++, { debounceMs: 10 });
  writeFileSync(join(root, "node_modules", "x", "index.js"), "ignored");
  await pause(150);
  expect(calls).toBe(0);
  watcher.close();
  replace(join(root, "routes", "a", "page.svelte"), "after close");
  await pause(150);
  expect(calls).toBe(0);
});
