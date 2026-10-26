import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { diffImages, decodePng, encodePng, type Image, type Rect } from "./png.ts";
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
	await writeFile(
		join(dir, "manifest.json"),
		`${JSON.stringify({ ...manifest, references: sorted }, null, "\t")}\n`,
	);
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

/** The masks a reference is frozen with: the status bar (clock, battery, notification icons) and the case's own nodes. */
export function referenceMasks(statusBar: Rect, caseMasks: Rect[], image: Image): ReferenceMask[] {
	const pad = 2;
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
		{ name: "status bar", ...statusBar },
		...caseMasks.map((rect, index) => ({ name: `moving node ${index + 1}`, ...clip(rect) })),
	];
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
