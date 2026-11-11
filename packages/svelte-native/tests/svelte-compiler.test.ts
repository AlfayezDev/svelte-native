import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { acceptDirectives } from "../src/svelte-compiler.ts";

// The Metro transformer removes the refusal of `transition:`, `in:`, `out:` and `animate:` from Svelte's compiler as Node loads the two files that have it (`svelte-compiler.ts`; the hook
// itself runs under Node, in `tests/node-modules.test.ts`, with a stock Svelte). What it does to the text of those files is checked here against the custom-renderer build as it is
// published (the vendored tarball) and against this repository's Svelte, which `patches/svelte@5.56.7.patch` has changed for Bun, which runs no Node hooks.
const visitors = "src/compiler/phases/2-analyze/visitors";
const files = ["TransitionDirective.js", "AnimateDirective.js"];
const tarball = resolve(import.meta.dirname, "../../../vendor/svelte-5.56.7-216f258.tgz");
const pristine = (file: string): string => {
  const result = Bun.spawnSync(["tar", "-xzOf", tarball, `package/${visitors}/${file}`], { stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString() + result.exitCode).toMatch(/0$/);
  return result.stdout.toString();
};
const installedDirectory = dirname(createRequire(import.meta.url).resolve("svelte/package.json"));

test("the refusals are removed from the two visitors of the published custom-renderer build, and the result is what the repository's patch makes of them", () => {
  for (const file of files) {
    const stock = pristine(file);
    expect(stock, file).toContain("incompatible_with_custom_renderer");
    const accepted = acceptDirectives(file, stock);
    expect(accepted, file).not.toContain("incompatible_with_custom_renderer");
    expect(accepted.length, file).toBeLessThan(stock.length);
    // The rest of the file is untouched: the visitor is still there, and so is what it does with the directive.
    expect(accepted, file).toContain(`export function ${file.replace(".js", "")}(`);
    expect(accepted, file).toBe(readFileSync(join(installedDirectory, visitors, file), "utf8"));
  }
});

test("a file that has no refusal (a patched Svelte, one that accepts the directives) is returned as it is", () => {
  for (const file of files) {
    const patched = readFileSync(join(installedDirectory, visitors, file), "utf8");
    expect(acceptDirectives(file, patched)).toBe(patched);
  }
});

test("a refusal in a form it does not know fails, naming the file, instead of leaving it for a compile error of the app's own file", () => {
  const changed = pristine("TransitionDirective.js").replace("if (custom_renderer) {", "if (custom_renderer && true) {");
  expect(() => acceptDirectives("TransitionDirective.js", changed)).toThrow(/TransitionDirective\.js of the installed Svelte refuses/);
  const twice = `${pristine("AnimateDirective.js")}\nfunction other() {\n\te.incompatible_with_custom_renderer(node, 'x');\n}\n`;
  expect(() => acceptDirectives("AnimateDirective.js", twice)).toThrow(/more than one place/);
});

test("only the two visitors are rewritten", () => {
  expect(() => acceptDirectives("Fragment.js", "e.incompatible_with_custom_renderer(node, 'x');")).toThrow(/not one of the Svelte files/);
  expect(acceptDirectives("Fragment.js", "no refusal here")).toBe("no refusal here");
});
