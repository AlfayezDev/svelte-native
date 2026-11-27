import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	anchorEvery,
	buildPlan,
	fullPlan,
	fontScaleCycles,
	fullPlanSize,
	onlyGroups,
	parseGroups,
	parseProbe,
	probeFailures,
	restoreAnchor,
} from "../lib/resilience.ts";
import { sample } from "./sample.ts";

const pkg = "dev.alfayez.exposvelte.qa";

describe("the resilience plan", () => {
	test("the full plan has the steps the plan names", () => {
		const plan = buildPlan(fullPlan);
		const count = (group: string) => plan.filter((step) => step.group === group).length;
		expect(count("rotation")).toBe(1 + 2 * 5);
		expect(count("fontScale")).toBe(3);
		expect(count("locale")).toBe(4);
		expect(count("background")).toBe(100);
		expect(count("lowMemory")).toBe(8);
		expect(plan.length).toBe(fullPlanSize);
		expect(fullPlanSize).toBe(126);
	});

	test("only every tenth background cycle and the last dump the tree; the rest check process and log", () => {
		const background = buildPlan(fullPlan).filter((step) => step.group === "background");
		const dumped = background
			.map((step, index) => [index + 1, step.check.anchors.length > 0] as const)
			.filter(([, dump]) => dump)
			.map(([cycle]) => cycle);
		expect(dumped).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
		expect(anchorEvery).toBe(10);
		const short = buildPlan({ rotationCycles: 1, backgroundCycles: 7, lowMemoryRounds: 1 }).filter(
			(step) => step.group === "background",
		);
		expect(short.filter((step) => step.check.anchors.length > 0).length).toBe(1);
	});

	test("the kill step expects the process gone and the return step expects the route restored", () => {
		const plan = buildPlan({ rotationCycles: 1, backgroundCycles: 1, lowMemoryRounds: 1 });
		const kill = plan.find((step) => step.action.kind === "kill");
		const back = plan.find((step) => step.action.kind === "return");
		expect(kill?.check).toEqual({ alive: false, anchors: [] });
		expect(back?.check.alive).toBe(true);
		expect(back?.check.anchors).toContain(restoreAnchor);
	});
});

describe("the text size cycles", () => {
	test("the full plan runs the three sizes once, under the names the gate's evidence uses", () => {
		const sizes = buildPlan(fullPlan).filter((step) => step.group === "fontScale");
		expect(sizes.map((step) => step.name)).toEqual(["largest text (2.0)", "small text (0.85)", "default text (1.0)"]);
		expect(fullPlan.fontScaleCycles).toBe(fontScaleCycles);
	});

	test("--font-cycles repeats the three sizes, each cycle numbered, and changes no other group", () => {
		const plan = buildPlan({ ...fullPlan, fontScaleCycles: 3 });
		const sizes = plan.filter((step) => step.group === "fontScale");
		expect(sizes.length).toBe(9);
		expect(sizes.slice(0, 3).map((step) => step.name)).toEqual(["largest text (2.0) 1/3", "small text (0.85) 1/3", "default text (1.0) 1/3"]);
		expect(sizes.slice(6).map((step) => step.name)).toEqual(["largest text (2.0) 3/3", "small text (0.85) 3/3", "default text (1.0) 3/3"]);
		expect(sizes.map((step) => (step.action as { scale: number }).scale)).toEqual([2, 0.85, 1, 2, 0.85, 1, 2, 0.85, 1]);
		expect(plan.length).toBe(fullPlanSize + 6);
		expect(plan.filter((step) => step.group !== "fontScale").length).toBe(fullPlanSize - 3);
	});

	test("a run of one cycle is the plan's own, and none leaves the sizes out", () => {
		expect(buildPlan({ ...fullPlan, fontScaleCycles: 1 })).toEqual(buildPlan(fullPlan));
		expect(buildPlan({ ...fullPlan, fontScaleCycles: 0 }).filter((step) => step.group === "fontScale")).toEqual([]);
	});
});

describe("a plan restricted to groups", () => {
	test("--only keeps the opening step and the steps of the groups it names, in plan order", () => {
		const plan = buildPlan(fullPlan);
		const fontScale = onlyGroups(plan, parseGroups("fontScale"));
		expect(fontScale.map((step) => step.name)).toEqual([
			"launch",
			"largest text (2.0)",
			"small text (0.85)",
			"default text (1.0)",
		]);
		const both = onlyGroups(plan, parseGroups("locale,fontScale"));
		expect(both.map((step) => step.group)).toEqual(["rotation", "fontScale", "fontScale", "fontScale", "locale", "locale", "locale", "locale"]);
		expect(onlyGroups(plan, parseGroups("rotation")).length).toBe(11);
	});

	test("a name that is not a group, a repeated one and an empty list are errors", () => {
		expect(() => parseGroups("fontscale")).toThrow('"fontscale", which is not a step group');
		expect(() => parseGroups("locale,locale")).toThrow("locale twice");
		expect(() => parseGroups("")).toThrow("not a step group");
		expect(() => onlyGroups(buildPlan(fullPlan), [])).toThrow("names no group");
	});

	test("a restricted plan is a partial run: the gate counts the rest of the plan as missing", () => {
		expect(onlyGroups(buildPlan(fullPlan), parseGroups("fontScale")).length).toBeLessThan(fullPlanSize);
	});
});

describe("the step probe", () => {
	test("a clean step: the process is there, nothing in the log", () => {
		const probe = parseProbe(sample("resilience-probe-clean.txt"), pkg);
		expect(probe).toEqual({ pids: [5725], crashes: [], jsErrors: [], engineWarnings: [] });
		expect(probeFailures({ alive: true, anchors: [] }, probe)).toEqual([]);
	});

	test("every kind of fault becomes a failure", () => {
		const probe = parseProbe(sample("resilience-probe-faults.txt"), pkg);
		expect(probe.pids).toEqual([5801]);
		expect(probe.crashes.length).toBe(2);
		expect(probe.engineWarnings).toEqual(["dropped write to dead tag 77"]);
		const failures = probeFailures({ alive: true, anchors: [] }, probe);
		expect(failures.filter((failure) => failure.startsWith("crash:")).length).toBe(2);
		expect(failures.some((failure) => failure.startsWith("JavaScript error:"))).toBe(true);
		expect(failures.some((failure) => failure.startsWith("engine warning:"))).toBe(true);
	});

	test("liveness follows what the step expects", () => {
		const dead = parseProbe("--native-qa-log--\n", pkg);
		expect(probeFailures({ alive: true, anchors: [] }, dead)).toEqual([
			"the app's process is not running",
		]);
		expect(probeFailures({ alive: false, anchors: [] }, dead)).toEqual([]);
		const alive = parseProbe(sample("resilience-probe-clean.txt"), pkg);
		expect(probeFailures({ alive: false, anchors: [] }, alive)).toEqual([
			"the app's process survived (pid 5725)",
		]);
	});

	test("output without the marker is an error, not an empty log", () => {
		expect(() => parseProbe("5725\n", pkg)).toThrow("no log marker");
	});
});

describe("the run's files", () => {
	test("the Android command makes the runs directory before it writes its log, so the end of a long run does not lose its results in a checkout that has none", () => {
		const source = readFileSync(join(import.meta.dirname, "../commands/resilience.ts"), "utf8");
		const made = source.indexOf("mkdir(runsDir");
		const written = source.indexOf("writeFile(\n\t\tlogPath");
		expect(made).toBeGreaterThan(0);
		expect(written).toBeGreaterThan(made);
	});
});
