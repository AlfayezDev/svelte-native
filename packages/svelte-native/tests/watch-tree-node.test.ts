import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Metro runs on Node, whose recursive fs.watch on Linux goes silent once a file is replaced by a rename; the tests run on Bun, whose watch does
// not. So this runs `watchTree` in a Node process: four saves by rename and an append must each be reported.
const script = (watcher: "tree" | "recursive") => `
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { watch } from "node:fs";
import { join } from "node:path";
import { watchTree } from ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, "../src/watch-tree.ts")).href)};
const root = process.argv[1];
mkdirSync(join(root, "routes", "a"), { recursive: true });
const file = join(root, "routes", "a", "page.svelte");
writeFileSync(file, "zero");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let seen = 0;
const closer = ${watcher === "tree" ? "watchTree(root, () => seen++, { debounceMs: 5 })" : "watch(root, { recursive: true }, () => seen++)"};
await pause(200);
const counts = [];
for (let round = 1; round <= 4; round++) {
  const before = seen;
  writeFileSync(file + ".tmp", "round " + round);
  renameSync(file + ".tmp", file);
  await pause(300);
  counts.push(seen > before ? 1 : 0);
}
const before = seen;
appendFileSync(file, " more");
await pause(300);
counts.push(seen > before ? 1 : 0);
closer.close();
console.log(JSON.stringify(counts));
`;

function run(watcher: "tree" | "recursive"): number[] {
  const root = mkdtempSync(join(tmpdir(), "svelte-native-watch-node-"));
  try {
    const result = spawnSync("node", ["--input-type=module", "-e", script(watcher), root], { encoding: "utf8", timeout: 20_000 });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "[]") as number[];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== "linux")("under Node, every save by rename and the append after them are reported", () => {
  expect(run("tree")).toEqual([1, 1, 1, 1, 1]);
});
