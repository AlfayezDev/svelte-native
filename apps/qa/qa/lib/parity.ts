import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { diffImages, decodePng, encodePng, maskBitmap, type Image, type Rect } from "./png.ts";
import { qaDir } from "./paths.ts";
import type { ParityCase, Source } from "./types.ts";
import type { ScreenCase, Variant } from "./screens.ts";

export const screenshotsDir = join(qaDir, "screenshots");

export type ReferenceMask = Rect & { name: string };

export type ReferenceEntry = {
	file: string;
	sha256: string;
	width: number;
	height: number;
	/** The regions that legitimately vary, frozen with the image. Everything else must match exactly. */
	masks: ReferenceMask[];
	screen: string;
	route: string;
	state: ScreenCase["state"];
	theme: Variant["theme"];
	direction: Variant["direction"];
	fontScale: number;
	updatedAt: string;
	source: Source;
};

export type Manifest = {
	schema: 1;
	deviceKind: string;
	references: Record<string, ReferenceEntry>;
};

export function kindDirectory(deviceKind: string, root: string = screenshotsDir): string {
	return join(root, deviceKind);
}

export function emptyManifest(deviceKind: string): Manifest {
	return { schema: 1, deviceKind, references: {} };
}

export async function readManifest(
	deviceKind: string,
	root: string = screenshotsDir,
): Promise<Manifest | null> {
	try {
		const manifest = JSON.parse(
			await readFile(join(kindDirectory(deviceKind, root), "manifest.json"), "utf8"),
		) as Manifest;
		if (manifest.schema !== 1)
			throw new Error(`screenshots/${deviceKind}/manifest.json has schema ${manifest.schema}`);
		return manifest;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

export async function writeManifest(
	manifest: Manifest,
	root: string = screenshotsDir,
): Promise<void> {
	const dir = kindDirectory(manifest.deviceKind, root);
	await mkdir(dir, { recursive: true });
	const sorted = Object.fromEntries(
		Object.entries(manifest.references).sort(([a], [b]) => a.localeCompare(b)),
	);
	const text = `${JSON.stringify({ ...manifest, references: sorted }, null, "\t")}\n`;
	await writeFile(join(dir, "manifest.json"), text);
}

export async function readReference(
	deviceKind: string,
	entry: ReferenceEntry,
	root: string = screenshotsDir,
): Promise<Image> {
	const bytes = await readFile(join(kindDirectory(deviceKind, root), entry.file));
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== entry.sha256)
		throw new Error(
			`screenshots/${deviceKind}/${entry.file} does not match its manifest checksum (edited or corrupted)`,
		);
	return decodePng(bytes);
}

/** Writes a reference image and returns its manifest entry's file, checksum and size. */
export async function writeReference(
	deviceKind: string,
	name: string,
	image: Image,
	root: string = screenshotsDir,
): Promise<Pick<ReferenceEntry, "file" | "sha256" | "width" | "height">> {
	const dir = kindDirectory(deviceKind, root);
	await mkdir(dir, { recursive: true });
	const bytes = encodePng(image);
	const file = `${name}.png`;
	await writeFile(join(dir, file), bytes);
	return {
		file,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		width: image.width,
		height: image.height,
	};
}

/** How far a reference's mask of a moving node reaches past the node's box, on each side. */
export const MASK_PAD = 2;

/** The masks a reference is frozen with: the status bar (clock, battery, notification icons), the navigation bar (the gesture pill) and the case's own nodes. */
export function referenceMasks(statusBar: Rect | null, caseMasks: Rect[], image: Image, navigationBar: Rect | null = null): ReferenceMask[] {
	const pad = MASK_PAD;
	const clip = (rect: Rect): Rect => {
		const x = Math.max(0, rect.x - pad);
		const y = Math.max(0, rect.y - pad);
		return {
			x,
			y,
			width: Math.min(image.width, rect.x + rect.width + pad) - x,
			height: Math.min(image.height, rect.y + rect.height + pad) - y,
		};
	};
	return [
		...(statusBar ? [{ name: "status bar", ...statusBar }] : []),
		...(navigationBar ? [{ name: "navigation bar", ...navigationBar }] : []),
		...caseMasks.map((rect, index) => ({ name: `moving node ${index + 1}`, ...clip(rect) })),
	];
}

/**
 * Why a reference's status bar mask cannot be trusted, or null. The mask is frozen with the reference and the comparison ignores nothing else of the
 * band the clock and the notification icons are drawn in, so a mask that is not the device's band today leaves part of them compared (2 Nov: the eight
 * `screens-tabs` references were frozen with 63 px of a 128 px band, and every check that followed saw another clock). A reference without one has none.
 */
export function statusBarMaskProblem(masks: ReferenceMask[], statusBar: Rect): string | null {
	const frozen = masks.find((mask) => mask.name === "status bar");
	const show = (rect: Rect) => `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
	if (!frozen) return `the reference has no status bar mask (the device's band is ${show(statusBar)}): retake it with --update`;
	if (frozen.x === statusBar.x && frozen.y === statusBar.y && frozen.width === statusBar.width && frozen.height === statusBar.height) return null;
	return `the reference's status bar mask (${show(frozen)}) is not the device's status bar band (${show(statusBar)}): it was frozen before the system bars settled, so the clock and the notification icons are compared; retake it with --update`;
}

/** The most of a screenshot its masks may cover, as a percentage: the bar of the `parity.maskedPct` gate in gates.json. A mask this wide hides what the comparison is for. */
export const maxMaskedPct = 25;

/** The share of the image the rectangles cover, in percent (overlaps counted once). */
export function maskedPct(masks: Rect[], image: Pick<Image, "width" | "height">): number {
	let covered = 0;
	for (const pixel of maskBitmap(image.width, image.height, masks)) covered += pixel;
	return (covered / (image.width * image.height)) * 100;
}

/**
 * Why a reference may not be frozen with these masks, or null: they cover more of the screenshot than `maxMaskedPct`. `parts`
 * says what each group of masks hides (views that move, the system's glass, sheet cards), so the message names which one to cut.
 */
export function maskRefusal(parts: { name: string; masks: Rect[] }[], image: Pick<Image, "width" | "height">): string | null {
	const total = maskedPct(parts.flatMap((part) => part.masks), image);
	if (total <= maxMaskedPct) return null;
	const share = parts.map((part) => `${part.name}: ${part.masks.length} masks, ${maskedPct(part.masks, image).toFixed(1)} %`).join("; ");
	return `its masks cover ${total.toFixed(1)} % of the screen, more than the ${maxMaskedPct} % the parity.maskedPct gate allows (${share})`;
}

export type Comparison = Pick<
	ParityCase,
	"verdict" | "differingPixels" | "maskedPixels" | "differingMaskedPixels" | "bounds"
> & { diffImage: Image | null };

/** One screenshot against its reference: pass only with zero differing pixels outside the reference's masks. */
export function compare(reference: Image, actual: Image, masks: Rect[]): Comparison {
	const diff = diffImages(reference, actual, masks);
	return {
		verdict: diff.differing === 0 ? "pass" : "fail",
		differingPixels: diff.differing,
		maskedPixels: diff.masked,
		differingMaskedPixels: diff.differingMasked,
		bounds: diff.bounds,
		diffImage: diff.differing === 0 ? null : diff.image,
	};
}
