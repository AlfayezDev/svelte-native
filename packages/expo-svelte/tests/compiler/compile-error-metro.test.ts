// A file the compiler refuses must fail the bundle with what is wrong, where, in the file's own name: Svelte's `CompileError` has no stack and no `loc`, which Metro's report of it and
// Expo's terminal reporter turned into a bare "SyntaxError" with nothing after it (`{@const}` directly in a `<View>`, which the lowering makes a plain element, was the one that showed).
// The probe sends each file through a worker of jest-worker, as Metro's are, then through Metro's own error formatting and the two reporters' text (`fixtures/compile-error-probe.ts`).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

type Outcome = { filename: string; failed: boolean; type?: string; lineNumber?: number; column?: number; reportedFilename?: string; snippet?: string; text?: string; thrownName?: string; thrownCode?: string };

const root = "/work/apps/example";
const cases = {
  constInView: { filename: `${root}/src/routes/orders/+mobile.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n\n<View>\n  {@const x = 1}\n  {x}\n</View>\n` },
  unclosed: { filename: `${root}/src/routes/orders/Row.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n<View>\n  <View>\n</View>\n` },
  module: { filename: `${root}/src/lib/counter.svelte.ts`, src: `export const label: string = "a";\nexport const other: number = 2;\nexport const count = $state(0, 1);\n` },
  // The error is on a line the lowering rewrote before it: the `class` becomes a `nativeClass={...}` call and the tag a host tag, so Svelte's column is not the file's. (A duplicate attribute would be an error of Svelte's parser,
  // which the lowering leaves to the real compile, so nothing would be lowered: this one is the compiler's, after the lowering.)
  classBeforeError: { filename: `${root}/src/routes/orders/Card.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n\n<View class="flex-1 rounded-xl bg-white p-4" testID="card">{@const x = 1}<View /></View>\n` },
  // The error is inside the `class` expression the lowering copies into its call (#133): over several lines, and in the middle of one line.
  denseClass: { filename: `${root}/src/routes/orders/DenseCard.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n<View class={[\n  "p-4",\n  $props().compact && "gap-1"\n]}></View>\n` },
  inlineClass: { filename: `${root}/src/routes/orders/InlineCard.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n<View class={["p-4", $props().compact && "gap-1"]} testID="card"></View>\n` },
  // The same error in a file with CRLF line endings: the frame is text without the carriage returns, and the column is the file's.
  crlf: { filename: `${root}/src/routes/orders/Crlf.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n\n<View class="p-4" testID="a" testID="b">\n  <View />\n</View>\n`.replaceAll("\n", "\r\n") },
  fine: { filename: `${root}/src/routes/orders/Fine.svelte`, src: `<script lang="ts">\n  import { View } from "expo-svelte";\n</script>\n<View></View>\n` },
} as const;

const outcomes = (() => {
  let done: Record<keyof typeof cases, Outcome> | undefined;
  return () => {
    if (!done) {
      const names = Object.keys(cases) as (keyof typeof cases)[];
      const run = spawnSync("node", [join(import.meta.dirname, "fixtures/compile-error-probe.ts"), JSON.stringify(names.map((name) => ({ ...cases[name], root })))], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000, env: { ...process.env, EXPO_SVELTE_RUNES: "" } });
      if (run.status !== 0) throw new Error(`the compile error probe failed:\n${run.stderr.slice(-2000)}`);
      const results = JSON.parse(run.stdout.trim().split("\n").at(-1) as string) as Outcome[];
      done = Object.fromEntries(names.map((name, at) => [name, results[at]])) as Record<keyof typeof cases, Outcome>;
    }
    return done;
  };
})();

test("a {@const} directly in a <View> fails the bundle with Svelte's message, the file, and the line and the column of the tag", () => {
  const { constInView } = outcomes();
  expect(constInView.failed).toBe(true);
  expect(constInView.text).toContain("`{@const}` must be the immediate child of");
  expect(constInView.text).toContain(cases.constInView.filename);
  // Metro's own fields for an error with a position (what Expo's overlay and the terminal read), the tag being at line 6, column 2.
  expect([constInView.type, constInView.reportedFilename, constInView.lineNumber, constInView.column]).toEqual(["TransformError", cases.constInView.filename, 6, 2]);
  expect(constInView.snippet).toContain("{@const x = 1}");
});

test("the report is more than the name of the error: Expo's reporter prints the stack of a SyntaxError that has no code frame, and the report has a code frame", () => {
  const { constInView, unclosed } = outcomes();
  for (const outcome of [constInView, unclosed]) {
    expect(outcome.snippet, outcome.filename).toBeTruthy();
    expect((outcome.text ?? "").trim(), outcome.filename).not.toBe("");
    expect(outcome.text, outcome.filename).not.toBe("SyntaxError");
  }
});

test("a markup error of the parser names the file, the line and the column, and its frame shows the tag that was left open", () => {
  const { unclosed } = outcomes();
  expect(unclosed.text).toContain(cases.unclosed.filename);
  expect(unclosed.text).toContain("Block was left open");
  // The outer `<View>` of the fourth line, at its first column.
  expect([unclosed.lineNumber, unclosed.column]).toEqual([4, 0]);
  expect(unclosed.snippet).toContain("> 4 | <View>");
  expect(unclosed.snippet).toContain("    | ^");
  expect(unclosed.thrownCode).toBe("block_unclosed");
});

test("a file with CRLF line endings: the column is the file's and the frame has no carriage return", () => {
  const { crlf } = outcomes();
  const line = (cases.crlf.src.split("\r\n")[4] as string);
  expect([crlf.lineNumber, crlf.column]).toEqual([5, line.indexOf(`testID="b"`)]);
  expect(crlf.snippet).not.toContain("\r");
  expect(crlf.snippet).toContain(`> 5 | ${line}`);
  const caret = (crlf.snippet ?? "").split("\n").find((row) => row.trimEnd().endsWith("^")) as string;
  expect(caret.indexOf("^")).toBe(`> 5 | `.length + line.indexOf(`testID="b"`));
});

test("an error of a .svelte.ts module has the position of the TypeScript the developer wrote", () => {
  const { module } = outcomes();
  expect(module.failed).toBe(true);
  expect(module.text).toContain(cases.module.filename);
  expect(module.text).toContain("$state");
  expect(module.lineNumber).toBe(3);
});

test("a file that compiles is not touched", () => {
  expect(outcomes().fine.failed).toBe(false);
});

test("the error is at the file's own column and its frame shows the file's own line, when the lowering rewrote the line before it (a class)", () => {
  const { classBeforeError } = outcomes();
  expect(classBeforeError.failed).toBe(true);
  const line = cases.classBeforeError.src.split("\n")[4] as string;
  // The `{@const`, as the developer wrote it; Svelte saw it after `nativeClass={...}` and the longer tag name, a good many columns further.
  expect([classBeforeError.lineNumber, classBeforeError.column]).toEqual([5, line.indexOf("{@const")]);
  expect(classBeforeError.snippet).toContain(`> 5 | ${line}`);
  expect(classBeforeError.snippet).not.toContain("nativeClass");
  expect(classBeforeError.snippet).not.toContain("native-view");
  // The caret is under that column of the frame's own line.
  const caret = (classBeforeError.snippet ?? "").split("\n").find((row) => row.trimEnd().endsWith("^")) as string;
  expect(caret.indexOf("^")).toBe("> 5 | ".length + line.indexOf("{@const"));
});

test("an error inside a class expression is at its place in the file, over several lines and in the middle of one (#133)", () => {
  const { denseClass, inlineClass } = outcomes();
  expect(denseClass.thrownCode).toBe("props_invalid_placement");
  // Line 6, column 2: the `$props()` on the third line of the attribute, not the start of `class` on line 4.
  expect([denseClass.lineNumber, denseClass.column]).toEqual([6, 2]);
  expect(denseClass.snippet).toContain('> 6 |   $props().compact && "gap-1"');
  const caret = (denseClass.snippet ?? "").split("\n").find((row) => row.trimEnd().endsWith("^")) as string;
  expect(caret.indexOf("^")).toBe("> 6 | ".length + 2);
  const line = cases.inlineClass.src.split("\n")[3] as string;
  expect(inlineClass.thrownCode).toBe("props_invalid_placement");
  expect([inlineClass.lineNumber, inlineClass.column]).toEqual([4, line.indexOf("$props()")]);
  expect(inlineClass.snippet).toContain(`> 4 | ${line}`);
  expect(inlineClass.snippet).not.toContain("nativeClass");
});

test("the error keeps Svelte's code and name, so a tool that reads them still can", () => {
  const { constInView, classBeforeError, module } = outcomes();
  for (const outcome of [constInView, classBeforeError, module]) {
    expect(outcome.thrownName, outcome.filename).toBe("CompileError");
    expect(outcome.thrownCode, outcome.filename).toBeTruthy();
  }
  expect(constInView.thrownCode).toBe("const_tag_invalid_placement");
  expect(classBeforeError.thrownCode).toBe("const_tag_invalid_placement");
});

test("a module's error has a frame of the TypeScript the developer wrote", () => {
  const { module } = outcomes();
  expect(module.snippet).toContain("> 3 | export const count = $state(0, 1);");
  expect(module.column).toBe(cases.module.src.split("\n")[2]?.indexOf("$state"));
});
