import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import {
	evaluate,
	renderTable,
	tally,
	type GatesFile,
	type GateRow,
	type ReportDevice,
} from "../lib/gates.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import type { SuiteFiles } from "../lib/suite-metrics.ts";
import { gatesPath, reportPath } from "../lib/paths.ts";
import { latestRunFiles, readBuilds, readJson, runKinds } from "../lib/runs.ts";
import type {
	A11yFile,
	AppInfo,
	BootFile,
	BuildFile,
	CrashesFile,
	CrashSignature,
	DeviceInfo,
	LabFile,
	Metrics,
	ParityFile,
	ResilienceFile,
	SoakFile,
	Source,
} from "../lib/types.ts";
import { summarize, type Summary } from "../parse/stats.ts";

type LabSummary = {
	file: string;
	source: Source;
	runs: {
		startedAt: string;
		durationMs: number;
		complete: boolean;
		checks: { passed: number; failed: number; total: number } | null;
		fatals: number;
		engineWarnings: number;
		boot: Record<string, number> | null;
		scenarios: {
			name: string;
			verdict: string;
			droppedPct: number | null;
			p95: number | null;
			maxMs: number | null;
			mountMs: number | null;
		}[];
	}[];
};

type BootSeries = {
	displayMs: Summary;
	runningMainMs: Summary;
	totalTimeMs: Summary;
	jsTotalMs: Summary;
	failedLaunches: number;
};
type BootSummary = {
	file: string;
	source: Source;
	definition: BootFile["definition"];
	warm: BootSeries;
	cold: BootSeries;
};

type SoakSummary = {
	file: string;
	source: Source;
	minutesRequested: number;
	complete: boolean;
	jsSamples: number;
	processSamples: number;
	crashes: string[];
};

type CrashesSummary = {
	file: string;
	source: Source;
	coldStarts: number;
	suites: number;
	signatures: CrashSignature[];
};

type SuitesSummary = {
	parity: { file: string; mode: "check" | "update"; deviceKind: string } | null;
	a11y: { file: string; oracle: string } | null;
	resilience: { file: string; screen: string } | null;
};

export type ReportFile = {
	schema: 1;
	generatedAt: string;
	builds: Record<string, BuildFile>;
	devices: Record<string, ReportDeviceEntry>;
	warnings: string[];
	gates: GateRow[];
	verdict: ReturnType<typeof tally>;
};

type ReportDeviceEntry = {
	platform: "android" | "ios";
	info: DeviceInfo;
	app: AppInfo;
	lab: LabSummary | null;
	boot: BootSummary | null;
	soak: SoakSummary | null;
	crashes: CrashesSummary | null;
	suites: SuitesSummary;
	metrics: Metrics;
};

function summarizeLab(file: LabFile, fileName: string): LabSummary {
	return {
		file: fileName,
		source: file.source,
		runs: file.runs.map((run) => ({
			startedAt: run.startedAt,
			durationMs: run.durationMs,
			complete: run.complete,
			checks: run.checks
				? { passed: run.checks.passed, failed: run.checks.failed, total: run.checks.total }
				: null,
			fatals: run.crashes.length + run.jsErrors.length,
			engineWarnings: run.engineWarnings.length,
			boot: run.boot,
			scenarios: run.scenarios.map((scenario) => ({
				name: scenario.name,
				verdict: scenario.verdict,
				droppedPct: scenario.frames?.droppedPct ?? null,
				p95: scenario.frames?.p95 ?? null,
				maxMs: scenario.frames?.max ?? null,
				mountMs: typeof scenario.detail?.mountMs === "number" ? scenario.detail.mountMs : null,
			})),
		})),
	};
}

function series(launches: BootFile["warm"]): BootSeries {
	const numbers = (pick: (launch: BootFile["warm"][number]) => number | null | undefined) =>
		launches.map(pick).filter((value): value is number => typeof value === "number");
	return {
		displayMs: summarize(numbers((launch) => launch.displayMs)),
		runningMainMs: summarize(numbers((launch) => launch.runningMainMs)),
		totalTimeMs: summarize(numbers((launch) => launch.totalTimeMs)),
		jsTotalMs: summarize(numbers((launch) => launch.jsMarks?.total)),
		failedLaunches: launches.filter((launch) => launch.error !== null).length,
	};
}

/** The soak and the crash runs of a device against the build its lab or boot run measured. */
function runsOfOtherBuilds(
	serial: string,
	reference: { app: AppInfo } | null,
	others: [string, { app: AppInfo } | null][],
): string[] {
	const expected = reference?.app.installedSha256;
	if (!expected) return [];
	return others.flatMap(([label, other]) =>
		other?.app.installedSha256 && other.app.installedSha256 !== expected
			? [
					`${serial}: the ${label} run measured another installed build than the lab and boot runs (sha256 ${other.app.installedSha256.slice(0, 12)} and ${expected.slice(0, 12)})`,
				]
			: [],
	);
}

function consistency(serial: string, lab: LabFile | null, boot: BootFile | null): string[] {
	if (!lab || !boot) return [];
	const warnings: string[] = [];
	if (lab.app.installedSha256 !== boot.app.installedSha256)
		warnings.push(
			`${serial}: the lab and the boot run measured different installed builds (sha256 ${lab.app.installedSha256?.slice(0, 12)} and ${boot.app.installedSha256?.slice(0, 12)})`,
		);
	if (lab.source.commit !== boot.source.commit || lab.source.dirty !== boot.source.dirty)
		warnings.push(
			`${serial}: the lab ran at ${lab.source.commit}${lab.source.dirty ? "+dirty" : ""} and the boot run at ${boot.source.commit}${boot.source.dirty ? "+dirty" : ""}`,
		);
	return warnings;
}

export async function loadGates(): Promise<GatesFile> {
	return JSON.parse(await readFile(gatesPath, "utf8")) as GatesFile;
}

export function reportDevices(report: ReportFile): Record<string, ReportDevice> {
	return Object.fromEntries(
		Object.entries(report.devices).map(([serial, entry]) => [
			serial,
			{ platform: entry.platform, metrics: entry.metrics },
		]),
	);
}

export function printVerdict(rows: GateRow[], all: boolean): boolean {
	console.log(renderTable(rows, all));
	const { gates, ok } = tally(rows);
	console.log(
		`\n${gates.pass} gates pass, ${gates.fail} fail, ${gates.notMeasured} not measured (a gate that was not measured fails)`,
	);
	return ok;
}

export async function report(): Promise<void> {
	const files = await latestRunFiles();
	const { lab: labFiles, boot: bootFiles, soak: soakFiles, crashes: crashesFiles } = files;
	const slugs = new Set(runKinds.flatMap((kind) => [...files[kind].keys()]));
	const devices: Record<string, ReportDeviceEntry> = {};
	const warnings: string[] = [];
	for (const key of slugs) {
		const labPath = labFiles.get(key);
		const bootPath = bootFiles.get(key);
		const lab = labPath ? await readJson<LabFile>(labPath) : null;
		const boot = bootPath ? await readJson<BootFile>(bootPath) : null;
		const soakPath = soakFiles.get(key);
		const soak = soakPath ? await readJson<SoakFile>(soakPath) : null;
		const crashesPath = crashesFiles.get(key);
		const crashes = crashesPath ? await readJson<CrashesFile>(crashesPath) : null;
		const parityPath = files.parity.get(key);
		const a11yPath = files.a11y.get(key);
		const resiliencePath = files.resilience.get(key);
		const suites: SuiteFiles = {
			parity: parityPath ? await readJson<ParityFile>(parityPath) : null,
			a11y: a11yPath ? await readJson<A11yFile>(a11yPath) : null,
			resilience: resiliencePath ? await readJson<ResilienceFile>(resiliencePath) : null,
		};
		const reference = lab ?? boot ?? soak ?? crashes ?? suites.parity ?? suites.a11y ?? suites.resilience;
		if (!reference) continue;
		const serial = reference.device.serial;
		warnings.push(...consistency(serial, lab, boot));
		warnings.push(
			...runsOfOtherBuilds(serial, lab ?? boot, [
				["soak", soak],
				["crash", crashes],
				["parity", suites.parity],
				["accessibility", suites.a11y],
				["resilience", suites.resilience],
			]),
		);
		devices[serial] = {
			platform: reference.device.platform,
			info: reference.device,
			app: reference.app,
			lab: lab && labPath ? summarizeLab(lab, labPath.slice(labPath.lastIndexOf("runs/"))) : null,
			boot:
				boot && bootPath
					? {
							file: bootPath.slice(bootPath.lastIndexOf("runs/")),
							source: boot.source,
							definition: boot.definition,
							warm: series(boot.warm),
							cold: series(boot.cold),
						}
					: null,
			soak:
				soak && soakPath
					? {
							file: soakPath.slice(soakPath.lastIndexOf("runs/")),
							source: soak.source,
							minutesRequested: soak.minutesRequested,
							complete: soak.complete,
							jsSamples: soak.js.length,
							processSamples: soak.memory.length,
							crashes: soak.crashes,
						}
					: null,
			crashes:
				crashes && crashesPath
					? {
							file: crashesPath.slice(crashesPath.lastIndexOf("runs/")),
							source: crashes.source,
							coldStarts: crashes.coldStarts.length,
							suites: crashes.suites.length,
							signatures: crashes.signatures,
						}
					: null,
			suites: {
				parity: suites.parity && parityPath ? { file: parityPath.slice(parityPath.lastIndexOf("runs/")), mode: suites.parity.mode, deviceKind: suites.parity.deviceKind } : null,
				a11y: suites.a11y && a11yPath ? { file: a11yPath.slice(a11yPath.lastIndexOf("runs/")), oracle: suites.a11y.oracle } : null,
				resilience: suites.resilience && resiliencePath ? { file: resiliencePath.slice(resiliencePath.lastIndexOf("runs/")), screen: suites.resilience.screen } : null,
			},
			metrics: deviceMetrics(lab, boot, soak, crashes, suites),
		};
	}

	const gates = await loadGates();
	const rows = evaluate(
		gates.gates,
		Object.fromEntries(
			Object.entries(devices).map(([serial, entry]) => [
				serial,
				{ platform: entry.platform, metrics: entry.metrics },
			]),
		),
	);
	const output: ReportFile = {
		schema: 1,
		generatedAt: new Date().toISOString(),
		builds: await readBuilds(),
		devices,
		warnings,
		gates: rows,
		verdict: tally(rows),
	};
	await writeFile(reportPath, `${JSON.stringify(output, null, "\t")}\n`);

	for (const [serial, entry] of Object.entries(devices)) {
		const m = entry.metrics;
		console.log(
			`${serial}: ${entry.info.model} (${entry.info.kind}, ${entry.info.abi}, ${entry.info.refreshHz ?? "?"} Hz)`,
		);
		console.log(
			`  boot warm p90 ${m["boot.warm.p90"] ?? "-"} ms (${m["boot.warm.samples"] ?? 0} samples), cold p90 ${m["boot.cold.p90"] ?? "-"} ms (${m["boot.cold.samples"] ?? 0} samples)`,
		);
		console.log(
			`  lab ${m["lab.runs"] ?? 0} complete run(s), checks ${m["lab.checks.passed"] ?? "-"} passed / ${m["lab.checks.failed"] ?? "-"} failed, fatals ${m["log.fatals"] ?? "-"}, engine warnings ${m["log.engineWarnings"] ?? "-"}`,
		);
		if (entry.soak)
			console.log(
				`  soak ${m["soak.minutes"] ?? "-"} min, heap growth ${m["memory.heapGrowthPct"] ?? "-"} % (JS ${m["memory.js.growthPct"] ?? "-"}, native ${m["memory.native.growthPct"] ?? "-"}), leaked views ${m["memory.leakedViews"] ?? "-"}, dead-tag writes ${m["memory.deadTagWrites"] ?? "-"}, crashes ${m["soak.crashes"] ?? "-"}`,
			);
		if (entry.suites.parity)
			console.log(
				`  parity ${m["parity.cases"] ?? 0}/${m["parity.casesExpected"] ?? "-"} cases compared, worst ${m["parity.diffPixelsOutsideMasks"] ?? "-"} px outside the masks, ${m["parity.casesSkipped"] ?? 0} skipped, ${m["parity.routesNotCovered"] ?? 0} routes not covered`,
			);
		if (entry.suites.a11y)
			console.log(
				`  a11y ${m["a11y.screens"] ?? 0}/${m["a11y.screensExpected"] ?? "-"} screens, ${m["a11y.interactive"] ?? 0} interactive elements: unreachable ${m["a11y.unreachable"] ?? "-"}, unlabeled ${m["a11y.unlabeled"] ?? "-"}, not actionable ${m["a11y.notActionable"] ?? "-"}, order violations ${m["a11y.orderViolations"] ?? "-"}, titles not first ${m["a11y.titleNotFirst"] ?? "-"}, focus leaks ${m["a11y.focusLeaks"] ?? "-"}`,
			);
		if (entry.suites.resilience)
			console.log(
				`  resilience ${m["resilience.steps"] ?? 0} steps, ${m["resilience.failures"] ?? "-"} failed`,
			);
		if (entry.crashes)
			console.log(
				`  crashes ${m["crashes.coldStarts"] ?? 0} cold starts (${m["crashes.coldStartCrashes"] ?? "-"} crashed, ${m["crashes.coldStartsNoBoot"] ?? "-"} without boot), ${m["crashes.suites"] ?? 0} suites (${m["crashes.suiteCrashes"] ?? "-"} crashed, ${m["crashes.suitesIncomplete"] ?? "-"} incomplete), ANRs ${m["crashes.anrs"] ?? "-"}`,
			);
	}
	for (const warning of warnings) console.log(`warning: ${warning}`);
	console.log("");
	printVerdict(rows, false);
	console.log("\nwrote qa/report.json");
}
