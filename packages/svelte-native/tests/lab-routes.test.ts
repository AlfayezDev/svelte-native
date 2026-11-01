import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { labIncluded, routeFiles, syncNative } from "../src/build.ts";
import { buildTree, resolve as resolveHref } from "../src/route-tree.ts";

/**
 * The development lab's routes (a `__dev` directory, or a module script that exports `lab = true`) are in every variant but the
 * product's. The product's route discovery never reads them, so its route tree and generated table never name them (SPEC.md, "Native
 * modules (smoke test)", the product's lab).
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

test("the product's route table names no lab file; the lab's does", async () => {
  await inProject(app, async (directory) => {
    const table = async (options: { lab: boolean }) => {
      await syncNative(directory, options);
      return readFile(resolve(directory, ".svelte-native/routes.ts"), "utf8");
    };
    const product = await table({ lab: false });
    for (const lab of ["__dev", "scratch", "probe/", "/tree", "deep"]) expect(product).not.toContain(lab);
    expect(product).toContain('require("../src/routes/workspaces/+mobile.svelte")');
    const full = await table({ lab: true });
    expect(full).toContain('require("../src/routes/__dev/screen/+mobile.svelte")');
    expect(full).toContain('require("../src/routes/scratch/+mobile.svelte")');
    // The table is rewritten for the other variant: one directory can be synced for the product and then for the QA app.
    expect(await table({ lab: false })).toBe(product);
  });
});

test("sync takes the variant from APP_VARIANT unless it is told", async () => {
  await inProject(app, async (directory) => {
    const read = () => readFile(resolve(directory, ".svelte-native/routes.ts"), "utf8");
    process.env.APP_VARIANT = "production";
    await syncNative(directory);
    expect(await read()).not.toContain("__dev");
    process.env.APP_VARIANT = "smoke";
    await syncNative(directory);
    expect(await read()).toContain("__dev");
    process.env.APP_VARIANT = "production";
    await syncNative(directory, { lab: true });
    expect(await read()).toContain("__dev");
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
