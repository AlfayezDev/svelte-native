import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Metro runs on Node, whose recursive fs.watch on Linux goes silent once a file is replaced by a rename; the tests run on Bun, whose watch does
// not. So these run `watchTree` in a Node process. Each step is a change on disk, and the result is whether the watcher reported it.
const prelude = `
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { watchTree } from ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, "../../src/watch-tree.ts")).href)};
const root = process.argv[1];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const saveByRename = (file, text) => { writeFileSync(file + ".tmp", text); renameSync(file + ".tmp", file); };
let seen = 0;
const counts = [];
const step = async (change) => { const before = seen; change(); await pause(300); counts.push(seen > before ? 1 : 0); };
`;

function run(body: string): number[] {
  const root = mkdtempSync(join(tmpdir(), "svelte-native-watch-node-"));
  try {
    const result = spawnSync("node", ["--input-type=module", "-e", `${prelude}\n${body}\nconsole.log(JSON.stringify(counts));`, root], { encoding: "utf8", timeout: 20_000 });
    if (result.status !== 0) throw new Error(result.stderr || `node exited with ${result.status}`);
    return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "[]") as number[];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== "linux")("under Node, every save by rename and the append after them are reported", () => {
  const counts = run(`
    mkdirSync(join(root, "routes", "a"), { recursive: true });
    const file = join(root, "routes", "a", "page.svelte");
    writeFileSync(file, "zero");
    const tree = watchTree(root, () => seen++, { debounceMs: 5 });
    await pause(200);
    for (let round = 1; round <= 4; round++) await step(() => saveByRename(file, "round " + round));
    await step(() => appendFileSync(file, " more"));
    tree.close();
  `);
  expect(counts).toEqual([1, 1, 1, 1, 1]);
});

test.skipIf(process.platform !== "linux")("a directory deleted and made again in one go, or swapped in by a rename, is watched again", () => {
  const counts = run(`
    const dir = join(root, "a");
    mkdirSync(dir);
    writeFileSync(join(dir, "page.svelte"), "zero");
    mkdirSync(join(root, "b.next"));
    writeFileSync(join(root, "b.next", "page.svelte"), "next");
    mkdirSync(join(root, "b"));
    const tree = watchTree(root, () => seen++, { debounceMs: 5 });
    await pause(200);
    await step(() => { rmSync(dir, { recursive: true }); mkdirSync(dir); writeFileSync(join(dir, "page.svelte"), "again"); });
    await step(() => saveByRename(join(dir, "page.svelte"), "edited in the new directory"));
    await step(() => writeFileSync(join(dir, "new.svelte"), "a new file in it"));
    await step(() => { renameSync(join(root, "b"), join(root, "b.old")); renameSync(join(root, "b.next"), join(root, "b")); });
    await step(() => saveByRename(join(root, "b", "page.svelte"), "edited in the swapped-in directory"));
    tree.close();
  `);
  expect(counts).toEqual([1, 1, 1, 1, 1]);
});

test.skipIf(process.platform !== "linux")("a root that does not exist yet is watched once it is made", () => {
  const counts = run(`
    const routes = join(root, "src", "routes");
    mkdirSync(join(root, "src"));
    const tree = watchTree(routes, () => seen++, { debounceMs: 5 });
    await pause(200);
    await step(() => { mkdirSync(routes); writeFileSync(join(routes, "+mobile.svelte"), "first"); });
    await step(() => saveByRename(join(routes, "+mobile.svelte"), "edited"));
    await step(() => { mkdirSync(join(routes, "x")); writeFileSync(join(routes, "x", "+mobile.svelte"), "nested"); });
    await step(() => saveByRename(join(routes, "x", "+mobile.svelte"), "nested, edited"));
    tree.close();
  `);
  expect(counts).toEqual([1, 1, 1, 1]);
});
