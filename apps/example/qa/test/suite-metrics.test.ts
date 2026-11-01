import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { evaluate, type GatesFile, type ReportDevice } from "../lib/gates.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import { fullPlanSize } from "../lib/resilience.ts";
import {
	a11yMetrics,
	parityMetrics,
	resilienceMetrics,
	suiteMetrics,
} from "../lib/suite-metrics.ts";
import type {
	A11yFile,
	A11yScreenResult,
	DeviceInfo,
	ParityCase,
	ParityFile,
	ResilienceFile,
	ResilienceStep,
} from "../lib/types.ts";

const device: DeviceInfo = {
	serial: "localhost:5555",
	platform: "android",
	kind: "emulator",
	model: "sdk_gphone64_x86_64",
	osVersion: "16",
	sdk: 36,
	abi: "x86_64",
	refreshHz: 60,
};
const app = {
	package: "io.rasheed.svelteqa",
	versionName: "0.1.0",
	versionCode: 1,
	lastUpdateTime: null,
	installedSha256: null,
	apk: null,
};
const source = { commit: "abc1234", dirty: false };
const base = {
	schema: 1 as const,
	startedAt: "2026-10-26T09:00:00.000Z",
	finishedAt: "2026-10-26T09:10:00.000Z",
	source,
	device,
	app,
};

function parityCase(name: string, fields: Partial<ParityCase> = {}): ParityCase {
	return {
		name,
		screen: name,
		route: "/",
		state: "ready",
		theme: "light",
		direction: "ltr",
		fontScale: 1,
		verdict: "pass",
		differingPixels: 0,
		maskedPixels: 138_240,
		differingMaskedPixels: 0,
		bounds: null,
		attempts: 1,
		detail: null,
		actual: null,
		diff: null,
		...fields,
	};
}

function parityFile(cases: ParityCase[], fields: Partial<ParityFile> = {}): ParityFile {
	return {
		...base,
		kind: "parity",
		deviceKind: "android-api36-emulator-1080x2400-420dpi",
		mode: "check",
		screenPixels: 1080 * 2400,
		matrixSize: cases.length,
		selected: cases.length,
		largestFontScale: 2,
		cases,
		notCovered: [{ route: "/workspaces", reason: "needs a session" }],
		aborted: null,
		...fields,
	};
}

describe("parity metrics", () => {
	test("worst case over the compared cases, and what is not covered", () => {
		const m = parityMetrics(
			parityFile([
				parityCase("a"),
				parityCase("b", { verdict: "fail", differingPixels: 17 }),
				parityCase("c", { differingPixels: 3, verdict: "fail" }),
			]),
		);
		expect(m["parity.cases"]).toBe(3);
		expect(m["parity.diffPixelsOutsideMasks"]).toBe(17);
		expect(m["parity.casesDiffering"]).toBe(2);
		expect(m["parity.casesIncomplete"]).toBe(0);
		expect(m["parity.routesNotCovered"]).toBe(1);
		expect(m["parity.maskedPct"]).toBeCloseTo(5.33, 2);
	});

	test("a case that was not compared is incomplete, not a pass", () => {
		const m = parityMetrics(
			parityFile(
				[
					parityCase("a"),
					parityCase("b", { verdict: "missing-reference", differingPixels: null }),
					parityCase("c", { verdict: "skipped", differingPixels: null }),
					parityCase("d", { verdict: "unstable", differingPixels: null }),
					parityCase("e", { verdict: "error", differingPixels: null }),
				],
				{ matrixSize: 8 },
			),
		);
		expect(m["parity.cases"]).toBe(1);
		expect(m["parity.casesIncomplete"]).toBe(7);
		expect(m["parity.casesSkipped"]).toBe(1);
		expect(m["parity.diffPixelsOutsideMasks"]).toBe(0);
	});

	test("nothing compared is not measured", () => {
		expect(
			parityMetrics(
				parityFile([parityCase("a", { verdict: "missing-reference", differingPixels: null })]),
			)["parity.diffPixelsOutsideMasks"],
		).toBeNull();
	});

	test("a run that rewrote the references verified nothing", () => {
		expect(
			parityMetrics(parityFile([parityCase("a", { verdict: "updated" })], { mode: "update" })),
		).toEqual({});
	});

	test("a partial run (--quick, --filter) leaves the rest of the matrix incomplete", () => {
		const m = parityMetrics(
			parityFile([parityCase("a"), parityCase("b")], { matrixSize: 160, selected: 2 }),
		);
		expect(m["parity.casesIncomplete"]).toBe(158);
	});
});

function screen(name: string, fields: Partial<A11yScreenResult> = {}): A11yScreenResult {
	return {
		name,
		screen: name,
		route: "/",
		direction: "ltr",
		fontScale: 1,
		interactive: 10,
		reachable: 10,
		labeled: 10,
		actionable: 10,
		disabled: 0,
		clipped: 0,
		unreachable: 0,
		unlabeled: 0,
		notActionable: 0,
		orderViolations: 0,
		titleFirst: true,
		focusLeaks: 0,
		stops: [],
		findings: [],
		error: null,
		...fields,
	};
}

function a11yFile(screens: A11yScreenResult[], matrixSize = screens.length): A11yFile {
	return {
		...base,
		kind: "a11y",
		oracle: "uiautomator dump",
		matrixSize,
		screens,
		notCovered: [],
		aborted: null,
	};
}

describe("accessibility metrics", () => {
	test("sums the checklist over the screens", () => {
		const m = a11yMetrics(
			a11yFile([
				screen("a"),
				screen("b", {
					reachable: 8,
					unreachable: 2,
					notActionable: 3,
					actionable: 7,
					orderViolations: 1,
					titleFirst: false,
					focusLeaks: 2,
				}),
				screen("c", { titleFirst: null }),
			]),
		);
		expect(m["a11y.screens"]).toBe(3);
		expect(m["a11y.interactive"]).toBe(30);
		expect(m["a11y.unreachable"]).toBe(2);
		expect(m["a11y.notActionable"]).toBe(3);
		expect(m["a11y.orderViolations"]).toBe(1);
		expect(m["a11y.titleNotFirst"]).toBe(1);
		expect(m["a11y.focusLeaks"]).toBe(2);
		expect(m["a11y.reachablePct"]).toBeCloseTo((28 / 30) * 100, 5);
		expect(m["a11y.actionablePct"]).toBeCloseTo((27 / 30) * 100, 5);
	});

	test("a screen that could not be dumped is incomplete and contributes nothing else", () => {
		const m = a11yMetrics(
			a11yFile(
				[
					screen("a"),
					screen("b", {
						error: "needs the dev backend",
						interactive: 0,
						reachable: 0,
						labeled: 0,
						actionable: 0,
					}),
				],
				4,
			),
		);
		expect(m["a11y.screens"]).toBe(1);
		expect(m["a11y.screensIncomplete"]).toBe(3);
		expect(m["a11y.interactive"]).toBe(10);
	});

	test("no interactive element means no percentage", () => {
		expect(
			a11yMetrics(
				a11yFile([screen("a", { interactive: 0, reachable: 0, labeled: 0, actionable: 0 })]),
			)["a11y.reachablePct"],
		).toBeNull();
	});
});

function step(index: number, ok = true): ResilienceStep {
	return {
		index,
		group: "background",
		name: `step ${index}`,
		ok,
		failures: ok ? [] : ["the app's process is not running"],
		recovered: !ok,
		durationMs: 1000,
	};
}

function resilienceFile(steps: ResilienceStep[]): ResilienceFile {
	return {
		...base,
		kind: "resilience",
		screen: "screens-menu",
		steps,
		planned: steps.length,
		logFile: "runs/x.log",
		aborted: null,
	};
}

describe("resilience metrics", () => {
	test("steps, failures and the steps of the full plan that were not run", () => {
		const steps = Array.from({ length: fullPlanSize }, (_, index) => step(index + 1, index !== 5));
		expect(resilienceMetrics(resilienceFile(steps))).toEqual({
			"resilience.steps": fullPlanSize,
			"resilience.failures": 1,
			"resilience.skipped": 0,
			"resilience.stepsMissing": 0,
			"resilience.gateBypassed": 0,
		});
		expect(resilienceMetrics(resilienceFile(steps.slice(0, 20)))["resilience.stepsMissing"]).toBe(
			fullPlanSize - 20,
		);
	});
});

describe("the gates of the three suites", () => {
	const file = JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8"),
	) as GatesFile;
	const ids = [
		"parity.diffPixels",
		"parity.incomplete",
		"a11y.unreachable",
		"a11y.unlabeled",
		"a11y.notActionable",
		"a11y.orderViolations",
		"a11y.titleNotFirst",
		"a11y.focusLeaks",
		"a11y.incomplete",
		"resilience.failures",
		"resilience.stepsMissing",
	];
	const devices = (metrics: ReportDevice["metrics"]): Record<string, ReportDevice> => ({
		"localhost:5555": { platform: "android", metrics },
	});
	const judged = (metrics: ReportDevice["metrics"]) =>
		Object.fromEntries(
			evaluate(
				file.gates.filter((gate) => ids.includes(gate.id)),
				devices(metrics),
				"android",
			).map((row) => [row.id, row.verdict]),
		);

	test("the bar is zero everywhere: nothing differing, nothing unreachable, no failures, no gaps", () => {
		for (const id of ids) {
			const gate = file.gates.find((entry) => entry.id === id);
			expect(gate?.bar).toEqual({ android: { max: 0 }, ios: { max: 0 } });
		}
	});

	test("without a measurement every gate is not measured, which fails", () => {
		expect(Object.values(judged({})).every((verdict) => verdict === "not measured")).toBe(true);
	});

	test("a clean run passes all of them, one pixel or one failed step fails its own", () => {
		const clean = deviceMetrics(null, null, [], null, null, {
			parity: parityFile([parityCase("a")]),
			a11y: a11yFile([screen("a")]),
			resilience: resilienceFile(
				Array.from({ length: fullPlanSize }, (_, index) => step(index + 1)),
			),
		});
		expect(Object.values(judged(clean)).every((verdict) => verdict === "pass")).toBe(true);
		const dirty = suiteMetrics({
			parity: parityFile([parityCase("a", { verdict: "fail", differingPixels: 1 })]),
			a11y: a11yFile([screen("a", { notActionable: 1 })]),
			resilience: resilienceFile(
				Array.from({ length: fullPlanSize }, (_, index) => step(index + 1, index > 0)),
			),
		});
		const verdicts = judged(dirty);
		expect(verdicts["parity.diffPixels"]).toBe("fail");
		expect(verdicts["a11y.notActionable"]).toBe("fail");
		expect(verdicts["resilience.failures"]).toBe("fail");
		expect(verdicts["a11y.unreachable"]).toBe("pass");
	});
});
