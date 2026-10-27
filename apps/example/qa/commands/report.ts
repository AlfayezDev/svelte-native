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
import { reachPct } from "../lib/a11y.ts";
import { deviceMetrics, missingScenarios, runFatals } from "../lib/metrics.ts";
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
	Platform,
	ResilienceFile,
	SoakFile,
	Source,
} from "../lib/types.ts";
import { summarize, type Summary } from "../parse/stats.ts";

type LabSummary = {
	file: string;
	source: Source;
	/** The `--run` the lab was started with; null for a file written before it was recorded. */
	run: string | null;
	/** Scenarios of the full run (`gates.json`) that some run of the file lacks. */
	missingScenarios: string[];
	runs: {
		startedAt: string;
		durationMs: number;
		complete: boolean;
		checks: { passed: number; failed: number; total: number } | null;
		/** Crashes and JavaScript errors; null when the app does not report its JavaScript errors and nothing else is a fatal. */
		fatals: number | null;
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

type A11yScreenSummary = {
	name: string;
	interactive: number;
	reachable: number;
	clipped: number;
	chromeModelled: number;
	stable: boolean | null;
};

type SuitesSummary = {
	parity: { file: string; mode: "check" | "update"; deviceKind: string } | null;
	a11y: { file: string; oracle: string; screens: A11yScreenSummary[] } | null;
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

function summarizeLab(file: LabFile, fileName: string, pinned: readonly string[]): LabSummary {
	return {
		file: fileName,
		source: file.source,
		run: typeof file.run === "string" ? file.run : null,
		missingScenarios: missingScenarios(file.runs, pinned),
		runs: file.runs.map((run) => ({
			startedAt: run.startedAt,
			durationMs: run.durationMs,
			complete: run.complete,
			checks: run.checks
				? { passed: run.checks.passed, failed: run.checks.failed, total: run.checks.total }
				: null,
			fatals: runFatals(file.device.platform, run),
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

/**
 * What identifies the build a run measured: an iOS run by the identity its app reported (the digests of `main.jsbundle` and
 * of the executable), an Android run by the digest of the installed APK; null when the run could not tell.
 */
export function buildKey(app: AppInfo): string | null {
	if (app.installed)
		return `main.jsbundle ${app.installed.jsbundleSha256.slice(0, 12)}, executable ${app.installed.executableSha256.slice(0, 12)}`;
	return app.installedSha256 ? `sha256 ${app.installedSha256.slice(0, 12)}` : null;
}

type Measured = { app: AppInfo; source: Source };

/** The commit an iOS run was built at (its build record), else the one the harness ran at. */
const commitOf = (run: Measured): string => {
	const { commit, dirty } = run.app.build ?? run.source;
	return `${commit}${dirty ? "+dirty" : ""}`;
};

/**
 * What the runs of one device must agree on: every run says which build it measured, all of them the same build, and the
 * lab and the boot run the same commit. A build nobody identified cannot be told from another, so it is a warning too.
 */
export function buildWarnings(serial: string, runs: [string, Measured | null][]): string[] {
	const present = runs.flatMap(([label, run]) => (run ? [{ label, run }] : []));
	const warnings = present
		.filter(({ run }) => buildKey(run.app) === null)
		.map(({ label }) => `${serial}: the ${label} run does not identify its build (build identity not reported)`);
	const keyed = present.flatMap(({ label, run }) => {
		const key = buildKey(run.app);
		return key === null ? [] : [{ label, key }];
	});
	const keys = [...new Set(keyed.map((entry) => entry.key))];
	if (keys.length > 1)
		warnings.push(
			`${serial}: the runs measured different builds (${keys.map((key) => `${keyed.filter((entry) => entry.key === key).map((entry) => entry.label).join(" and ")}: ${key}`).join("; ")})`,
		);
	const lab = present.find(({ label }) => label === "lab");
	const boot = present.find(({ label }) => label === "boot");
	if (lab && boot && commitOf(lab.run) !== commitOf(boot.run))
		warnings.push(`${serial}: the lab ran at ${commitOf(lab.run)} and the boot run at ${commitOf(boot.run)}`);
	if (present.some(({ run }) => run.app.build && run.app.build.executableSha256 === null))
		warnings.push(`${serial}: the build record (qa/out/ios-build.json) has no executable digest: build again`);
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
	const gates = await loadGates();
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
		const platform: Platform = reference.device.platform;
		warnings.push(
			...buildWarnings(serial, [
				["lab", lab],
				["boot", boot],
				["soak", soak],
				["crash", crashes],
				["parity", suites.parity],
				["accessibility", suites.a11y],
				["resilience", suites.resilience],
			]),
		);
		const pinned = gates.scenarios[platform];
		devices[serial] = {
			platform,
			info: reference.device,
			app: reference.app,
			lab: lab && labPath ? summarizeLab(lab, labPath.slice(labPath.lastIndexOf("runs/")), pinned) : null,
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
				a11y:
					suites.a11y && a11yPath
						? {
								file: a11yPath.slice(a11yPath.lastIndexOf("runs/")),
								oracle: suites.a11y.oracle,
								screens: suites.a11y.screens
									.filter((screen) => screen.error === null)
									.map((screen) => ({
										name: screen.name,
										interactive: screen.interactive,
										reachable: screen.reachable,
										clipped: screen.clipped,
										chromeModelled: screen.chromeModelled ?? 0,
										stable: screen.stable ?? null,
									})),
							}
						: null,
				resilience: suites.resilience && resiliencePath ? { file: resiliencePath.slice(resiliencePath.lastIndexOf("runs/")), screen: suites.resilience.screen } : null,
			},
			metrics: deviceMetrics(lab, boot, pinned, soak, crashes, suites),
		};
	}

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
			`  lab ${m["lab.runs"] ?? 0} complete run(s) (--run ${entry.lab?.run ?? "not recorded"}), checks ${m["lab.checks.passed"] ?? "-"} passed / ${m["lab.checks.failed"] ?? "-"} failed, fatals ${m["log.fatals"] ?? "not measured"}, engine warnings ${m["log.engineWarnings"] ?? "-"}`,
		);
		if (entry.lab && entry.lab.missingScenarios.length > 0)
			console.log(
				`  lab is not the full run: ${entry.lab.missingScenarios.length} of ${gates.scenarios[entry.platform].length} scenarios missing (${entry.lab.missingScenarios.join(", ")})`,
			);
		if (entry.soak)
			console.log(
				`  soak ${m["soak.minutes"] ?? "-"} min, heap growth ${m["memory.heapGrowthPct"] ?? "-"} % (JS ${m["memory.js.growthPct"] ?? "-"}, native ${m["memory.native.growthPct"] ?? "-"}), leaked views ${m["memory.leakedViews"] ?? "-"}, dead-tag writes ${m["memory.deadTagWrites"] ?? "-"}, crashes ${m["soak.crashes"] ?? "-"}`,
			);
		if (entry.suites.parity)
			console.log(
				`  parity ${m["parity.cases"] ?? 0}/${m["parity.casesExpected"] ?? "-"} cases compared, worst ${m["parity.diffPixelsOutsideMasks"] ?? "-"} px outside the masks, ${m["parity.casesSkipped"] ?? 0} skipped, ${m["parity.routesNotCovered"] ?? 0} routes not covered`,
			);
		if (entry.suites.a11y) {
			console.log(
				`  a11y ${m["a11y.screens"] ?? 0}/${m["a11y.screensExpected"] ?? "-"} screens, ${m["a11y.interactive"] ?? 0} interactive elements: unreachable ${m["a11y.unreachable"] ?? "-"}, unlabeled ${m["a11y.unlabeled"] ?? "-"}, not actionable ${m["a11y.notActionable"] ?? "-"}, order violations ${m["a11y.orderViolations"] ?? "-"}, titles not first ${m["a11y.titleNotFirst"] ?? "-"}, focus leaks ${m["a11y.focusLeaks"] ?? "-"}`,
			);
			for (const screen of entry.suites.a11y.screens)
				console.log(
					`    ${screen.name.padEnd(44)} reach ${reachPct(screen).padStart(5)} of ${String(screen.interactive).padStart(2)}, clipped ${screen.clipped}${screen.chromeModelled > 0 ? `, modelled chrome ${screen.chromeModelled}` : ""}${screen.stable === false ? ", tree not settled" : ""}`,
				);
		}
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
