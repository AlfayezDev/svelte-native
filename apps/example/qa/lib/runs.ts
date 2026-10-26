import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { outDir, runsDir } from "./paths.ts";
import type {
	A11yFile,
	BootFile,
	BuildFile,
	CrashesFile,
	LabFile,
	ParityFile,
	ResilienceFile,
	SoakFile,
} from "./types.ts";

async function listDir(dir: string): Promise<string[]> {
	try {
		return await readdir(dir);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
}

export function stamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d+Z$/, "Z");
}

export function slug(serial: string): string {
	return serial.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** The kinds of run file `report` merges, one newest file per device of each. */
export const runKinds = ["lab", "boot", "soak", "crashes", "parity", "a11y", "resilience"] as const;
export type RunKind = (typeof runKinds)[number];

export async function writeRun(
	kind: RunKind,
	serial: string,
	startedAt: Date,
	data: LabFile | BootFile | SoakFile | CrashesFile | ParityFile | A11yFile | ResilienceFile,
): Promise<string> {
	await mkdir(runsDir, { recursive: true });
	const name = `${kind}-${slug(serial)}-${stamp(startedAt)}`;
	await writeFile(join(runsDir, `${name}.json`), `${JSON.stringify(data, null, "\t")}\n`);
	return name;
}

/**
 * A run file `report` never reads: a bisect of the soak (`partsoak`) or a self-test of the crash runner (`crashtest`).
 * Same layout as `writeRun`, with a prefix that is not a run kind, so it cannot stand in for a real run.
 */
export async function writeSideRun(
	prefix: "partsoak" | "crashtest",
	serial: string,
	startedAt: Date,
	data: SoakFile | CrashesFile,
): Promise<string> {
	await mkdir(runsDir, { recursive: true });
	const name = `${prefix}-${slug(serial)}-${stamp(startedAt)}`;
	await writeFile(join(runsDir, `${name}.json`), `${JSON.stringify(data, null, "\t")}\n`);
	return name;
}

const runName = new RegExp(`^(${runKinds.join("|")})-(.+)-(\\d{8}T\\d{6}Z)\\.json$`);

/** The newest run file of each kind for each device (keyed by the device's file-name slug), by the timestamp in the file name. */
export async function latestRunFiles(
	dir: string = runsDir,
): Promise<Record<RunKind, Map<string, string>>> {
	const newest = Object.fromEntries(
		runKinds.map((kind) => [kind, new Map<string, { stamp: string; file: string }>()]),
	) as Record<RunKind, Map<string, { stamp: string; file: string }>>;
	for (const file of await listDir(dir)) {
		const m = runName.exec(file);
		if (!m?.[1] || !m[2] || !m[3]) continue;
		const kind = m[1] as RunKind;
		const current = newest[kind].get(m[2]);
		if (!current || current.stamp < m[3]) newest[kind].set(m[2], { stamp: m[3], file });
	}
	return Object.fromEntries(
		runKinds.map((kind) => [
			kind,
			new Map([...newest[kind]].map(([device, entry]) => [device, join(dir, entry.file)])),
		]),
	) as Record<RunKind, Map<string, string>>;
}

export async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeBuild(build: BuildFile): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(
		join(outDir, `build-${build.abi}.json`),
		`${JSON.stringify(build, null, "\t")}\n`,
	);
}

export async function readBuilds(): Promise<Record<string, BuildFile>> {
	const builds: Record<string, BuildFile> = {};
	for (const file of await listDir(outDir)) {
		if (!/^build-.+\.json$/.test(file)) continue;
		const build = await readJson<BuildFile>(join(outDir, file));
		builds[build.abi] = build;
	}
	return builds;
}
