import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Direction } from "../lib/device.ts";
import { flagString, parseFlags } from "../lib/flags.ts";
import { captureScreens, type CaptureEntry } from "../lib/iphone/capture.ts";
import { IdentityMismatch, notReported, reportedIdentity, withIdentity } from "../lib/iphone/identity.ts";
import { currentSource, iosOptions, newToken, startIosSuite } from "../lib/iphone/session.ts";
import { iosCases, iosMatrix, iosNotCovered, iosVariants } from "../lib/iphone/screens.ts";
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
import { decodePng, encodePng, type Image, type Rect } from "../lib/png.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { referenceName, type ScreenCase, type Variant } from "../lib/screens.ts";
import type { BuildIdentity, ParityCase, ParityFile } from "../lib/types.ts";

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

/** The device kind a reference set is frozen for: pixels depend on the iOS release, the model and the display. */
export function iosDeviceKind(model: string, osVersion: string, image: { width: number; height: number; scale: number }): string {
	const major = osVersion.split(".")[0] ?? "x";
	return `ios${major}-${model.replace(/[^A-Za-z0-9]+/g, "-").replace(/-+$/, "")}-${image.width}x${image.height}-${image.scale}x`;
}

/** Frames of the views that move on their own, in points, as pixel rectangles. */
function movingMasks(entry: CaptureEntry): Rect[] {
	const scale = entry.scale ?? 1;
	return entry.moving.map(([x, y, width, height]) => ({ x: (x ?? 0) * scale, y: (y ?? 0) * scale, width: (width ?? 0) * scale, height: (height ?? 0) * scale }));
}

/**
 * The edges of the system's glass capsules (bar items, the tab bar), in pixels: iOS 26 draws them with a blur whose rim differs by a
 * level on a few pixels from one launch to the next. A wide capsule is masked at its two round ends (half its height and 6 pt more) and along its top and bottom
 * edge (6 pt), what is inside it (icons, labels, badges: the app's own drawing) is compared; a capsule less than one and a half times as wide as it is tall is masked whole.
 */
export function glassMasks(entry: CaptureEntry): Rect[] {
	const scale = entry.scale ?? 1;
	const edge = 6 * scale;
	const masks: Rect[] = [];
	for (const [x = 0, y = 0, width = 0, height = 0] of entry.glass ?? []) {
		const rect = { x: x * scale, y: y * scale, width: width * scale, height: height * scale };
		if (rect.width <= rect.height * 1.5) {
			masks.push(rect);
			continue;
		}
		const end = rect.height / 2 + 6 * scale;
		masks.push(
			{ x: rect.x, y: rect.y, width: end, height: rect.height },
			{ x: rect.x + rect.width - end, y: rect.y, width: end, height: rect.height },
			{ x: rect.x, y: rect.y, width: rect.width, height: edge },
			{ x: rect.x, y: rect.y + rect.height - edge, width: rect.width, height: edge },
		);
	}
	return masks;
}

/**
 * The rim of a presented sheet's card, in pixels: its rounded corners (a 64 pt square at each: the corner radius of an iOS 26 sheet is
 * large) and a strip along every side, 6 pt inside the frame of the sheet's presented view and 8 pt outside it, 32 pt above it (the card of
 * a sheet that fits its content starts about 25 pt above its presented view), where the system's corner mask, border and shadow are drawn a
 * level differently from one launch to the next. The sheet's content is compared.
 */
export function sheetMasks(entry: CaptureEntry): Rect[] {
	const scale = entry.scale ?? 1;
	const corner = 64 * scale;
	const inside = 6 * scale;
	const outside = 8 * scale;
	const above = 32 * scale;
	const masks: Rect[] = [];
	for (const [x = 0, y = 0, width = 0, height = 0] of entry.sheets ?? []) {
		const rect = { x: x * scale, y: y * scale, width: width * scale, height: height * scale };
		const left = rect.x - outside;
		const top = rect.y - above;
		const right = rect.x + rect.width + outside;
		const bottom = rect.y + rect.height + outside;
		masks.push(
			{ x: left, y: top, width: corner + outside, height: corner + above },
			{ x: right - corner - outside, y: top, width: corner + outside, height: corner + above },
			{ x: left, y: bottom - corner - outside, width: corner + outside, height: corner + outside },
			{ x: right - corner - outside, y: bottom - corner - outside, width: corner + outside, height: corner + outside },
			{ x: left, y: top, width: inside + outside, height: bottom - top },
			{ x: right - inside - outside, y: top, width: inside + outside, height: bottom - top },
			{ x: left, y: top, width: right - left, height: inside + above },
			{ x: left, y: bottom - inside - outside, width: right - left, height: inside + outside },
		);
	}
	return masks;
}

export async function iosParity(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, update: { type: "boolean" }, missing: { type: "boolean" }, quick: { type: "boolean" }, filter: { type: "string" } });
	const session = await startIosSuite("parity", argv, values);
	const missingOnly = values.missing === true;
	const update = values.update === true || missingOnly;
	const filter = flagString(values.filter);
	const chosenVariants = values.quick === true ? iosVariants.filter((variant) => variant.id !== "dark-rtl-normal") : iosVariants;
	const chosenCases = iosCases.filter((screen) => !filter || screen.id.includes(filter));
	if (chosenCases.length === 0) throw new Error(`--filter ${filter} matches no screen (${iosCases.map((screen) => screen.id).join(", ")})`);
	const source = await currentSource();
	console.log(`${update ? "updating" : "comparing"} ${iosMatrix(chosenCases, chosenVariants).length} cases`);

	const artifacts = join(runsDir, `parity-${slug(session.device.serial)}-${stamp(session.startedAt)}`);
	const results: ParityCase[] = [];
	const reports: (BuildIdentity | null)[] = [];
	let aborted: string | null = null;
	let deviceKind: string | null = null;
	let manifest: Manifest | null = null;
	let screenPixels = 0;
	try {
		for (const direction of ["ltr", "rtl"] as const satisfies readonly Direction[]) {
			const variantsOfDirection = chosenVariants.filter((variant) => variant.direction === direction);
			if (variantsOfDirection.length === 0) continue;
			const themes = [...new Set(variantsOfDirection.map((variant) => variant.theme))];
			const dir = join(artifacts, `capture-${direction}`);
			console.log(`capturing ${direction}: ${chosenCases.length} screens x ${themes.join(", ")}`);
			const captured = await captureScreens(session, {
				ids: chosenCases.map((screen) => screen.id),
				themes,
				direction,
				dir,
				token: newToken(),
				timeoutMs: 600_000,
				log: (line) => console.log(line),
			});
			// Before any of its cases are read: a capture of the wrong build ends the run and writes nothing.
			reports.push(captured.index.build);
			reportedIdentity(reports, session.build, "parity");
			const sized = captured.index.entries.find((entry) => entry.width && entry.height && entry.scale);
			if (!sized?.width || !sized.height || !sized.scale) throw new Error("the capture produced no screenshot");
			if (deviceKind === null) {
				deviceKind = iosDeviceKind(session.device.model, session.device.osVersion, { width: sized.width, height: sized.height, scale: sized.scale });
				screenPixels = sized.width * sized.height;
				manifest = (await readManifest(deviceKind)) ?? emptyManifest(deviceKind);
				if (!update && Object.keys(manifest.references).length === 0)
					console.log(`no references for ${deviceKind} yet: every case will be reported missing (run with --update to create them)`);
			}
			for (const variant of variantsOfDirection) {
				for (const { screen } of iosMatrix(chosenCases, [variant])) {
					if (missingOnly && manifest?.references[referenceName(screen, variant)]) continue;
					const record = await runCase({ screen, variant, entry: captured.index.entries.find((candidate) => candidate.name === `${screen.id}--${variant.theme}`), dir: captured.dir, deviceKind, manifest: manifest as Manifest, update, source, artifacts });
					results.push(record);
					const diff = record.differingPixels === null ? "" : ` ${record.differingPixels} px`;
					const masked = record.maskedPixels === null ? "" : ` (masked ${((record.maskedPixels / screenPixels) * 100).toFixed(1)} %)`;
					console.log(`  ${record.verdict.padEnd(17)} ${record.name}${diff}${masked}${record.detail && record.verdict !== "updated" ? `: ${record.detail.slice(0, 160)}` : ""}`);
					if (update && record.verdict === "updated" && manifest) await writeManifest(manifest);
				}
			}
		}
	} catch (error) {
		if (error instanceof IdentityMismatch) throw error;
		aborted = error instanceof Error ? error.message : String(error);
		console.log(`stopped: ${aborted.slice(0, 300)}`);
	}
	const installed = reportedIdentity(reports, session.build, "parity");
	if (reports.length > 0 && installed === null) console.log(`warning: ${notReported}`);

	const file: ParityFile = {
		schema: 1,
		kind: "parity",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source,
		device: session.device,
		app: withIdentity(session.app, installed),
		deviceKind: deviceKind ?? "ios-unknown",
		mode: update ? "update" : "check",
		screenPixels,
		matrixSize: iosMatrix(iosCases, iosVariants).length,
		selected: iosMatrix(chosenCases, chosenVariants).length,
		largestFontScale: 1,
		cases: results,
		notCovered: iosNotCovered,
		aborted,
	};
	const name = await writeRun("parity", session.device.serial, session.startedAt, file);
	const count = (verdict: ParityCase["verdict"]) => results.filter((record) => record.verdict === verdict).length;
	console.log(`parity: ${count("pass")} pass, ${count("fail")} fail, ${count("missing-reference")} missing reference, ${count("unstable")} unstable, ${count("error")} error, ${count("skipped")} skipped, ${count("updated")} updated; ${iosNotCovered.length} routes or states not covered`);
	console.log(`wrote qa/runs/${name}.json`);
}

type CaseInput = {
	screen: ScreenCase;
	variant: Variant;
	entry: CaptureEntry | undefined;
	dir: string;
	deviceKind: string;
	manifest: Manifest;
	update: boolean;
	source: ParityFile["source"];
	artifacts: string;
};

async function runCase(input: CaseInput): Promise<ParityCase> {
	const { screen, variant, entry, dir, deviceKind, manifest, update, source, artifacts } = input;
	const name = referenceName(screen, variant);
	if (!entry) return caseRecord(screen, variant, { verdict: "error", detail: "the app did not report this screen" });
	if (entry.error || !entry.png) return caseRecord(screen, variant, { verdict: "error", detail: entry.error ?? "no screenshot was written" });
	if (entry.rtl !== null && entry.rtl !== (variant.direction === "rtl"))
		return caseRecord(screen, variant, { verdict: "error", detail: `asked for ${variant.direction} but the window reported ${entry.rtl ? "rtl" : "ltr"}` });
	if (!entry.stable) return caseRecord(screen, variant, { verdict: "unstable", attempts: entry.attempts, detail: `no two consecutive screenshots were identical in ${entry.attempts} attempts` });
	let actual: Image;
	try {
		actual = decodePng(await readFile(join(dir, entry.png)));
	} catch (error) {
		return caseRecord(screen, variant, { verdict: "error", detail: `the screenshot could not be read: ${error instanceof Error ? error.message : String(error)}` });
	}
	const previous: ReferenceEntry | undefined = manifest.references[name];
	if (update) {
		const refusal = maskRefusal(
			[
				{ name: "moving views", masks: movingMasks(entry) },
				{ name: "glass views", masks: glassMasks(entry) },
				{ name: "sheet views", masks: sheetMasks(entry) },
			],
			actual,
		);
		if (refusal) return caseRecord(screen, variant, { verdict: "error", detail: `no reference written: ${refusal}` });
		const written = await writeReference(deviceKind, name, actual);
		let changed: number | null = null;
		let detail = "new";
		if (previous) {
			try {
				changed = compare(await readReference(deviceKind, previous), actual, previous.masks).differingPixels;
				detail = changed === 0 ? "unchanged" : "changed";
			} catch (error) {
				detail = `replaced an unreadable reference (${error instanceof Error ? error.message : String(error)})`;
			}
		}
		manifest.references[name] = {
			...written,
			masks: referenceMasks(null, [...movingMasks(entry), ...glassMasks(entry), ...sheetMasks(entry)], actual),
			screen: screen.id,
			route: screen.route,
			state: screen.state,
			theme: variant.theme,
			direction: variant.direction,
			fontScale: variant.fontScale,
			updatedAt: new Date().toISOString(),
			source,
		};
		return caseRecord(screen, variant, { verdict: "updated", differingPixels: changed, attempts: entry.attempts, detail });
	}
	if (!previous) return caseRecord(screen, variant, { verdict: "missing-reference", detail: `no reference in screenshots/${deviceKind}; run with --update to create it` });
	const result = compare(await readReference(deviceKind, previous), actual, previous.masks);
	const record = caseRecord(screen, variant, {
		verdict: result.verdict,
		differingPixels: result.differingPixels,
		maskedPixels: result.maskedPixels,
		differingMaskedPixels: result.differingMaskedPixels,
		bounds: result.bounds,
		attempts: entry.attempts,
	});
	if (result.diffImage) {
		await mkdir(artifacts, { recursive: true });
		await writeFile(join(artifacts, `${name}.actual.png`), encodePng(actual));
		await writeFile(join(artifacts, `${name}.diff.png`), encodePng(result.diffImage));
		record.actual = join(artifacts, `${name}.actual.png`).slice(qaDir.length + 1);
		record.diff = join(artifacts, `${name}.diff.png`).slice(qaDir.length + 1);
	}
	return record;
}
