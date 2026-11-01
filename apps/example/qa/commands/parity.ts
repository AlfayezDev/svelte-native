import { mkdir, writeFile } from "node:fs/promises";
import { wake } from "../lib/adb.ts";
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
	exposedAccount,
	findNode,
	guardAnchorFailure,
	launchCase,
	maskRects,
	settledScreenshot,
	waitForNode,
} from "../lib/drive.ts";
import { flagString, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import {
	compare,
	emptyManifest,
	maskRefusal,
	readManifest,
	readReference,
	referenceMasks,
	writeManifest,
	writeReference,
	type Manifest,
	type ReferenceEntry,
} from "../lib/parity.ts";
import { diffImages, encodePng, paintOver, type Image, type Rect } from "../lib/png.ts";
import { inSignedInPhase, splitPhases, startSignedOut } from "../lib/phases.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
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
import { backendStatus, commonOptions, startSuite, type BackendStatus } from "../lib/suite.ts";
import type { ParityCase, ParityFile, SignedInRecord, Source } from "../lib/types.ts";
import { iosParity } from "./ios-parity.ts";
import { sleep } from "../lib/wait.ts";
import { deviceKindName } from "../parse/device-state.ts";

type Context = {
	session: DeviceSession;
	serial: string;
	deviceKind: string;
	manifest: Manifest;
	statusBar: Rect;
	navigationBar: Rect | null;
	update: boolean;
	backend: BackendStatus;
	artifacts: string;
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
	hidden: Rect[],
): Promise<void> {
	await mkdir(context.artifacts, { recursive: true });
	// What the device drew inside the masks of a signed-in screen is the account's own (its address, its devices): not kept.
	await writeFile(join(context.artifacts, `${name}.actual.png`), encodePng(hidden.length > 0 ? paintOver(actual, hidden) : actual));
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
	const deadline = Date.now() + (screen.needsBackend ? 25_000 : 12_000);
	let attempts = 0;
	let last: Image;
	for (;;) {
		last = await screenshot(context.serial);
		attempts++;
		const result = compare(reference, last, previous.masks);
		if (result.verdict === "pass")
			return caseRecord(screen, variant, {
				verdict: "pass",
				differingPixels: 0,
				maskedPixels: result.maskedPixels,
				differingMaskedPixels: result.differingMaskedPixels,
				attempts,
			});
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
	if (result.diffImage)
		await saveFailure(context, name, again, result.diffImage, record, screen.signedIn ? previous.masks : []);
	return record;
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
	if (screen.masks.length > 0 || screen.masksWhenShown.length > 0 || screen.signedIn) {
		const opened = await waitForNode(context.serial, screen.anchor, variant.direction, screen.needsBackend ? 30_000 : 15_000);
		// Under a sheet or modal the screen underneath is still in the view hierarchy the plain dump lists, covered: what is looked at for the
		// account's address, in the masks and in the check below, is the tree a service walks, which leaves it out.
		const walked = screen.hidden.length > 0 ? await dumpUi(context.serial, { important: true }) : undefined;
		nodeMasks = maskRects(opened.tree, screen, variant.direction, walked);
		// A reference keeps every pixel outside the masks: a signed-in screen that shows the account's address in the open is not frozen.
		const exposed = exposedAccount(walked ?? opened.tree, nodeMasks);
		if (exposed.length > 0)
			return caseRecord(screen, variant, {
				verdict: "error",
				detail: `no reference written: the screen shows the QA account's address outside the case's masks (${exposed.length} node${exposed.length === 1 ? "" : "s"}); the case must mask it`,
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
	// The pixels under a signed-in screen's masks (the address, the devices, avatars from the network) are never stored: the
	// comparison ignores them, and the reference must not carry the account.
	const masks = referenceMasks(context.statusBar, nodeMasks, shot.image, context.navigationBar);
	const stored = screen.signedIn && nodeMasks.length > 0 ? paintOver(shot.image, masks.filter((mask) => mask.name.startsWith("moving node"))) : shot.image;
	const written = await writeReference(context.deviceKind, name, stored);
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

async function runCase(
	context: Context,
	screen: ScreenCase,
	variant: Variant,
): Promise<ParityCase> {
	if (screen.needsBackend && !context.backend.ok)
		return caseRecord(screen, variant, {
			verdict: "skipped",
			detail: `needs the dev backend: ${context.backend.detail}`,
		});
	const previous = context.manifest.references[referenceName(screen, variant)];
	try {
		if (context.update) {
			const captured = await context.session.guarded(() => captureCase(context, screen, variant, previous));
			// Written after every case, so an interrupted run keeps the references it took.
			if (captured.verdict === "updated") await writeManifest(context.manifest);
			return captured;
		}
		if (!previous)
			return caseRecord(screen, variant, {
				verdict: "missing-reference",
				detail: `no reference in screenshots/${context.deviceKind}; run with --update to create it`,
			});
		return await context.session.guarded(() => checkCase(context, screen, variant, previous));
	} catch (error) {
		// A device that went away, or one left with a proxy or text size the case does not need, fails every case after
		// this one the same way: stop, keep what was taken.
		if (endsRun(error)) throw error;
		await guardAnchorFailure(context.session, screen, variant.fontScale, error);
		return caseRecord(screen, variant, {
			verdict: "error",
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
		update: { type: "boolean" },
		missing: { type: "boolean" },
		quick: { type: "boolean" },
		filter: { type: "string" },
	});
	const suite = await startSuite("parity", argv, values);
	const { serial, packageName, device, app, startedAt } = suite;
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
	const backend = await backendStatus();
	console.log(
		`${update ? "updating" : "comparing"} ${matrix(chosenCases, chosenVariants).length} cases against screenshots/${deviceKind}; backend: ${backend.detail}`,
	);

	const artifacts = join(runsDir, `parity-${slug(serial)}-${stamp(startedAt)}`);
	const results: ParityCase[] = [];
	let aborted: string | null = null;
	let signedInPhase: SignedInRecord | null = null;
	const notes = newSessionNotes();
	const phases = splitPhases(chosenCases);
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
				backend,
				artifacts,
				source,
			};
			/** Every variant of one phase: the settings of the variant, then its screens in the order that changes the proxy least. */
			const runPhase = async (phaseCases: ScreenCase[]) => {
				for (const variant of chosenVariants) {
					await session.theme(variant.theme);
					await session.fontScale(variant.fontScale);
					await session.direction(variant.direction);
					const screens = matrix(phaseCases, [variant]).map((entry) => entry.screen);
					for (const screen of ordered(screens)) {
						if (missingOnly && manifest.references[referenceName(screen, variant)]) continue;
						const began = Date.now();
						const record = await runCase(context, screen, variant);
						results.push(record);
						const diff = record.differingPixels === null ? "" : ` ${record.differingPixels} px`;
						const masked =
							record.maskedPixels === null
								? ""
								: ` (masked ${((record.maskedPixels / (display.width * display.height)) * 100).toFixed(1)} %)`;
						console.log(
							`  ${record.verdict.padEnd(17)} ${record.name}${diff}${masked} (${((Date.now() - began) / 1000).toFixed(1)} s)${record.detail && record.verdict !== "updated" ? `: ${record.detail.slice(0, 160)}` : ""}`,
						);
					}
				}
			};
			try {
				if (phases.signedOut.length > 0) {
					await startSignedOut(session, backend, phases.signedOut);
					await runPhase(phases.signedOut);
				}
				if (phases.signedIn.length > 0) {
					console.log("signed-in phase: signing in as the QA account");
					const outcome = await inSignedInPhase(session, backend, matrix(phases.signedIn, chosenVariants).length, () => runPhase(phases.signedIn));
					signedInPhase = outcome.record;
					if (!outcome.entered) {
						console.log(`  signed-in phase did not run: ${outcome.record.detail}`);
						for (const variant of chosenVariants)
							for (const { screen } of matrix(phases.signedIn, [variant]))
								results.push(caseRecord(screen, variant, { verdict: "skipped", detail: outcome.record.detail }));
					} else if (outcome.record.detail) console.log(`  signed-in phase: ${outcome.record.detail}`);
				}
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
		signedInPhase,
		leftovers: notes.leftovers,
		restoreFailures: notes.restoreFailures,
		deviceRestarts: notes.deviceRestarts,
	};
	const name = await writeRun("parity", serial, startedAt, file);
	const count = (verdict: ParityCase["verdict"]) =>
		results.filter((record) => record.verdict === verdict).length;
	console.log(
		`parity: ${count("pass")} pass, ${count("fail")} fail, ${count("missing-reference")} missing reference, ${count("unstable")} unstable, ${count("error")} error, ${count("skipped")} skipped, ${count("updated")} updated; ${notCovered.length} routes not covered`,
	);
	console.log(`wrote qa/runs/${name}.json`);
	reportRestore(notes);
}
