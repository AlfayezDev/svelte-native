import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Which cores `BootBoost` and `MountBoost` pin to (BigCores.kt: pure functions of numbers read off the device), compiled for the
 * host and run on the layouts of real phones and the odd ones. Skipped when `kotlinc` or `java` is not on the path.
 */
const engine = resolve(import.meta.dirname, "../../../apps/platform/modules/svelte-engine/android/src/main/java/expo/modules/svelteengine");
const sources = { cores: resolve(engine, "BigCores.kt"), host: resolve(import.meta.dirname, "native/BigCoresHost.kt") };
const tools = Bun.which("kotlinc") && Bun.which("java");

const digest = createHash("sha1");
for (const file of Object.values(sources)) digest.update(readFileSync(file));
const cache = join(tmpdir(), `svelte-native-big-cores-${digest.digest("hex").slice(0, 12)}`);

function jar() {
  const path = join(cache, "big-cores.jar");
  if (existsSync(path)) return path;
  mkdirSync(cache, { recursive: true });
  const result = Bun.spawnSync(["kotlinc", sources.host, sources.cores, "-include-runtime", "-d", path], { stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`kotlinc failed: ${result.stderr.toString()}`);
  return path;
}

function run(lines: string[]): string[] {
  const result = Bun.spawnSync(["java", "-jar", jar()], { stdin: new TextEncoder().encode(`${lines.join("\n")}\n`), stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`host failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim().split("\n");
}

const times = (n: number, value: number) => Array<number>(n).fill(value);

const possible: [string, string, number][] = [
  ["eight cores", "0-7", 8],
  ["a gap of cores", "0-3,6-7", 8],
  ["one core", "0", 1],
  ["a list of single cores", "0,2-3", 4],
  ["trailing newline", "0-7\n", 8],
  ["more cores than the mask holds", "0-70", 63],
  ["nothing", "", 0],
  ["not a list", "abc", 0],
  ["a backwards range", "7-0", 0],
  ["three numbers in a range", "0-1-2", 0],
];

test.skipIf(!tools)("the CPU indexes come from the possible list, not from the cores that are online", () => {
  const out = run(possible.map(([, text]) => `possible ${text.replace("\n", "")}`));
  possible.forEach(([description, , expected], i) => expect(Number(out[i]), description).toBe(expected));
});

const masks: [string, number[], string][] = [
  ["Galaxy A16: six A55 and two A76", [...times(6, 348), 1024, 1024], "c0"],
  ["tri-cluster: four little, three mid, one prime", [...times(4, 400), ...times(3, 800), 1024], "f0"],
  ["a mid core under half of the prime is not big", [...times(4, 400), ...times(3, 480), 1024], "80"],
  ["all cores alike", times(8, 1024), "none"],
  ["nearly alike (the smallest is more than half of the largest)", [...times(4, 700), ...times(4, 1024)], "none"],
  ["capacities unreadable", times(8, 0), "none"],
  ["one core known", [0, 0, 0, 1024], "none"],
  ["a core offline: it is neither a little nor a big core", [348, 348, 0, 348, 348, 348, 1024, 1024], "c0"],
  ["the prime core offline", [...times(6, 348), 1024, 0], "40"],
  ["two clusters, 4 + 4", [...times(4, 485), ...times(4, 1024)], "f0"],
  ["core 62 is the last the mask holds", [...times(62, 300), 1024], "4000000000000000"],
  ["cores past 62 are not looked at", [...times(63, 300), 1024], "none"],
];

test.skipIf(!tools)("the big cores of phones with one, two or three clusters, with cores offline, and with more cores than a mask holds", () => {
  const out = run(masks.map(([, capacities]) => `mask ${capacities.join(" ")}`));
  masks.forEach(([description, , expected], i) => expect(out[i], description).toBe(expected));
});

const subsets: [string, string, string, boolean][] = [
  ["the same cores", "c0", "c0", true],
  ["fewer cores than were pinned (the cpuset took one)", "40", "c0", true],
  ["a core that was not pinned", "c1", "c0", false],
  ["all cores are not a subset of the big ones", "ff", "c0", false],
  ["no cores is nothing to reset", "0", "c0", false],
];

test.skipIf(!tools)("a thread whose mask lies inside the pinned one inherited it", () => {
  const out = run(subsets.map(([, mask, of]) => `subset ${mask} ${of}`));
  subsets.forEach(([description, , , expected], i) => expect(out[i], description).toBe(String(expected)));
});
