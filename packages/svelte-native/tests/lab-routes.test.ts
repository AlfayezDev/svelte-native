import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { labIncluded, routeFiles, syncNative } from "../src/build.ts";
import { buildTree, resolve as resolveHref } from "../src/route-tree.ts";
import { routesTableFile } from "../src/variant.ts";

/**
 * The development lab's routes (a `__dev` directory, or a module script that exports `lab = true`) are in every variant but the
 * product's. The product's route discovery never reads them, so its route tree and generated table never name them
 * (apps/platform/modules/svelte-engine/SPEC.md, "What the product contains: no development lab (JavaScript)").
 */
const marker = (extra = "") => `<script module>export const lab = true;${extra}</script>`;
const tabs = '<script module>export const navigator = "tabs";</script>';

const saved = process.env.APP_VARIANT;
afterEach(() => {
  if (saved === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = saved;
});

async function inProject<T>(files: Record<string, string>, check: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-lab-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      await mkdir(resolve(directory, "src/routes", path, ".."), { recursive: true });
      await writeFile(resolve(directory, "src/routes", path), source);
    }
    delete process.env.SVELTE_NATIVE_ROOT;
    return await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const pathsOf = async (directory: string, lab: boolean) => (await routeFiles(resolve(directory, "src/routes"), { lab })).map((file) => file.path).toSorted();

const app = {
  "+layout.mobile.svelte": "",
  "workspaces/+mobile.svelte": "",
  "__dev/+mobile.svelte": "",
  "__dev/screen/+mobile.svelte": "",
  "__dev/tree/+layout.mobile.svelte": tabs,
  "__dev/tree/home/+mobile.svelte": "",
  "(group)/__dev/deep/+mobile.svelte": "",
  "scratch/+mobile.svelte": marker(),
  "probe/+layout.mobile.svelte": marker(),
  "probe/a/+mobile.svelte": "",
  "probe/a/b/+mobile.svelte": "",
  "probes/+mobile.svelte": "",
};

test("the product is the variant APP_VARIANT=production; every other variant has the lab", () => {
  expect(labIncluded({ APP_VARIANT: "production" })).toBe(false);
  expect(labIncluded({ APP_VARIANT: "smoke" })).toBe(true);
  expect(labIncluded({ APP_VARIANT: "" })).toBe(true);
  expect(labIncluded({})).toBe(true);
});

test("with the lab every route is discovered, the markers included", async () => {
  await inProject(app, async (directory) => {
    expect(await pathsOf(directory, true)).toEqual(Object.keys(app).toSorted());
  });
});

test("without it a __dev directory at any depth goes, a marked page goes alone, a marked layout takes its directory", async () => {
  await inProject(app, async (directory) => {
    expect(await pathsOf(directory, false)).toEqual(["+layout.mobile.svelte", "probes/+mobile.svelte", "workspaces/+mobile.svelte"]);
    const tree = buildTree(await routeFiles(resolve(directory, "src/routes"), { lab: false }));
    expect(tree.routes.map((route) => route.path).toSorted()).toEqual(["/probes", "/workspaces"]);
    expect(resolveHref(tree, "/__dev")).toBeNull();
    expect(resolveHref(tree, "/__dev/screen")).toBeNull();
    expect(resolveHref(tree, "/scratch")).toBeNull();
    expect(resolveHref(tree, "/probe/a")).toBeNull();
  });
});

test("each variant has a route table of its own: the product's names no lab file, the lab's does, and syncing one leaves the other as it was", async () => {
  await inProject(app, async (directory) => {
    const file = (variant: string) => resolve(directory, ".svelte-native", routesTableFile(variant));
    await syncNative(directory, { variant: "production" });
    const product = await readFile(file("production"), "utf8");
    for (const lab of ["__dev", "scratch", "probe/", "/tree", "deep"]) expect(product).not.toContain(lab);
    expect(product).toContain('require("../src/routes/workspaces/+mobile.svelte")');
    expect(product).toContain('export const variant = "production";');
    expect(product).toContain("export const lab = false;");
    const before = statSync(file("production")).mtimeMs;
    await new Promise((done) => setTimeout(done, 20));
    await syncNative(directory, { variant: "qa" });
    await syncNative(directory, { variant: "smoke" });
    const full = await readFile(file("qa"), "utf8");
    expect(full).toContain('require("../src/routes/__dev/screen/+mobile.svelte")');
    expect(full).toContain('require("../src/routes/scratch/+mobile.svelte")');
    expect(full).toContain('export const variant = "qa";');
    expect(full).toContain("export const lab = true;");
    expect(await readFile(file("smoke"), "utf8")).toContain('export const variant = "smoke";');
    // The product's table is the file it was: no mtime, no byte changed, so a Metro serving it sees nothing.
    expect(await readFile(file("production"), "utf8")).toBe(product);
    expect(statSync(file("production")).mtimeMs).toBe(before);
    // There is no table the variants share.
    expect(existsSync(resolve(directory, ".svelte-native/routes.ts"))).toBe(false);
  });
});

test("the table the variants used to share is removed by the next sync", async () => {
  await inProject(app, async (directory) => {
    await mkdir(resolve(directory, ".svelte-native"), { recursive: true });
    await writeFile(resolve(directory, ".svelte-native/routes.ts"), "export const tree = {};\n");
    await syncNative(directory, { variant: "qa" });
    expect(existsSync(resolve(directory, ".svelte-native/routes.ts"))).toBe(false);
  });
});

test("sync takes the variant from APP_VARIANT unless it is told", async () => {
  await inProject(app, async (directory) => {
    const read = (variant: string) => readFile(resolve(directory, ".svelte-native", routesTableFile(variant)), "utf8");
    process.env.APP_VARIANT = "production";
    await syncNative(directory);
    expect(await read("production")).not.toContain("__dev");
    process.env.APP_VARIANT = "smoke";
    await syncNative(directory);
    expect(await read("smoke")).toContain("__dev");
    delete process.env.APP_VARIANT;
    await syncNative(directory);
    expect(await read("qa")).toContain("export const variant = \"qa\";");
    process.env.APP_VARIANT = "production";
    await syncNative(directory, { lab: true });
    expect(await read("production")).toContain("__dev");
    expect(await read("production")).toContain("export const lab = true;");
  });
});

test("a __dev directory is not read in the product, so a route the build could not read there does not fail it", async () => {
  const broken = { "+layout.mobile.svelte": "", "ok/+mobile.svelte": "", "__dev/x/+mobile.svelte": '<script module>export const presentation = cond ? "modal" : "push";</script>' };
  await inProject(broken, async (directory) => {
    expect(await pathsOf(directory, false)).toEqual(["+layout.mobile.svelte", "ok/+mobile.svelte"]);
    await expect(pathsOf(directory, true)).rejects.toThrow(/__dev\/x\/\+mobile\.svelte: export `presentation` as one of the literals/);
  });
});

test("the marker is a literal in every variant, and the root layout cannot carry it", async () => {
  await inProject({ "x/+mobile.svelte": "<script module>export const lab = process.env.X;</script>" }, async (directory) => {
    for (const lab of [true, false]) await expect(pathsOf(directory, lab)).rejects.toThrow(/x\/\+mobile\.svelte: export `lab` as one of the literals true/);
  });
  await inProject({ "+layout.mobile.svelte": marker() }, async (directory) => {
    for (const lab of [true, false]) await expect(pathsOf(directory, lab)).rejects.toThrow(/\+layout\.mobile\.svelte: the root layout is the app shell and cannot be lab-only/);
  });
  // `lab = false` is no marker.
  await inProject({ "+layout.mobile.svelte": "", "x/+mobile.svelte": "<script module>export const lab = false;</script>" }, async (directory) => {
    await expect(pathsOf(directory, false)).rejects.toThrow(/export `lab` as one of the literals true/);
  });
});

test("a marker in the instance script is an error, not silence: the table reads the module script only", async () => {
  for (const source of ["<script>export const lab = true;</script>", '<script lang="ts">const lab = true; export { lab };</script>']) {
    await inProject({ "+layout.mobile.svelte": "", "x/+mobile.svelte": source }, async (directory) => {
      for (const lab of [true, false]) await expect(pathsOf(directory, lab)).rejects.toThrow("x/+mobile.svelte: export `lab` is ignored in the instance script; move `lab` to `<script module>`");
    });
  }
  // The module script is where it belongs; an instance script that has other exports, and a `lab` that is no export, are fine.
  await inProject({ "+layout.mobile.svelte": "", "x/+mobile.svelte": "<script module>export const lab = true;</script><script>export let title = '';</script>", "y/+mobile.svelte": "<script>const lab = true; export const other = lab;</script>" }, async (directory) => {
    expect(await pathsOf(directory, false)).toEqual(["+layout.mobile.svelte", "y/+mobile.svelte"]);
  });
});
