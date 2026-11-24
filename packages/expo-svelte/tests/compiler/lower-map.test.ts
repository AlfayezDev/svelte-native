import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { lowerWithMap } from "../../src/lower.ts";

// `lowerWithMap` is `lowerPrimitives` with the way back (the sources here have distinct attributes: a duplicate one is an error of Svelte's parser, which the lowering leaves to the real compile, so nothing would be lowered): a position of the lowered text (where Svelte reports an error) is the same place of the file the developer wrote. The lowering moves the columns of a
// line that has a lowered tag, a `class` (a `nativeClass={...}` call takes its place) or the injected import of the renderer's helpers; `class` can span lines, and the file can have CRLF line endings.
const where = (text: string, token: string, from = 0) => {
  const at = text.indexOf(token, from);
  if (at < 0) throw new Error(`${token} is not in the text`);
  const before = text.slice(0, at);
  return { line: before.split("\n").length, column: at - (before.lastIndexOf("\n") + 1) };
};
/** The place of the `n`th (1-based) `token` of the lowered text, in the file: what the file has there. */
function back(source: string, token: string, n = 1) {
  const lowering = lowerWithMap(source, { filename: "A.svelte", warn: () => {} });
  let at = -1;
  for (let seen = 0; seen < n; seen++) at = lowering.code.indexOf(token, at + 1);
  const lowered = where(lowering.code, token, Math.max(0, at));
  const original = lowering.original(lowered.line, lowered.column);
  const text = source.split("\n")[original.line - 1] ?? "";
  return { lowering, lowered, original, rest: text.slice(original.column) };
}
const header = `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n`;

test("a file the lowering leaves as it is maps every position to itself", () => {
  const source = `<script>\n  let a = 1;\n</script>\n<p>{a}</p>\n`;
  const lowering = lowerWithMap(source, { filename: "A.svelte", warn: () => {} });
  expect(lowering.code).toBe(source);
  expect(lowering.original(4, 3)).toEqual({ line: 4, column: 3 });
});

test("a position after a class that was rewritten, on the same line, is where the file has it", () => {
  const source = `${header}\n<View class="flex-1 rounded-xl bg-white p-4" testID="card" accessibilityLabel="again">\n  <View />\n</View>\n`;
  const { lowered, original, rest } = back(source, `accessibilityLabel="again"`);
  // Svelte saw it a good many columns further than the file has it.
  expect(lowered.column).toBeGreaterThan(original.column + 10);
  expect(original.line).toBe(lowered.line);
  expect(rest.startsWith(`accessibilityLabel="again">`)).toBe(true);
  // The tag's name too: the host name is longer than the one written, so what follows it moves by the difference.
  expect(back(source, `<native-view `).rest.startsWith(`<View class=`)).toBe(true);
});

test("a class that spans lines: what is after it is where the file has it, and no line moves", () => {
  const source = `${header}\n<View class="p-4\n  rounded-xl\n  bg-white" testID="a" accessibilityLabel="b">\n  <View />\n</View>\n`;
  const { lowering, lowered, original, rest } = back(source, `accessibilityLabel="b"`);
  expect(lowering.code.split("\n")).toHaveLength(source.split("\n").length);
  expect(lowered.line).toBe(original.line);
  expect(original.line).toBe(source.split("\n").findIndex((line) => line.includes(`accessibilityLabel="b"`)) + 1);
  expect(rest.startsWith(`accessibilityLabel="b">`)).toBe(true);
  // The second line of the file, which the lowering left alone, is not moved.
  expect(back(source, "<native-view", 2).rest).toBe("<View />");
});

test("CRLF line endings: positions are the file's, lines and columns (the carriage return is not a column)", () => {
  const source = `${header}\n<View class="flex-1 p-4" testID="a" accessibilityLabel="b">\n  <View />\n</View>\n`.replaceAll("\n", "\r\n");
  const lowering = lowerWithMap(source, { filename: "A.svelte", warn: () => {} });
  const lowered = where(lowering.code, `accessibilityLabel="b"`);
  const original = lowering.original(lowered.line, lowered.column);
  expect(original).toEqual(where(source, `accessibilityLabel="b"`));
  expect(source.split("\n")[original.line - 1]?.slice(original.column).startsWith(`accessibilityLabel="b">`)).toBe(true);
});

test("an error on the first line, after the import the lowering injects into the script on that line, is where the file has it", () => {
  const source = `<script>import { View } from "expo-svelte";</script><View class="p-4" testID="a" accessibilityLabel="b" />`;
  const lowering = lowerWithMap(source, { filename: "A.svelte", warn: () => {} });
  // The renderer's helpers are imported on the line of the script's start (no line below it moves), and the columns after it move.
  expect(lowering.code.split("\n")).toHaveLength(1);
  expect(lowering.code.length).toBeGreaterThan(source.length + 40);
  const { original, rest } = back(source, `accessibilityLabel="b"`);
  expect(original.line).toBe(1);
  expect(rest.startsWith(`accessibilityLabel="b" />`)).toBe(true);
  expect(original.column).toBe(source.indexOf(`accessibilityLabel="b"`));
  // A position inside the injected import is the start of the script's text.
  const inside = where(lowering.code, "__expoSvelte");
  expect(lowering.original(inside.line, inside.column)).toEqual(where(source, `import { View }`));
});

test("an error in <style>, which comes after lowered tags, is where the file has it, and is Svelte's real position", () => {
  const source = `${header}<View class="flex-1 p-4" testID="a">\n  <View class="p-2" />\n</View>\n\n<style>\n  .box { color: red\n</style>\n`;
  const lowering = lowerWithMap(source, { filename: "A.svelte", warn: () => {} });
  let error: { start?: { line: number; column: number }; code?: string } | undefined;
  try {
    compile(lowering.code, { filename: "A.svelte", generate: "client" });
  } catch (thrown) {
    error = thrown as typeof error;
  }
  expect(error?.start).toBeDefined();
  const start = error?.start as { line: number; column: number };
  const original = lowering.original(start.line, start.column);
  const line = source.split("\n")[original.line - 1] ?? "";
  // The error is inside the style block of the file, at a place the file has.
  expect(source.split("\n").slice(0, original.line - 1).some((text) => text.startsWith("<style"))).toBe(true);
  expect(line.length).toBeGreaterThanOrEqual(original.column);
  expect(original.line).toBeGreaterThanOrEqual(source.split("\n").findIndex((text) => text.startsWith("<style")) + 1);
  expect(original.line).toBeLessThanOrEqual(source.split("\n").length);
});
