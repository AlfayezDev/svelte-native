import { describe, expect, test } from "bun:test";
import {
	anchorEvery,
	buildPlan,
	fullPlan,
	fullPlanSize,
	parseProbe,
	probeFailures,
	restoreAnchor,
} from "../lib/resilience.ts";
import { sample } from "./sample.ts";

const pkg = "io.rasheed.svelteqa";

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
