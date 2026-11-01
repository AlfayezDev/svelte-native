import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Variant } from "./variant.ts";

/**
 * The generated Android project (`android/`) holds one variant at a time; the other is parked beside it as `android-<variant>/`, with
 * its Gradle outputs, so switching between the QA app and the smoke app renames directories. Only a finished project counts:
 *
 * - `.native-qa-variant` inside the project says which variant a finished prebuild made. A project without it, or with a name that is
 *   none of the variants, is of unknown origin (a prebuild that failed or was killed, one made by hand): it is never assembled as
 *   the QA app, and never parked as one.
 * - `android.prebuilding` beside it is written when a prebuild starts and removed when it ends. A failed prebuild removes the project;
 *   one that was killed leaves the file, and the next build removes the half project.
 */
export const markerName = ".native-qa-variant";
export const parkedPath = (dir: string, variant: Variant): string => `${dir}-${variant}`;
export const interruptedPath = (dir: string): string => `${dir}.prebuilding`;

export type Generated = Variant | "unknown" | null;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

/** The variant the project in [dir] was made for; "unknown" for one that is not finished or not marked, null when there is none. */
export async function generatedFor(dir: string): Promise<Generated> {
	if (await exists(interruptedPath(dir))) return (await exists(dir)) ? "unknown" : null;
	if (!(await exists(dir))) return null;
	if (!(await exists(join(dir, "app/build.gradle")))) return "unknown";
	const marker = (await readFile(join(dir, markerName), "utf8").catch(() => "")).trim();
	return marker === "qa" || marker === "smoke" ? marker : "unknown";
}

/**
 * Makes [dir] the variant's project: the one already there, or the one parked for it (the one in the way is parked in its place), or
 * none, in which case the reason to prebuild is returned. A project of unknown origin is removed, not parked.
 */
export async function selectVariantProject(variant: Variant, dir: string): Promise<string | null> {
	const current = await generatedFor(dir);
	if (current === variant) return null;
	let removed = false;
	if (current === "unknown") {
		await rm(dir, { recursive: true, force: true });
		await rm(interruptedPath(dir), { force: true });
		removed = true;
	} else if (current !== null) {
		await rm(parkedPath(dir, current), { recursive: true, force: true });
		await rename(dir, parkedPath(dir, current));
	} else await rm(interruptedPath(dir), { force: true });
	const parked = parkedPath(dir, variant);
	if ((await generatedFor(parked)) === variant) {
		await rename(parked, dir);
		return null;
	}
	if (removed) return `${dir} had no variant marker (an unfinished or foreign prebuild), and none is parked for ${variant}`;
	return current === null ? `${dir} is missing` : `${dir} was generated for the ${current} app, and none is parked for ${variant}`;
}

/**
 * Runs [prebuild] for the variant. The start is written down first; a prebuild that fails takes the half project with it, so no
 * later build reads it as a finished one; one that ends marks the project.
 */
export async function prebuildProject(variant: Variant, dir: string, prebuild: () => Promise<void>): Promise<void> {
	await writeFile(interruptedPath(dir), `${variant}\n`);
	try {
		await prebuild();
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		await rm(interruptedPath(dir), { force: true });
		throw error;
	}
	await writeFile(join(dir, markerName), `${variant}\n`);
	await rm(interruptedPath(dir), { force: true });
}

/** Why a project generated at [generatedFile] is out of date: an input of the prebuild is newer than it, or it is missing. Null when current. */
export async function staleReason(generatedFile: string, inputs: readonly string[]): Promise<string | null> {
	const generated = await stat(generatedFile).then((entry) => entry.mtimeMs, () => null);
	if (generated === null) return `${generatedFile} is missing`;
	for (const input of inputs) {
		const changed = await stat(input).then((entry) => entry.mtimeMs, () => null);
		if (changed !== null && changed > generated) return `${input} is newer than ${generatedFile}`;
	}
	return null;
}
