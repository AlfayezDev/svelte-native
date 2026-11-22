import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { vendoredPackages } from "../../src/vendored.ts";
import { packageRoot } from "../support/paths.ts";

/**
 * Every vendored package has an update strategy (`vendor-updates/<name>.md`, beside the procedure in `vendor-updates/README.md`): an agent that updates a copy reads it first, and the
 * update changes its "Current" line with the version, so a strategy never describes another version than the copy's. The directory is the repository's, not the published package's.
 */
const directory = join(packageRoot, "vendor-updates");
const strategyFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return strategyFiles(path);
    return entry.endsWith(".md") && entry !== "README.md" ? [relative(directory, path).slice(0, -".md".length)] : [];
  });

describe("the update strategies of the vendored packages", () => {
  test("each vendored package has one, and there is none for a package that is not vendored", () => {
    expect(existsSync(join(directory, "README.md"))).toBe(true);
    expect(strategyFiles(directory).sort()).toEqual(vendoredPackages.map(({ name }) => name).sort());
  });

  test("each names the version of the copy as its current one, and the sections the procedure reads", () => {
    for (const { name, version } of vendoredPackages) {
      const text = readFileSync(join(directory, `${name}.md`), "utf8");
      expect([name, text.split("\n")[0]]).toEqual([name, `# ${name}`]);
      expect([name, /^- \*\*Current\*\*: (\S+)$/m.exec(text)?.[1]]).toEqual([name, version]);
      for (const section of ["What the library uses it for", "Coupled with", "Version policy", "Local changes", "What the library relies on", "What to look at in its source", "Native dependencies downloaded at build time", "Proof"]) {
        expect([name, text.includes(`\n## ${section}\n`)]).toEqual([name, true]);
      }
    }
  });

  test("a package with patches names each of them in its strategy", () => {
    for (const { name } of vendoredPackages) {
      const patches = join(packageRoot, "vendor-patches", name);
      if (!existsSync(patches)) continue;
      const text = readFileSync(join(directory, `${name}.md`), "utf8");
      for (const file of readdirSync(patches).filter((entry) => entry.endsWith(".patch"))) expect([name, text.includes(file)]).toEqual([name, true]);
    }
  });

  test("the strategies are not published", () => {
    const files = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { files: string[] }).files;
    expect(files.filter((entry) => entry.includes("vendor-updates"))).toEqual([]);
  });
});
