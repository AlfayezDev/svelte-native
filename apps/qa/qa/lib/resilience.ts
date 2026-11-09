import { findEngineWarnings, findFaults } from "../parse/logcat.ts";
import { parsePids } from "../parse/device-state.ts";
import type { Selector } from "./screens.ts";
import type { ResilienceStep } from "./types.ts";

/** What the resilience loop does to the running app, in order. Each step has the checks that must hold after it. */

export type StepGroup = ResilienceStep["group"];

export type StepCheck = {
	/** True when the app's process must be running afterwards; false for the step that kills it. */
	alive: boolean;
	/** Nodes that must be on screen afterwards; empty to skip the (slow) accessibility dump for this step. */
	anchors: Selector[];
};

/** What a step does to the app or the device. */
export type Action =
	| { kind: "launch"; screen: string }
	| { kind: "rotate"; rotation: 0 | 1 }
	| { kind: "fontScale"; scale: number }
	| { kind: "locale"; direction: "ltr" | "rtl"; restart: boolean }
	| { kind: "cycle" }
	| { kind: "trim"; level: string; screen: string }
	| { kind: "backgroundTrim"; level: string }
	| { kind: "kill" }
	| { kind: "return" };

export type PlannedStep = {
	group: StepGroup;
	name: string;
	action: Action;
	check: StepCheck;
};

export const rotationCycles = 5;
export const backgroundCycles = 100;
export const lowMemoryRounds = 2;
/** Every Nth background/foreground cycle (and the last) also dumps the tree for the anchors; the rest check the process and the log. */
export const anchorEvery = 10;

/** The screen the loop runs on: a large header over a scroll view, so chrome and content both have to survive each change. */
export const loopScreen = "screens-menu";
export const chromeAnchor: Selector = { label: "Navigate up" };
export const contentAnchor: Selector = {
	label: "Each page below is a real screen: the engine draws its header, sheet and tab bar.",
};
/** The route the low-memory rounds restore: a deep link the task keeps, so a killed process comes back to it. */
export const restoreScreen = "screens-header";
export const restoreAnchor: Selector = { label: "Screen 1, Native header" };

const both: StepCheck = { alive: true, anchors: [chromeAnchor, contentAnchor] };
const noDump: StepCheck = { alive: true, anchors: [] };

export type PlanOptions = {
	rotationCycles: number;
	backgroundCycles: number;
	lowMemoryRounds: number;
};

export const fullPlan: PlanOptions = { rotationCycles, backgroundCycles, lowMemoryRounds };

/** The steps of a plan. The full plan is what the gate expects; a smaller one is for working on the loop itself. */
export function buildPlan(options: PlanOptions): PlannedStep[] {
	const steps: PlannedStep[] = [
		{
			group: "rotation",
			name: "launch",
			action: { kind: "launch", screen: loopScreen },
			check: both,
		},
	];
	for (let cycle = 1; cycle <= options.rotationCycles; cycle++) {
		steps.push(
			{
				group: "rotation",
				name: `landscape ${cycle}/${options.rotationCycles}`,
				action: { kind: "rotate", rotation: 1 },
				check: both,
			},
			{
				group: "rotation",
				name: `portrait ${cycle}/${options.rotationCycles}`,
				action: { kind: "rotate", rotation: 0 },
				check: both,
			},
		);
	}
	for (const [name, scale] of [
		["largest text (2.0)", 2],
		["small text (0.85)", 0.85],
		["default text (1.0)", 1],
	] as const)
		steps.push({ group: "fontScale", name, action: { kind: "fontScale", scale }, check: both });
	steps.push(
		{
			group: "locale",
			name: "Arabic while running",
			action: { kind: "locale", direction: "rtl", restart: false },
			check: both,
		},
		{
			group: "locale",
			name: "Arabic after a restart",
			action: { kind: "locale", direction: "rtl", restart: true },
			check: both,
		},
		{
			group: "locale",
			name: "English while running",
			action: { kind: "locale", direction: "ltr", restart: false },
			check: both,
		},
		{
			group: "locale",
			name: "English after a restart",
			action: { kind: "locale", direction: "ltr", restart: true },
			check: both,
		},
	);
	for (let cycle = 1; cycle <= options.backgroundCycles; cycle++) {
		const dump = cycle % anchorEvery === 0 || cycle === options.backgroundCycles;
		steps.push({
			group: "background",
			name: `background and foreground ${cycle}/${options.backgroundCycles}`,
			action: { kind: "cycle" },
			check: dump ? both : noDump,
		});
	}
	const restored: StepCheck = { alive: true, anchors: [chromeAnchor, restoreAnchor] };
	for (let round = 1; round <= options.lowMemoryRounds; round++) {
		const label = `${round}/${options.lowMemoryRounds}`;
		steps.push(
			{
				group: "lowMemory",
				name: `trim memory (running critical) in the foreground ${label}`,
				action: { kind: "trim", level: "RUNNING_CRITICAL", screen: restoreScreen },
				check: restored,
			},
			{
				group: "lowMemory",
				name: `background and trim memory (complete) ${label}`,
				action: { kind: "backgroundTrim", level: "COMPLETE" },
				check: noDump,
			},
			{
				group: "lowMemory",
				name: `kill the background process ${label}`,
				action: { kind: "kill" },
				check: { alive: false, anchors: [] },
			},
			{
				group: "lowMemory",
				name: `return to the app after the kill ${label}`,
				action: { kind: "return" },
				check: restored,
			},
		);
	}
	return steps;
}

export const fullPlanSize = buildPlan(fullPlan).length;

/** `pidof`, then the filtered log of the step, separated by a marker line, as one adb call returns them. */
export const stepProbeMarker = "--native-qa-log--";

export type Probe = {
	pids: number[];
	crashes: string[];
	jsErrors: string[];
	engineWarnings: string[];
};

/** Reads a step's probe output: the app's process ids, then the faults and engine warnings logged during the step. */
export function parseProbe(output: string, packageName: string): Probe {
	const at = output.indexOf(stepProbeMarker);
	if (at < 0) throw new Error("step probe output has no log marker");
	const faults = findFaults(output.slice(at + stepProbeMarker.length), packageName);
	return {
		pids: parsePids(output.slice(0, at)),
		crashes: faults.crashes,
		jsErrors: faults.jsErrors,
		engineWarnings: findEngineWarnings(output.slice(at + stepProbeMarker.length)),
	};
}

/** Why a step failed, given what it had to satisfy and what the probe saw. Empty when it passed the process and log checks. */
export function probeFailures(check: StepCheck, probe: Probe): string[] {
	const failures: string[] = [];
	if (check.alive && probe.pids.length === 0) failures.push("the app's process is not running");
	if (!check.alive && probe.pids.length > 0)
		failures.push(`the app's process survived (pid ${probe.pids.join(", ")})`);
	for (const crash of probe.crashes) failures.push(`crash: ${crash.slice(0, 200)}`);
	for (const error of probe.jsErrors) failures.push(`JavaScript error: ${error.slice(0, 200)}`);
	for (const warning of probe.engineWarnings)
		failures.push(`engine warning: ${warning.slice(0, 200)}`);
	return failures;
}
