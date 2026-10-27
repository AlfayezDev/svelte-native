import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearLogcat, shell, startApp, wake } from "../lib/adb.ts";
import { endsRun, key, newSessionNotes, reportRestore, withSession, type DeviceSession } from "../lib/device.ts";
import { launchCase, openCase, waitForNode } from "../lib/drive.ts";
import { integerFlag, parseFlags } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import {
	buildPlan,
	fullPlan,
	loopScreen,
	fullPlanSize,
	parseProbe,
	probeFailures,
	stepProbeMarker,
	type Action,
	type PlannedStep,
} from "../lib/resilience.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { cases } from "../lib/screens.ts";
import { commonOptions, startSuite } from "../lib/suite.ts";
import type { ResilienceFile, ResilienceStep } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";

const logFilter =
	"AndroidRuntime:E ActivityManager:E SvelteEngine:W libc:F DEBUG:F ReactNativeJS:E '*:S'";

function screenById(id: string) {
	const screen = cases.find((candidate) => candidate.id === id);
	if (!screen) throw new Error(`the resilience plan names the screen ${id}, which is not a case`);
	return screen;
}

type Context = { session: DeviceSession; serial: string; packageName: string };

async function perform(context: Context, action: Action): Promise<void> {
	const { session, serial, packageName } = context;
	switch (action.kind) {
		case "launch":
			await openCase(session, screenById(action.screen), "ltr");
			return;
		case "rotate":
			await session.rotation(action.rotation);
			await sleep(1500);
			return;
		case "fontScale":
			await session.fontScale(action.scale);
			await sleep(1500);
			return;
		case "locale": {
			await session.direction(action.direction);
			await sleep(1500);
			if (action.restart) {
				// The menu is reached the way every run reaches it (a pushed screen, with its back button), not by its link alone.
				await launchCase(session, screenById(loopScreen), action.direction);
			}
			return;
		}
		case "cycle":
			await key(serial, "KEYCODE_HOME");
			await sleep(300);
			await startApp(serial, packageName);
			await sleep(300);
			return;
		case "trim":
			await openCase(session, screenById(action.screen), "ltr");
			await shell(serial, `am send-trim-memory ${packageName} ${action.level}`);
			await sleep(500);
			return;
		case "backgroundTrim":
			await key(serial, "KEYCODE_HOME");
			await sleep(800);
			await shell(serial, `am send-trim-memory ${packageName} ${action.level}`);
			await sleep(500);
			return;
		case "kill":
			await shell(serial, `am kill ${packageName}`);
			await sleep(1200);
			return;
		case "return":
			await startApp(serial, packageName);
			await sleep(800);
			return;
	}
}

async function runStep(
	context: Context,
	index: number,
	step: PlannedStep,
	evidence: string[],
): Promise<ResilienceStep> {
	const began = Date.now();
	const failures: string[] = [];
	try {
		await perform(context, step.action);
	} catch (error) {
		if (endsRun(error)) throw error;
		failures.push(
			`the step could not be performed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const probe = await shell(
		context.serial,
		`pidof ${context.packageName}; echo ${stepProbeMarker}; logcat -d -v threadtime ${logFilter}; logcat -c`,
		{ timeoutMs: 60_000 },
	);
	if (probe.code !== 0)
		throw new Error(
			`the step probe failed on ${context.serial}: ${(probe.stderr || probe.stdout).trim().slice(0, 200)}`,
		);
	const seen = parseProbe(probe.stdout, context.packageName);
	failures.push(...probeFailures(step.check, seen));
	if (step.check.alive) {
		for (const anchor of step.check.anchors) {
			try {
				await waitForNode(context.serial, anchor, "ltr", 12_000);
			} catch (error) {
				failures.push(
					`the screen did not render: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	let recovered = false;
	if (failures.length && step.group !== "lowMemory") {
		// A hung or dead app would fail every step after this one for the same reason. Start it again so the next step
		// is judged on its own; the low-memory rounds depend on the process state, so they are left as they fall.
		try {
			await openCase(context.session, screenById(loopScreen), "ltr");
			recovered = true;
		} catch (error) {
			failures.push(
				`the app could not be brought back after the failure: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		await clearLogcat(context.serial);
	}
	if (failures.length)
		evidence.push(
			`## ${index}. ${step.name}\n${failures.join("\n")}\n${probe.stdout.slice(probe.stdout.indexOf(stepProbeMarker) + stepProbeMarker.length).trim()}\n`,
		);
	return {
		index,
		group: step.group,
		name: step.name,
		ok: failures.length === 0,
		failures,
		recovered,
		durationMs: Date.now() - began,
	};
}

export async function resilience(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		...commonOptions,
		rotations: { type: "string" },
		cycles: { type: "string" },
		rounds: { type: "string" },
	});
	const suite = await startSuite("resilience", argv, values);
	const { serial, packageName, device, app, startedAt } = suite;
	const plan = buildPlan({
		rotationCycles: integerFlag(values.rotations, "rotations", fullPlan.rotationCycles),
		backgroundCycles: integerFlag(values.cycles, "cycles", fullPlan.backgroundCycles),
		lowMemoryRounds: integerFlag(values.rounds, "rounds", fullPlan.lowMemoryRounds),
	});
	console.log(`resilience: ${plan.length} steps (the full plan has ${fullPlanSize})`);

	const steps: ResilienceStep[] = [];
	const evidence: string[] = [];
	let aborted: string | null = null;
	const notes = newSessionNotes();
	try {
		await withSession(serial, packageName, async (session) => {
			await session.theme("light");
			await session.fontScale(1);
			await session.direction("ltr");
			await session.rotation(0);
			await session.networkMode("normal");
			await wake(serial);
			await clearLogcat(serial);
			const context: Context = { session, serial, packageName };
			for (const [at, step] of plan.entries()) {
				const result = await runStep(context, at + 1, step, evidence);
				steps.push(result);
				if (!result.ok || step.group !== "background" || (at + 1) % 10 === 0)
					console.log(
						`  ${result.ok ? "ok  " : "FAIL"} ${String(result.index).padStart(3)} ${result.group.padEnd(10)} ${result.name} (${(result.durationMs / 1000).toFixed(1)} s)${result.ok ? "" : `\n        ${result.failures.join("\n        ")}`}`,
					);
			}
		}, { notes });
	} catch (error) {
		if (!endsRun(error)) throw error;
		aborted = error instanceof Error ? error.message : String(error);
		console.log(`stopped: ${aborted.slice(0, 200)}`);
	}

	const logPath = join(runsDir, `resilience-${slug(serial)}-${stamp(startedAt)}.log`);
	await writeFile(
		logPath,
		evidence.length
			? evidence.join("\n")
			: "no step logged a fault, an engine warning or a failed check\n",
	);
	const file: ResilienceFile = {
		schema: 1,
		kind: "resilience",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		screen: "screens-menu",
		steps,
		planned: plan.length,
		logFile: logPath.slice(qaDir.length + 1),
		aborted,
		leftovers: notes.leftovers,
		restoreFailures: notes.restoreFailures,
	};
	const name = await writeRun("resilience", serial, startedAt, file);
	const failed = steps.filter((step) => !step.ok).length;
	console.log(`resilience: ${steps.length} steps, ${failed} failed`);
	console.log(`wrote qa/runs/${name}.json`);
	reportRestore(notes);
}
