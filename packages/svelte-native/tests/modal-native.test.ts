import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The modal overlay layer's rules (`ModalLayout.kt`: content insets, animation poses, the show/hide/leave phases) compiled
 * for the host and run on scripted cases. What draws, moves and takes the back key is device work (SPEC.md, "Modal as an
 * overlay layer"). Skipped when `kotlinc` or `java` is not on the path.
 */
const native = resolve(import.meta.dirname, "native");
const engine = resolve(import.meta.dirname, "../../../apps/example/modules/svelte-engine/android/src/main/java/expo/modules/svelteengine/views");
const sources = { layout: resolve(engine, "ModalLayout.kt"), host: resolve(native, "ModalHost.kt") };
const tools = Bun.which("kotlinc") && Bun.which("java");

const digest = createHash("sha1");
for (const file of Object.values(sources)) digest.update(readFileSync(file));
const cache = join(tmpdir(), `svelte-native-modal-host-${digest.digest("hex").slice(0, 12)}`);

function jar() {
  const path = join(cache, "modal-host.jar");
  if (existsSync(path)) return path;
  mkdirSync(cache, { recursive: true });
  const result = Bun.spawnSync(["kotlinc", sources.host, sources.layout, "-include-runtime", "-d", path], { stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`kotlinc failed: ${result.stderr.toString()}`);
  return path;
}

function run(lines: string[]): string[] {
  const result = Bun.spawnSync(["java", "-jar", jar()], { stdin: new TextEncoder().encode(`${lines.join("\n")}\n`), stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`host failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim().split("\n");
}

const numbers = (line: string) => line.split(" ").map(Number);

// Cases: [description, left, top, right, bottom, keyboard, statusTranslucent, navigationTranslucent] and the expected insets.
const insetCases: [string, number[], number[]][] = [
  ["bars all around", [0, 96, 0, 63, 0, 0, 0], [0, 96, 0, 63]],
  ["landscape bars at the sides", [0, 72, 126, 0, 0, 0, 0], [0, 72, 126, 0]],
  ["translucent status bar loses the top inset only", [0, 96, 0, 63, 0, 1, 0], [0, 0, 0, 63]],
  ["translucent navigation bar loses every inset", [10, 96, 12, 63, 0, 0, 1], [0, 0, 0, 0]],
  ["translucent navigation bar implies the status bar", [0, 96, 0, 63, 0, 1, 1], [0, 0, 0, 0]],
  ["the keyboard raises the bottom edge over the bars", [0, 96, 0, 63, 800, 0, 0], [0, 96, 0, 800]],
  ["a keyboard lower than the bars changes nothing", [0, 96, 0, 63, 20, 0, 0], [0, 96, 0, 63]],
  ["the keyboard still counts edge to edge", [0, 96, 0, 63, 500, 1, 1], [0, 0, 0, 500]],
  ["no bars", [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0]],
];

test.skipIf(!tools)("content insets follow React Native's translucency rules and the keyboard", () => {
  const out = run(insetCases.map(([, input]) => `insets ${input.join(" ")}`));
  insetCases.forEach(([description, , expected], i) => { expect(numbers(out[i]), description).toEqual(expected); });
});

// [animation type, progress, height, dim] -> [layer alpha, content offset, scrim alpha]
const poseCases: [string, number[], number[]][] = [
  ["fade out: the layer is transparent, the dim waits inside it", [2, 0, 2400, 0.5], [0, 0, 0.5]],
  ["fade halfway", [2, 0.5, 2400, 0.5], [0.5, 0, 0.5]],
  ["fade in", [2, 1, 2400, 0.5], [1, 0, 0.5]],
  ["slide out: content below the bottom edge, no dim", [1, 0, 2400, 0.5], [1, 2400, 0]],
  ["slide a quarter in", [1, 0.25, 2400, 0.5], [1, 1800, 0.125]],
  ["slide in", [1, 1, 2400, 0.5], [1, 0, 0.5]],
  ["none is the shown pose at any progress", [0, 0, 2400, 0.5], [1, 0, 0.5]],
  ["none, shown", [0, 1, 2400, 0.5], [1, 0, 0.5]],
  ["progress below 0 is clamped", [1, -0.5, 100, 0.5], [1, 100, 0]],
  ["progress above 1 is clamped", [2, 3, 100, 0.5], [1, 0, 0.5]],
];

test.skipIf(!tools)("the poses of fade, slide and none", () => {
  const out = run(poseCases.map(([, input]) => `pose ${input.join(" ")}`));
  poseCases.forEach(([description, , expected], i) => {
    const got = numbers(out[i]);
    expected.forEach((value, k) => { expect(got[k], `${description} [${k}]`).toBeCloseTo(value, 4); });
  });
});

// Steps and what each leaves: STEP:RESULT/STATE, a trailing * while the layer is active (takes touches, the key and focus).
const phaseCases: [string, string[], string[]][] = [
  ["animated show then hide", ["show", "end", "hide", "end"], ["show:ATTACH/ENTERING*", "end:NOTHING/SHOWN*", "hide:LEAVE/LEAVING", "end:DETACH/HIDDEN"]],
  ["animation type none attaches shown and detaches at once", ["show0", "hide0"], ["show0:ATTACH/SHOWN*", "hide0:DETACH/HIDDEN"]],
  ["shown again while leaving turns around", ["show", "end", "hide", "show", "end", "hide", "end"], ["show:ATTACH/ENTERING*", "end:NOTHING/SHOWN*", "hide:LEAVE/LEAVING", "show:RETURN/ENTERING*", "end:NOTHING/SHOWN*", "hide:LEAVE/LEAVING", "end:DETACH/HIDDEN"]],
  ["hidden while entering leaves from there", ["show", "hide", "end"], ["show:ATTACH/ENTERING*", "hide:LEAVE/LEAVING", "end:DETACH/HIDDEN"]],
  ["repeated visible values do nothing", ["show", "show", "show0", "end", "show"], ["show:ATTACH/ENTERING*", "show:NOTHING/ENTERING*", "show0:NOTHING/ENTERING*", "end:NOTHING/SHOWN*", "show:NOTHING/SHOWN*"]],
  ["hiding a hidden modal does nothing", ["hide", "hide0", "end"], ["hide:NOTHING/HIDDEN", "hide0:NOTHING/HIDDEN", "end:NOTHING/HIDDEN"]],
  ["a leaving modal ignores a hide and a stale end does nothing once hidden", ["show", "end", "hide", "hide", "hide0", "end", "end"], ["show:ATTACH/ENTERING*", "end:NOTHING/SHOWN*", "hide:LEAVE/LEAVING", "hide:NOTHING/LEAVING", "hide0:NOTHING/LEAVING", "end:DETACH/HIDDEN", "end:NOTHING/HIDDEN"]],
  ["the type turning to none while leaving shows it at once", ["show", "end", "hide", "show0"], ["show:ATTACH/ENTERING*", "end:NOTHING/SHOWN*", "hide:LEAVE/LEAVING", "show0:RETURN/SHOWN*"]],
  ["deleting a shown host takes the layer off, deleting a hidden one does not", ["show", "end", "drop", "drop", "show", "drop"], ["show:ATTACH/ENTERING*", "end:NOTHING/SHOWN*", "drop:DROP/HIDDEN", "drop:NONE/HIDDEN", "show:ATTACH/ENTERING*", "drop:DROP/HIDDEN"]],
  ["deleting a leaving host takes the layer off", ["show", "end", "hide", "drop"], ["show:ATTACH/ENTERING*", "end:NOTHING/SHOWN*", "hide:LEAVE/LEAVING", "drop:DROP/HIDDEN"]],
];

test.skipIf(!tools)("the phases of a modal layer", () => {
  const out = run(phaseCases.map(([, steps]) => `phase ${steps.join(" ")}`));
  phaseCases.forEach(([description, , expected], i) => { expect(out[i].split(" "), description).toEqual(expected); });
});

test.skipIf(!tools)("modal-8: eight shows attach and detach eight times", () => {
  const cycle = ["show", "end", "hide", "end"];
  const [line] = run([`phase ${Array.from({ length: 8 }, () => cycle).flat().join(" ")}`]);
  const results = line.split(" ").map((step) => step.split(":")[1].split("/")[0]);
  expect(results.filter((step) => step === "ATTACH")).toHaveLength(8);
  expect(results.filter((step) => step === "DETACH")).toHaveLength(8);
  expect(line.endsWith("end:DETACH/HIDDEN")).toBe(true);
});
