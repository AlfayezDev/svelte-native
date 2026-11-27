import { clearLogcat, dumpLogcat, wake } from "../lib/adb.ts";
import { chunkOptions, limitReached, planCases, resumeMismatch, runChunks, spawnChunk } from "../lib/chunks.ts";
import { analyzeScreen, reachPct } from "../lib/a11y.ts";
import { parseNodeInfo, type NodeInfo } from "../lib/a11y-state.ts";
import { dumpUi, endsRun, newSessionNotes, readDisplay, reportRestore, withSession } from "../lib/device.ts";
import { dumpWithOwnControls, openCase, settledTree } from "../lib/drive.ts";
import { AttemptsFailed, attemptCase, EvidenceBudget, failedFields, type EvidenceDeps } from "../lib/evidence.ts";
import { join } from "node:path";
import { flagString, integerFlag, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { runsDir } from "../lib/paths.ts";
import { latestRunFiles, readJson, slug, stamp, writeRun } from "../lib/runs.ts";
import {
	cases,
	layoutVariants,
	matrix,
	notCoveredStates,
	localize,
	notCovered,
	ownLabels,
	referenceName,
	type ScreenCase,
	type Variant,
} from "../lib/screens.ts";
import { commonOptions, startSuite } from "../lib/suite.ts";
import type { A11yFile, A11yScreenResult } from "../lib/types.ts";
import { iosA11y } from "./ios-a11y.ts";

/** What the checks read, stated in every run file. */
export const oracle =
	"uiautomator dump --compressed of the foreground window: the accessibility node info the engine publishes (A11y.kt, EngineText, EngineHeader, EngineTabs) for the views that are important for accessibility, without what the engine hides from services (a screen under a sheet or modal, a scrim), which is the tree a service that does not ask for the other views, TalkBack among them, walks. Every check reads that tree; the plain dump, which lists all views, only drives the app (anchor, taps). The dump has no range, tooltip (the hint), role description, action list, live region or expand state, so the accessibility lab's controls are also read from the node info the app logs for them (A11yDump.kt, `[Svelte a11y]` lines in logcat; the lab's controls only, and the app's word for what it publishes). The suite does not run TalkBack itself.";

/** The node infos the accessibility lab logged after the screen opened (the screen's link has `probe=`): its `[Svelte a11y] node` lines up to `done`, null when it logged none within the time. */
async function readNodeInfo(serial: string, timeoutMs = 20_000): Promise<NodeInfo[] | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = parseNodeInfo(await dumpLogcat(serial));
		if (found !== null) return found;
		if (Date.now() >= deadline) return null;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

function emptyResult(screen: ScreenCase, variant: Variant, error: string): A11yScreenResult {
	return {
		name: referenceName(screen, variant),
		screen: screen.id,
		route: screen.route,
		direction: variant.direction,
		fontScale: variant.fontScale,
		interactive: 0,
		reachable: 0,
		labeled: 0,
		actionable: 0,
		disabled: 0,
		clipped: 0,
		unreachable: 0,
		unlabeled: 0,
		notActionable: 0,
		orderViolations: 0,
		titleFirst: null,
		focusLeaks: 0,
		stops: [],
		findings: [],
		chromeModelled: 0,
		stable: null,
		error,
	};
}

export async function a11y(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosA11y(argv);
	const { values } = parseFlags(argv, {
		...commonOptions,
		...chunkOptions,
		quick: { type: "boolean" },
		filter: { type: "string" },
	});
	// `--chunk <n>`: several commands of `--limit n`, each on a fresh emulator and continuing the run file (lib/chunks.ts).
	const chunk = integerFlag(values.chunk, "chunk", 0);
	if (chunk > 0) {
		runChunks("a11y", values, chunk, spawnChunk);
		return;
	}
	const limit = integerFlag(values.limit, "limit", 0);
	const suite = await startSuite("a11y", argv, values, { fresh: values.fresh === true });
	const { serial, packageName, device, app } = suite;
	const filter = flagString(values.filter);
	const chosenVariants = values.quick === true ? layoutVariants.slice(0, 2) : layoutVariants;
	const chosenCases = cases.filter((screen) => !filter || screen.id.includes(filter));
	if (chosenCases.length === 0)
		throw new Error(
			`--filter ${filter} matches no screen (${cases.map((screen) => screen.id).join(", ")})`,
		);
	const display = await readDisplay(serial);
	console.log(`checking ${matrix(chosenCases, chosenVariants).length} screens in ${chosenVariants.length} layouts`);

	const nameOf = (entry: { screen: ScreenCase; variant: Variant }) => referenceName(entry.screen, entry.variant);
	// `--resume` continues the device's newest a11y file (its screens are done); `--limit` takes at most that many of the others.
	const resumePath = values.resume ? (await latestRunFiles()).a11y.get(slug(serial)) : undefined;
	if (values.resume && !resumePath) throw new Error(`--resume: no a11y run file for ${serial} in qa/runs`);
	const resumed = resumePath ? await readJson<A11yFile>(resumePath) : null;
	const mismatch = resumed
		? resumeMismatch(
				{ names: resumed.screens.map((screen) => screen.name), installedSha256: resumed.app.installedSha256 },
				{ selected: new Set(matrix(chosenCases, chosenVariants).map(nameOf)), installedSha256: app.installedSha256 },
			)
		: null;
	if (mismatch) throw new Error(`--resume: this is not the run being resumed (${mismatch}); pass the same flags and install the same build with --apk`);
	const startedAt = resumed ? new Date(resumed.startedAt) : suite.startedAt;
	const plan = planCases(chosenVariants.flatMap((variant) => matrix(chosenCases, [variant])).map(nameOf), new Set(resumed?.screens.map((screen) => screen.name)), limit);
	if (resumed || limit > 0)
		console.log(`${resumed ? `resuming a11y-${slug(serial)}-${stamp(startedAt)}: ${resumed.screens.length} screens already measured; ` : ""}${plan.run.size} to run${plan.left > 0 ? `, ${plan.left} left for the next` : ""}`);

	// Beside the run file: what a try that did not get its screen left on the device (`lib/evidence.ts`).
	const artifacts = join(runsDir, `a11y-${slug(serial)}-${stamp(startedAt)}`);
	const results: A11yScreenResult[] = resumed ? [...resumed.screens] : [];
	let aborted: string | null = null;
	const notes = newSessionNotes();
	try {
		await withSession(serial, packageName, async (session) => {
			await session.rotation(0);
			await wake(serial);
			await session.theme("light");
			const evidence: EvidenceDeps = { run: session.run, budget: new EvidenceBudget() };
			/** Every layout: the settings of the layout, then its screens. */
			const runCases = async () => {
				for (const variant of chosenVariants) {
					const screens = matrix(chosenCases, [variant]).filter((entry) => plan.run.has(nameOf(entry)));
					if (screens.length === 0) continue;
					await session.fontScale(variant.fontScale);
					await session.direction(variant.direction);
					for (const { screen } of screens) {
						const began = Date.now();
						try {
							// Every check reads what a screen reader walks (`--compressed`); the plain dump only drives the launch (anchor, taps).
							// Under a sheet or modal that dump is taken until it holds the screen's own controls, which one taken mid-draw lacks; on
							// any other screen a declared control that is missing is a finding, not a half-built dump. One more try after a failure
							// that is not the device going away: the first dump after the emulator was restarted can come back empty.
							const own = screen.hidden.length > 0 ? ownLabels(screen, variant.direction) : [];
							const name = referenceName(screen, variant);
							const attempted = await attemptCase({
								session,
								screen,
								fontScale: variant.fontScale,
								label: name,
								evidence: { deps: evidence, target: { serial, packageName, directory: artifacts, stem: name, screen, direction: variant.direction } },
								body: async () => {
									// The lab logs its node info once after it opens; what the previous screen left in the log is not this open's.
									if (screen.info) await clearLogcat(serial);
									await openCase(session, screen, variant.direction);
									const first = await dumpWithOwnControls(() => dumpUi(serial, { important: true }), own);
									return settledTree(serial, first, undefined, { important: true });
								},
							});
							const { tree, stable } = attempted.value;
							const nodeInfo = screen.info ? await readNodeInfo(serial) : undefined;
							const analysis = analyzeScreen({
								tree,
								direction: variant.direction,
								display,
								title: screen.title === null ? null : localize(screen.title, variant.direction),
								scrolled: screen.scrolled.map((control) => localize(control, variant.direction)),
								controls: screen.controls.map((control) => localize(control, variant.direction)),
								hidden: screen.hidden.map((label) => localize(label, variant.direction)),
								layout: screen.layout,
								fontScale: variant.fontScale,
								...(screen.expect ? { expect: screen.expect } : {}),
								...(screen.info ? { info: screen.info, nodeInfo: nodeInfo ?? null } : {}),
							});
							results.push({
								name: referenceName(screen, variant),
								screen: screen.id,
								route: screen.route,
								direction: variant.direction,
								fontScale: variant.fontScale,
								...analysis,
								stable,
								error: null,
								attempts: attempted.tries,
								...(attempted.failures.length > 0 ? { failures: attempted.failures } : {}),
							});
							console.log(
								`  ${referenceName(screen, variant).padEnd(44)}${attempted.tries > 1 ? ` (${attempted.tries} tries)` : ""} interactive ${analysis.interactive} (reach ${reachPct(analysis)}, clipped ${analysis.clipped}), unreachable ${analysis.unreachable}, unlabeled ${analysis.unlabeled}, not actionable ${analysis.notActionable}, small targets ${analysis.smallTargets ?? "-"}, state ${analysis.stateMismatches ?? "-"}, order ${analysis.orderViolations}, title ${analysis.titleFirst === null ? "-" : analysis.titleFirst ? "first" : "NOT first"}, leaks ${analysis.focusLeaks}${stable ? "" : ", tree NOT settled"} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
							);
						} catch (error) {
							if (endsRun(error)) throw error;
							// A screen that failed every try keeps the tries and what the device showed (`lib/evidence.ts`).
							const failed = error instanceof AttemptsFailed ? failedFields(error) : null;
							const message = failed?.detail ?? (error instanceof Error ? error.message : String(error));
							results.push({
								...emptyResult(screen, variant, message),
								...(failed ? { attempts: failed.attempts, failures: failed.failures } : {}),
							});
							console.log(`  error    ${referenceName(screen, variant)}${failed ? ` (${failed.attempts} tries)` : ""}: ${message.slice(0, 240)}`);
						}
					}
				}
			};
			await runCases();
		}, { notes });
	} catch (error) {
		if (!endsRun(error)) throw error;
		aborted = error instanceof Error ? error.message : String(error);
		console.log(`stopped: ${aborted.slice(0, 200)}`);
	}

	const file: A11yFile = {
		schema: 1,
		kind: "a11y",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		oracle,
		matrixSize: matrix(cases, layoutVariants).length,
		screens: results,
		notCovered: [...notCovered, ...notCoveredStates],
		aborted,
		leftovers: [...(resumed?.leftovers ?? []), ...notes.leftovers],
		restoreFailures: [...(resumed?.restoreFailures ?? []), ...notes.restoreFailures],
		deviceRestarts: [...(resumed?.deviceRestarts ?? []), ...notes.deviceRestarts],
	};
	const name = await writeRun("a11y", serial, startedAt, file);
	const total = (pick: (screen: A11yScreenResult) => number) =>
		results.reduce((sum, screen) => sum + pick(screen), 0);
	console.log(
		`a11y: ${results.length} screens, ${total((s) => s.interactive)} interactive elements, ${total((s) => s.unreachable)} unreachable, ${total((s) => s.unlabeled)} unlabeled, ${total((s) => s.notActionable)} not actionable, ${total((s) => s.smallTargets ?? 0)} small touch targets (not gated), ${total((s) => s.stateMismatches ?? 0)} state mismatches, ${total((s) => s.orderViolations)} order violations, ${results.filter((s) => s.titleFirst === false).length} titles not first, ${total((s) => s.focusLeaks)} focus leaks, ${results.filter((s) => s.error !== null).length} errors, ${results.filter((s) => (s.attempts ?? 1) > 1).length} retried (their first try's evidence is in the run file's failures)`,
	);
	console.log(`wrote qa/runs/${name}.json`);
	reportRestore(notes);
	// A run with a limit says how it ended to the command that chunks it: stopped by the device (a failure to continue from), or by the limit with screens left.
	if (limit > 0 && aborted !== null) process.exitCode ||= 1;
	else if (plan.left > 0 && !process.exitCode) process.exitCode = limitReached;
}
