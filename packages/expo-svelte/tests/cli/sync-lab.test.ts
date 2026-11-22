import { test, expect, afterEach } from "bun:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { labIncluded, routeFiles, syncNative } from "../../src/build.ts";
import { buildTree, resolve as resolveHref } from "../../src/route-tree.ts";
import { routesTableFile } from "../../src/variant.ts";
import { watchUntouched } from "../support/metro.ts";
import { withProject } from "../support/project.ts";

/**
 * The development lab's routes (a `__dev` directory, or a module script that exports `lab = true`) are in every variant but the
 * product's. The product's route discovery never reads them, so its route tree and generated table never name them
 * (packages/expo-svelte/native/svelte-core/SPEC.md, "What the product contains: no development lab (JavaScript)").
 */
const marker = (extra = "") => `<script module>export const lab = true;${extra}</script>`;
const tabs = '<script module>export const navigator = "tabs";</script>';

const saved = { APP_VARIANT: process.env.APP_VARIANT, EXPO_SVELTE_ROOT: process.env.EXPO_SVELTE_ROOT };
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

/** A project whose `src/routes` holds these files (path to source), removed when `check` is done. */
async function inProject<T>(files: Record<string, string>, check: (directory: string) => Promise<T>): Promise<T> {
  delete process.env.EXPO_SVELTE_ROOT;
  return withProject(Object.fromEntries(Object.entries(files).map(([path, source]) => [`src/routes/${path}`, source])), (project) => check(project.directory));
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
    const file = (variant: string) => resolve(directory, ".expo-svelte", routesTableFile(variant));
    await syncNative(directory, { variant: "production" });
    const product = await readFile(file("production"), "utf8");
    for (const lab of ["__dev", "scratch", "probe/", "/tree", "deep"]) expect(product).not.toContain(lab);
    expect(product).toContain('require("../src/routes/workspaces/+mobile.svelte")');
    expect(product).toContain('export const variant = "production";');
    expect(product).toContain("export const lab = false;");
    const untouched = watchUntouched([file("production")]);
    await syncNative(directory, { variant: "qa" });
    await syncNative(directory, { variant: "smoke" });
    const full = await readFile(file("qa"), "utf8");
    expect(full).toContain('require("../src/routes/__dev/screen/+mobile.svelte")');
    expect(full).toContain('require("../src/routes/scratch/+mobile.svelte")');
    expect(full).toContain('export const variant = "qa";');
    expect(full).toContain("export const lab = true;");
    expect(await readFile(file("smoke"), "utf8")).toContain('export const variant = "smoke";');
    // The product's table is the file it was: no mtime, no byte changed, so a Metro serving it sees nothing.
    untouched();
    // There is no table the variants share.
    expect(existsSync(resolve(directory, ".expo-svelte/routes.ts"))).toBe(false);
  });
});

test("the table the variants used to share is removed by the next sync", async () => {
  await inProject(app, async (directory) => {
    await mkdir(resolve(directory, ".expo-svelte"), { recursive: true });
    await writeFile(resolve(directory, ".expo-svelte/routes.ts"), "export const tree = {};\n");
    await syncNative(directory, { variant: "qa" });
    expect(existsSync(resolve(directory, ".expo-svelte/routes.ts"))).toBe(false);
  });
});

test("sync takes whether the lab is in from APP_VARIANT unless it is told", async () => {
  await inProject(app, async (directory) => {
    const read = (variant: string) => readFile(resolve(directory, ".expo-svelte", routesTableFile(variant)), "utf8");
    process.env.APP_VARIANT = "production";
    await syncNative(directory);
    expect(await read("production")).not.toContain("__dev");
    process.env.APP_VARIANT = "smoke";
    await syncNative(directory);
    expect(await read("smoke")).toContain("__dev");
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

test("the root layout cannot carry the lab marker, in any variant", async () => {
  await inProject({ "+layout.mobile.svelte": marker() }, async (directory) => {
    for (const lab of [true, false]) await expect(pathsOf(directory, lab)).rejects.toThrow(/\+layout\.mobile\.svelte: the root layout is the app shell and cannot be lab-only/);
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
