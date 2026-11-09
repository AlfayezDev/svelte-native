import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `scripts/new-app.sh`, the starter of the early preview, up to the point where it would install anything: its arguments, its refusals and the
 * checks of the tools. The installs themselves are `scripts/consumer-check.sh` (the steps the two scripts share are in `scripts/lib/app-setup.sh`)
 * and the `starter` job of `consumer.yml`, which runs the script with `--local` on a runner.
 */
const repository = resolve(import.meta.dirname, "../../..");
const script = join(repository, "scripts/new-app.sh");

const scratch = mkdtempSync(join(tmpdir(), "svelte-native-new-app-test-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}, cwd = scratch) {
  const result = Bun.spawnSync(["bash", script, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

/** A directory for PATH with `node` and `pnpm` that report a version of our choosing (node still runs for real, the script parses package.json with it). */
function fakeTools(name: string, versions: { node?: string; pnpm?: string }): Record<string, string> {
  const bin = join(scratch, name);
  mkdirSync(bin, { recursive: true });
  const node = Bun.which("node");
  if (!node) throw new Error("node is not on PATH");
  const write = (file: string, body: string) => {
    writeFileSync(join(bin, file), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, file), 0o755);
  };
  write("node", `if [ "$1" = --version ]; then echo v${versions.node ?? "99.0.0"}; else exec "${node}" "$@"; fi`);
  write("pnpm", `echo ${versions.pnpm ?? "99.0.0"}`);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test("--help prints the comment block of the script and exits 0", () => {
  const { code, out } = run(["--help"]);
  expect(code).toBe(0);
  expect(out).toContain("scripts/new-app.sh <dir> [--ref <tag|branch|commit>] [--local]");
  expect(out).toContain("git clone --depth 1 git@github.com:AlfayezDev/svelte-native.git");
  expect(out).not.toContain("set -euo pipefail");
});

test("a missing directory, a second directory and an unknown option are usage errors (exit 2) that make nothing", () => {
  for (const args of [[], ["one", "two"], ["--bogus", "one"], ["one", "--ref"]]) {
    const { code, err } = run(args);
    expect(code, args.join(" ")).toBe(2);
    expect(err, args.join(" ")).toContain("usage: scripts/new-app.sh");
  }
  expect(existsSync(join(scratch, "one"))).toBe(false);
});

test("it refuses a directory that exists and is not empty, or is not a directory, and leaves it as it was", () => {
  const full = join(scratch, "full");
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, "keep.txt"), "mine\n");
  const refusal = run([full]);
  expect(refusal.code).toBe(1);
  expect(refusal.err).toContain("already exists and is not empty");
  expect(readdirSync(full)).toEqual(["keep.txt"]);
  const file = run([join(full, "keep.txt")]);
  expect(file.code).toBe(1);
  expect(file.err).toContain("is not a directory");
  expect(readFileSync(join(full, "keep.txt"), "utf8")).toBe("mine\n");
});

test("it refuses a directory inside the repository, a relative one included", () => {
  const inside = run([join(repository, "apps/new-thing")]);
  expect(inside.code).toBe(1);
  expect(inside.err).toContain("is inside the repository checkout");
  expect(existsSync(join(repository, "apps/new-thing"))).toBe(false);
  const relative = run(["examples/new-thing"], {}, repository);
  expect(relative.code).toBe(1);
  expect(relative.err).toContain("is inside the repository checkout");
  expect(existsSync(join(repository, "examples/new-thing"))).toBe(false);
});

test("it stops before it makes anything when node or pnpm is older than the repository's pins", () => {
  const root = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as { engines: { node: string }; packageManager: string };
  const node = run([join(scratch, "app-old-node")], fakeTools("old-node", { node: "22.4.0" }));
  expect(node.code).toBe(1);
  expect(node.err).toContain("node 22.4.0 is too old");
  expect(node.err).toContain(`Node ${root.engines.node}`);
  const pnpm = run([join(scratch, "app-old-pnpm")], fakeTools("old-pnpm", { pnpm: "11.9.0" }));
  expect(pnpm.code).toBe(1);
  expect(pnpm.err).toContain("pnpm 11.9.0 is too old");
  expect(pnpm.err).toContain(`pnpm ${root.packageManager.replace(/^pnpm@/, "")}`);
  expect(existsSync(join(scratch, "app-old-node"))).toBe(false);
  expect(existsSync(join(scratch, "app-old-pnpm"))).toBe(false);
});

test("Svelte is named once for the starter: the template's pkg.pr.new build is the vendored tarball's commit and the one the README names", () => {
  const template = JSON.parse(readFileSync(join(repository, "examples/minimal/package.json"), "utf8")) as { dependencies: Record<string, string> };
  const spec = template.dependencies.svelte;
  expect(spec).toMatch(/^https:\/\/pkg\.pr\.new\/svelte@[0-9a-f]{40}$/);
  const vendored = readdirSync(join(repository, "vendor")).filter((file) => /^svelte-.*\.tgz$/.test(file));
  expect(vendored).toHaveLength(1);
  const commit = vendored[0].replace(/^svelte-.*-([0-9a-f]+)\.tgz$/, "$1");
  expect(spec.slice("https://pkg.pr.new/svelte@".length).startsWith(commit)).toBe(true);
  const readme = readFileSync(join(repository, "packages/svelte-native/README.md"), "utf8");
  expect(readme).toContain(`"svelte": "${spec}"`);
});

test("the guide's package.json snippets carry the template's exact versions", () => {
  const template = JSON.parse(readFileSync(join(repository, "examples/minimal/package.json"), "utf8")) as { dependencies: Record<string, string>; reanimated: unknown };
  for (const page of ["docs/02-creating-a-project.md", "docs/07-adding-to-an-existing-expo-app.md"]) {
    const text = readFileSync(join(repository, page), "utf8");
    for (const [name, version] of Object.entries(template.dependencies)) {
      if (["@example/svelte-native", "@sveltejs/kit", "svelte", "vite"].includes(name)) continue;
      expect(text, `${page}: ${name}`).toContain(`"${name}": "${version}"`);
    }
  }
  // The pnpm settings the guide names are the template's.
  const workspace = readFileSync(join(repository, "examples/minimal/pnpm-workspace.yaml"), "utf8");
  for (const page of ["docs/02-creating-a-project.md", "docs/07-adding-to-an-existing-expo-app.md"]) {
    const text = readFileSync(join(repository, page), "utf8");
    expect(workspace).toContain("expo-modules-core: 57.0.23");
    expect(text, page).toContain("expo-modules-core: 57.0.23");
    for (const line of workspace.split("\n").filter((entry) => /^ {2}"?[@\w/.-]+@[\w.-]+"?: patches\//.test(entry))) {
      if (page.startsWith("docs/07") && line.includes("sveltejs/kit")) continue;
      expect(text, `${page}: ${line.trim()}`).toContain(line);
    }
  }
});
