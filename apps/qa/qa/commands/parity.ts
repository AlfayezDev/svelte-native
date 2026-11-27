import { mkdir, writeFile } from "node:fs/promises";
import { wake } from "../lib/adb.ts";
import { chunkOptions, limitReached, planCases, resumeMismatch, runChunks, spawnChunk } from "../lib/chunks.ts";
import { join } from "node:path";
import {
	dumpUi,
	endsRun,
	newSessionNotes,
	readDisplay,
	reportRestore,
	screenshot,
	navigationBarRect,
	statusBarRect,
	withSession,
	type DeviceSession,
} from "../lib/device.ts";
import {
	assertDeviceState,
	findNode,
	guardAnchorFailure,
	isWaitFailure,
	launchCase,
	maskedChrome,
	maskRects,
	settledScreenshot,
	waitForNode,
} from "../lib/drive.ts";
import { AttemptsFailed, attemptCase, EvidenceBudget, failedFields, retriedFields, type EvidenceDeps } from "../lib/evidence.ts";
import { flagString, integerFlag, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import {
	compare,
	emptyManifest,
	maskRefusal,
	readManifest,
	readReference,
	referenceMasks,
	statusBarMaskProblem,
	writeManifest,
	writeReference,
	type Manifest,
	type ReferenceEntry,
} from "../lib/parity.ts";
import { diffImages, encodePng, type Image, type Rect } from "../lib/png.ts";
import { latestRunFiles, readJson, slug, stamp, writeRun } from "../lib/runs.ts";
import {
	cases,
	matrix,
	notCovered,
	notCoveredStates,
	quickVariants,
	referenceName,
	variants,
	type ScreenCase,
	type Variant,
} from "../lib/screens.ts";
import { commonOptions, startSuite } from "../lib/suite.ts";
import type { ParityCase, ParityFile, Source } from "../lib/types.ts";
import { iosParity } from "./ios-parity.ts";
import { sleep } from "../lib/wait.ts";
import { deviceKindName } from "../parse/device-state.ts";

export type Context = {
	session: DeviceSession;
	serial: string;
	deviceKind: string;
	manifest: Manifest;
	statusBar: Rect;
	navigationBar: Rect | null;
	update: boolean;
	/** The directory beside the run file: the failure pictures, and the evidence of a try that did not get its screen. */
	artifacts: string;
	evidence: EvidenceDeps;
	source: Source;
};

function caseRecord(screen: ScreenCase, variant: Variant, fields: Partial<ParityCase>): ParityCase {
	return {
		name: referenceName(screen, variant),
		screen: screen.id,
		route: screen.route,
		state: screen.state,
		theme: variant.theme,
		direction: variant.direction,
		fontScale: variant.fontScale,
		verdict: "error",
		differingPixels: null,
		maskedPixels: null,
		differingMaskedPixels: null,
		bounds: null,
		attempts: null,
		detail: null,
		actual: null,
		diff: null,
		...fields,
	};
}

async function saveFailure(
	context: Context,
	name: string,
	actual: Image,
	diff: Image,
	record: ParityCase,
): Promise<void> {
	await mkdir(context.artifacts, { recursive: true });
	await writeFile(join(context.artifacts, `${name}.actual.png`), encodePng(actual));
	await writeFile(join(context.artifacts, `${name}.diff.png`), encodePng(diff));
	record.actual = join(context.artifacts, `${name}.actual.png`).slice(qaDir.length + 1);
	record.diff = join(context.artifacts, `${name}.diff.png`).slice(qaDir.length + 1);
}

/**
 * Compares a fresh screenshot with the case's reference. A screenshot that matches ends the case at once (one frame
 * identical to the reference is the pass); one that does not is retried until the window closes, because the screen may
 * still be settling, and what is left is then checked for stability so a flickering screen is not called a regression.
 */
async function checkCase(
	context: Context,
	screen: ScreenCase,
	variant: Variant,
	previous: ReferenceEntry,
): Promise<ParityCase> {
	const name = referenceName(screen, variant);
	await launchCase(context.session, screen, variant.direction);
	await sleep(900);
	const reference = await readReference(context.deviceKind, previous);
	const deadline = Date.now() + 12_000;
	let attempts = 0;
	let last: Image;
	for (;;) {
		last = await screenshot(context.serial);
		attempts++;
		const result = compare(reference, last, previous.masks);
		if (result.verdict === "pass") {
			const passed = caseRecord(screen, variant, {
				verdict: "pass",
				differingPixels: 0,
				maskedPixels: result.maskedPixels,
				differingMaskedPixels: result.differingMaskedPixels,
				attempts,
			});
			// A pass that a mask over the screen's own chrome made possible is no pass: the reference is stale and is retaken.
			const stale = await staleMasks(context.serial, screen, variant, previous);
			return stale === null ? passed : { ...passed, verdict: "error", detail: stale };
		}
		if (Date.now() >= deadline) break;
		await sleep(400);
	}
	const again = await screenshot(context.serial);
	attempts++;
	const anchor = await anchorState(context.serial, screen, variant);
	// No anchor on a screen that differs from its reference: ask the device whether it is in the state the case needs.
	if (anchor.missing) await assertDeviceState(context.session, screen, variant.fontScale);
	if (diffImages(last, again, previous.masks).differing !== 0)
		return caseRecord(screen, variant, {
			verdict: "unstable",
			attempts,
			detail: `the screen kept changing outside the masks for ${attempts} screenshots; ${anchor.detail}`,
		});
	const result = compare(reference, again, previous.masks);
	const record = caseRecord(screen, variant, {
		verdict: result.verdict,
		differingPixels: result.differingPixels,
		maskedPixels: result.maskedPixels,
		differingMaskedPixels: result.differingMaskedPixels,
		bounds: result.bounds,
		attempts,
		detail: result.verdict === "fail" ? anchor.detail : null,
	});
	if (result.diffImage) await saveFailure(context, name, again, result.diffImage, record);
	return record;
}

/**
 * Why a reference's moving-node masks cannot be trusted, or null: one of them covers the screen's own chrome in the tree on screen (a mask left at the height of a tab
 * strip). Read after the comparison, since the screenshots are taken without a tree query before them; a tree that
 * cannot be read says nothing.
 */
async function staleMasks(serial: string, screen: ScreenCase, variant: Variant, previous: ReferenceEntry): Promise<string | null> {
	const moving = previous.masks.filter((mask) => mask.name.startsWith("moving node"));
	if (moving.length === 0) return null;
	try {
		const covered = maskedChrome(await dumpUi(serial), screen, variant.direction, moving);
		return covered.length === 0 ? null : `the reference's masks cover the screen's own chrome (${covered.join(", ")}): it was taken with a mask that is not on a moving node; retake it with --update`;
	} catch {
		return null;
	}
}

/** Whether the case's anchor is on screen, for the failure report; a failed dump is part of the answer, not an error. */
async function anchorState(
	serial: string,
	screen: ScreenCase,
	variant: Variant,
): Promise<{ detail: string; missing: boolean }> {
	try {
		const found = findNode(await dumpUi(serial), screen.anchor, variant.direction);
		return found
			? { detail: "the anchor is on screen", missing: false }
			: { detail: "the anchor is not on screen", missing: true };
	} catch (error) {
		return {
			detail: `the accessibility tree could not be read (${error instanceof Error ? error.message : String(error)})`,
			missing: false,
		};
	}
}

/** Takes a reference: waits for the anchor, then needs two identical screenshots in a row before it freezes one. */
async function captureCase(
	context: Context,
	screen: ScreenCase,
	variant: Variant,
	previous: ReferenceEntry | undefined,
): Promise<ParityCase> {
	const name = referenceName(screen, variant);
	// The screenshots are taken the way a check takes them: no accessibility query before the frame. Only a screen with
	// moving nodes to mask needs the tree first; every other screen is looked up after the capture, to be sure that what
	// was frozen is the screen the case names.
	await launchCase(context.session, screen, variant.direction);
	let nodeMasks: Rect[] = [];
	if (screen.masks.length > 0 || screen.masksWhenShown.length > 0) {
		const opened = await waitForNode(context.serial, screen.anchor, variant.direction, 15_000);
		nodeMasks = maskRects(opened.tree, screen, variant.direction);
		// A mask is for a node that moves: one over the title, a control or the tab strip would freeze a reference that hides them.
		const covered = maskedChrome(opened.tree, screen, variant.direction, nodeMasks);
		if (covered.length > 0)
			return caseRecord(screen, variant, {
				verdict: "error",
				detail: `no reference written: a mask covers the screen's own chrome (${covered.join(", ")}); the masks must be on nodes that move`,
			});
	} else {
		await sleep(900);
	}
	const shot = await settledScreenshot(context.serial, [context.statusBar, ...(context.navigationBar ? [context.navigationBar] : []), ...nodeMasks]);
	if (!shot.stable)
		return caseRecord(screen, variant, {
			verdict: "unstable",
			attempts: shot.attempts,
			detail: `no two consecutive screenshots agreed outside the masks in ${shot.attempts} attempts`,
		});
	const after = findNode(await dumpUi(context.serial), screen.anchor, variant.direction);
	if (!after)
		return caseRecord(screen, variant, {
			verdict: "unstable",
			attempts: shot.attempts,
			detail:
				"the anchor of the screen was not on screen after the screenshots (a screen that moves on, or the wrong screen)",
		});
	const refusal = maskRefusal(
		[
			{ name: "status bar", masks: [context.statusBar] },
			{ name: "navigation bar", masks: context.navigationBar ? [context.navigationBar] : [] },
			{ name: "moving nodes", masks: nodeMasks },
		],
		shot.image,
	);
	if (refusal) return caseRecord(screen, variant, { verdict: "error", detail: `no reference written: ${refusal}` });
	const masks = referenceMasks(context.statusBar, nodeMasks, shot.image, context.navigationBar);
	const written = await writeReference(context.deviceKind, name, shot.image);
	let changed: number | null = null;
	let detail = "new";
	if (previous) {
		try {
			changed = compare(
				await readReference(context.deviceKind, previous),
				shot.image,
				previous.masks,
			).differingPixels;
			detail = changed === 0 ? "unchanged" : "changed";
		} catch (error) {
			detail = `replaced an unreadable reference (${error instanceof Error ? error.message : String(error)})`;
		}
	}
	context.manifest.references[name] = {
		...written,
		masks,
		screen: screen.id,
		route: screen.route,
		state: screen.state,
		theme: variant.theme,
		direction: variant.direction,
		fontScale: variant.fontScale,
		updatedAt: new Date().toISOString(),
		source: context.source,
	};
	return caseRecord(screen, variant, {
		verdict: "updated",
		differingPixels: changed,
		attempts: shot.attempts,
		detail,
	});
}

/**
 * One case on the emulator. A launch whose wait or dump failed (`isWaitFailure`: the anchor never came, a dump held less than the screen's own controls or could
 * not be read) is looked at (screenshot, dump, windows, activity, logcat: `lib/evidence.ts`) and launched once more, as the accessibility suite's cases are; any
 * other failure (a reference that is not there) is the case's error at once, with no second launch and no evidence. A case that passes its retry says so in its
 * record (`tries`, `failures`); one that fails it is an `error` whose `attempts` are the tries made. `tries` counts every run of the case: the retry, and the
 * re-run `DeviceSession.guarded` makes when the emulator restarted under it, so it is 2 for a retry and more only after such a restart.
 */
async function attempt(context: Context, screen: ScreenCase, variant: Variant, body: () => Promise<ParityCase>): Promise<ParityCase> {
	const name = referenceName(screen, variant);
	const attempted = await attemptCase({
		session: context.session,
		screen,
		fontScale: variant.fontScale,
		label: name,
		body,
		retryable: isWaitFailure,
		evidence: {
			deps: context.evidence,
			target: { serial: context.serial, packageName: context.session.packageName, directory: context.artifacts, stem: name, screen, direction: variant.direction },
		},
	});
	return { ...attempted.value, ...retriedFields(attempted) };
}

export async function runCase(
	context: Context,
	screen: ScreenCase,
	variant: Variant,
): Promise<ParityCase> {
	const previous = context.manifest.references[referenceName(screen, variant)];
	try {
		if (context.update) {
			const captured = await attempt(context, screen, variant, () => captureCase(context, screen, variant, previous));
			// Written after every case, so an interrupted run keeps the references it took.
			if (captured.verdict === "updated") await writeManifest(context.manifest);
			return captured;
		}
		if (!previous)
			return caseRecord(screen, variant, {
				verdict: "missing-reference",
				detail: `no reference in screenshots/${context.deviceKind}; run with --update to create it`,
			});
		// A reference whose status bar mask is not the device's band compares the clock and the icons: no screenshot decides that.
		const barProblem = statusBarMaskProblem(previous.masks, context.statusBar);
		if (barProblem) return caseRecord(screen, variant, { verdict: "error", detail: barProblem });
		return await attempt(context, screen, variant, () => checkCase(context, screen, variant, previous));
	} catch (error) {
		// A device that went away, or one left with a proxy or text size the case does not need, fails every case after
		// this one the same way: stop, keep what was taken.
		if (endsRun(error)) throw error;
		await guardAnchorFailure(context.session, screen, variant.fontScale, error instanceof AttemptsFailed ? error.cause : error);
		if (error instanceof AttemptsFailed) return caseRecord(screen, variant, { verdict: "error", ...failedFields(error) });
		// Not a wait or a dump that failed: one run of the case, no retry, no evidence (a second launch would fail the same way).
		return caseRecord(screen, variant, {
			verdict: "error",
			attempts: 1,
			tries: 1,
			detail: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Cases ordered so the settings that cost most to change (the proxy) change least: all of one network mode together. */
function ordered(selected: ScreenCase[]): ScreenCase[] {
	const rank = { normal: 0, hang: 1, refuse: 2 } as const;
	return [...selected].sort((a, b) => rank[a.network] - rank[b.network]);
}

export async function parity(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosParity(argv);
	const { values } = parseFlags(argv, {
		...commonOptions,
		...chunkOptions,
		update: { type: "boolean" },
		missing: { type: "boolean" },
		quick: { type: "boolean" },
		filter: { type: "string" },
	});
	// `--chunk <n>`: several commands of `--limit n`, each on a fresh emulator and continuing the run file (lib/chunks.ts).
	const chunk = integerFlag(values.chunk, "chunk", 0);
	if (chunk > 0) {
		runChunks("parity", values, chunk, spawnChunk);
		return;
	}
	const limit = integerFlag(values.limit, "limit", 0);
	const suite = await startSuite("parity", argv, values, { fresh: values.fresh === true });
	const { serial, packageName, device, app } = suite;
	const missingOnly = values.missing === true;
	const update = values.update === true || missingOnly;
	const filter = flagString(values.filter);
	const chosenVariants = values.quick === true ? quickVariants : variants;
	const chosenCases = cases.filter((screen) => !filter || screen.id.includes(filter));
	if (chosenCases.length === 0)
		throw new Error(
			`--filter ${filter} matches no screen (${cases.map((screen) => screen.id).join(", ")})`,
		);

	const display = await readDisplay(serial);
	const deviceKind = deviceKindName({
		platform: device.platform,
		sdk: device.sdk,
		kind: device.kind,
		model: device.model,
		display,
	});
	const manifest = (await readManifest(deviceKind)) ?? emptyManifest(deviceKind);
	if (!update && Object.keys(manifest.references).length === 0)
		console.log(
			`no references for ${deviceKind} yet: every case will be reported missing (run with --update to create them)`,
		);
	const source = await currentSource();
	console.log(`${update ? "updating" : "comparing"} ${matrix(chosenCases, chosenVariants).length} cases against screenshots/${deviceKind}`);

	/** The cases in the order the run takes them: the settings of the variant, then its screens in the order that changes the proxy least. */
	const order = chosenVariants.flatMap((variant) => ordered(matrix(chosenCases, [variant]).map((entry) => entry.screen)).map((screen) => ({ screen, variant })));
	const nameOf = (entry: { screen: ScreenCase; variant: Variant }) => referenceName(entry.screen, entry.variant);
	const wanted = order.map(nameOf).filter((name) => !(missingOnly && manifest.references[name]));
	// `--resume` continues the device's newest parity file (its cases are done); `--limit` takes at most that many of the others.
	const resumePath = values.resume ? (await latestRunFiles()).parity.get(slug(serial)) : undefined;
	if (values.resume && !resumePath) throw new Error(`--resume: no parity run file for ${serial} in qa/runs`);
	const resumed = resumePath ? await readJson<ParityFile>(resumePath) : null;
	const mismatch = resumed
		? resumeMismatch(
				{ names: resumed.cases.map((record) => record.name), mode: resumed.mode, installedSha256: resumed.app.installedSha256 },
				{ selected: new Set(matrix(chosenCases, chosenVariants).map(nameOf)), mode: update ? "update" : "check", installedSha256: app.installedSha256 },
			)
		: null;
	if (mismatch) throw new Error(`--resume: this is not the run being resumed (${mismatch}); pass the same flags and install the same build with --apk`);
	const startedAt = resumed ? new Date(resumed.startedAt) : suite.startedAt;
	const plan = planCases(wanted, new Set(resumed?.cases.map((record) => record.name)), limit);
	if (resumed || limit > 0)
		console.log(`${resumed ? `resuming parity-${slug(serial)}-${stamp(startedAt)}: ${resumed.cases.length} cases already measured; ` : ""}${plan.run.size} to run${plan.left > 0 ? `, ${plan.left} left for the next` : ""}`);

	const artifacts = join(runsDir, `parity-${slug(serial)}-${stamp(startedAt)}`);
	const results: ParityCase[] = resumed ? [...resumed.cases] : [];
	let aborted: string | null = null;
	const notes = newSessionNotes();
	try {
		await withSession(serial, packageName, async (session) => {
			await wake(serial);
			await session.rotation(0);
			const statusBar = await statusBarRect(serial);
			const navigationBar = await navigationBarRect(serial);
			const context: Context = {
				session,
				serial,
				deviceKind,
				manifest,
				statusBar,
				navigationBar,
				update,
				artifacts,
				evidence: { run: session.run, budget: new EvidenceBudget() },
				source,
			};
			/** Every variant: the settings of the variant, then its screens in the order that changes the proxy least. */
			const runCases = async () => {
				for (const variant of chosenVariants) {
					const screens = ordered(matrix(chosenCases, [variant]).map((entry) => entry.screen)).filter((screen) => plan.run.has(referenceName(screen, variant)));
					if (screens.length === 0) continue;
					await session.theme(variant.theme);
					await session.fontScale(variant.fontScale);
					await session.direction(variant.direction);
					for (const screen of screens) {
						const began = Date.now();
						const record = await runCase(context, screen, variant);
						results.push(record);
						const diff = record.differingPixels === null ? "" : ` ${record.differingPixels} px`;
						const masked =
							record.maskedPixels === null
								? ""
								: ` (masked ${((record.maskedPixels / (display.width * display.height)) * 100).toFixed(1)} %)`;
						console.log(
							`  ${record.verdict.padEnd(17)} ${record.name}${(record.tries ?? 1) > 1 ? ` (${record.tries} tries)` : ""}${diff}${masked} (${((Date.now() - began) / 1000).toFixed(1)} s)${record.detail && record.verdict !== "updated" ? `: ${record.detail.slice(0, 240)}` : ""}`,
						);
					}
				}
			};
			try {
				await runCases();
			} finally {
				if (update) await writeManifest(manifest);
			}
		}, { notes });
	} catch (error) {
		if (!endsRun(error)) throw error;
		aborted = error instanceof Error ? error.message : String(error);
		console.log(`stopped: ${aborted.slice(0, 200)}`);
	}

	const file: ParityFile = {
		schema: 1,
		kind: "parity",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source,
		device,
		app,
		deviceKind,
		mode: update ? "update" : "check",
		screenPixels: display.width * display.height,
		matrixSize: matrix(cases, variants).length,
		selected: matrix(chosenCases, chosenVariants).length,
		largestFontScale: Math.max(...variants.map((variant) => variant.fontScale)),
		cases: results,
		notCovered: [...notCovered, ...notCoveredStates],
		aborted,
		leftovers: [...(resumed?.leftovers ?? []), ...notes.leftovers],
		restoreFailures: [...(resumed?.restoreFailures ?? []), ...notes.restoreFailures],
		deviceRestarts: [...(resumed?.deviceRestarts ?? []), ...notes.deviceRestarts],
	};
	const name = await writeRun("parity", serial, startedAt, file);
	const count = (verdict: ParityCase["verdict"]) =>
		results.filter((record) => record.verdict === verdict).length;
	const retried = results.filter((record) => (record.tries ?? 1) > 1).length;
	console.log(
		`parity: ${count("pass")} pass, ${count("fail")} fail, ${count("missing-reference")} missing reference, ${count("unstable")} unstable, ${count("error")} error, ${count("skipped")} skipped, ${count("updated")} updated; ${retried} retried (their first try's evidence is in the run file's failures); ${notCovered.length} routes not covered`,
	);
	console.log(`wrote qa/runs/${name}.json`);
	reportRestore(notes);
	// A run with a limit says how it ended to the command that chunks it: stopped by the device (a failure to continue from), or by the limit with cases left.
	if (limit > 0 && aborted !== null) process.exitCode ||= 1;
	else if (plan.left > 0 && !process.exitCode) process.exitCode = limitReached;
}
