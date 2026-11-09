import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/**
 * The documents of the native program point at each other by relative link, at headings by fragment, and at the engine's
 * SPEC.md by quoted section name (`SPEC "Foreign views"`). A moved file or a renamed heading silently breaks them, so this
 * reads every Markdown file under the roots below and fails on a link whose file or heading is gone.
 */
const repository = resolve(import.meta.dirname, "../../..");
const roots = ["README.md", "packages/svelte-native", "apps/example/qa"];
const skipped = new Set(["node_modules", "out", "runs", "build", ".gradle", "Pods", ".svelte-native"]);
const specFile = resolve(repository, "packages/svelte-native/native/svelte-engine/SPEC.md");

function markdownFiles(path: string): string[] {
  const absolute = resolve(repository, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return absolute.endsWith(".md") ? [absolute] : [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => (skipped.has(entry.name) ? [] : markdownFiles(resolve(absolute, entry.name))));
}

/** The text without fenced blocks and inline code, which may show links that are not links. */
const prose = (text: string): string => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

/** The text without fenced blocks only: a quoted SPEC section often follows the file's name in code font. */
const unfenced = (text: string): string => text.replace(/```[\s\S]*?```/g, "");

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchors(text: string): Set<string> {
  const counts = new Map<string, number>();
  const found = new Set<string>();
  for (const line of prose(text).split("\n")) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = heading[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, "").replaceAll(" ", "-");
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    found.add(seen === 0 ? base : `${base}-${seen}`);
  }
  return found;
}

const headings = (text: string): string[] =>
  prose(text).split("\n").flatMap((line) => {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    return heading ? [heading[1].replaceAll("`", "")] : [];
  });

const files = roots.flatMap(markdownFiles);
const anchorCache = new Map<string, Set<string>>();
const anchorsOf = (file: string): Set<string> => {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const computed = anchors(readFileSync(file, "utf8"));
  anchorCache.set(file, computed);
  return computed;
};

function linkTargets(text: string): string[] {
  const body = prose(text);
  const inline = [...body.matchAll(/\[(?:[^\]\n]|\[[^\]\n]*\])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  const definitions = [...body.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map((match) => match[1]);
  return [...inline, ...definitions].filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target));
}

test("the Markdown under the roots is found", () => {
  expect(files.length).toBeGreaterThan(5);
  expect(files).toContain(resolve(repository, "packages/svelte-native/README.md"));
});

test("every relative link resolves to a file and, with a fragment, to a heading", () => {
  const broken: string[] = [];
  for (const file of files) {
    for (const target of linkTargets(readFileSync(file, "utf8"))) {
      const [path, fragment] = target.split("#");
      const destination = path === "" ? file : resolve(dirname(file), decodeURIComponent(path.split("?")[0]));
      if (!existsSync(destination)) broken.push(`${relative(repository, file)}: ${target} (no such file)`);
      else if (fragment && destination.endsWith(".md") && !anchorsOf(destination).has(decodeURIComponent(fragment))) {
        broken.push(`${relative(repository, file)}: ${target} (no such heading)`);
      }
    }
  }
  expect(broken).toEqual([]);
});

test('every quoted section of SPEC.md (SPEC "Name") names a heading it has', () => {
  const specHeadings = headings(readFileSync(specFile, "utf8"));
  const named = (name: string) => specHeadings.some((heading) => heading === name || (heading.startsWith(name) && /^[\s(:,]/.test(heading.slice(name.length))));
  const missing: string[] = [];
  for (const file of files) {
    for (const match of unfenced(readFileSync(file, "utf8")).matchAll(/SPEC(?:\.md)?`?[,:]?\s+(?:section\s+)?[“"]([^”"]+)[”"]/g)) {
      if (!named(match[1].replaceAll("`", ""))) missing.push(`${relative(repository, file)}: "${match[1]}"`);
    }
  }
  expect(missing).toEqual([]);
});
