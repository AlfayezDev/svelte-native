import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import {
	checkGatesFile,
	evaluate,
	renderTable,
	splitGates,
	tally,
	tallyByDevice,
	type GatesFile,
	type GateRow,
	type ReportDevice,
	type Role,
} from "../lib/gates.ts";
import { reachPct } from "../lib/a11y.ts";
import { deviceMetrics, missingScenarios, runFatals } from "../lib/metrics.ts";
import { missingModules, unexpectedSkips, unpinnedModules } from "../lib/smoke.ts";
import { allScenarios, failedChecks } from "../lib/gestures.ts";
import type { SuiteFiles } from "../lib/suite-metrics.ts";
import { gatesPath, reportPath } from "../lib/paths.ts";
import { latestRunFiles, readBuilds, readJson, runKinds, type RunKind } from "../lib/runs.ts";
import type {
	A11yFile,
	AppInfo,
	BootFile,
	BuildFile,
	CrashesFile,
	CrashReport,
	CrashReportsRecord,
	CrashSignature,
	DeviceInfo,
	GesturesFile,
	LabFile,
	Metrics,
	ParityFile,
	Platform,
	ResilienceFile,
	SessionRecord,
	SignedInRecord,
	SmokeFile,
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
		/** Android: the other app that came to the front during the run; null when none did. */
		interrupted: { at: string; by: string } | null;
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

/** What one iOS run file recorded of the phone's crash log: the reports, or why there are none to count (`error`: the pull failed, or the file was recorded before it existed). */
type CrashReportsSummary = { run: "lab" | "boot" | "parity" | "a11y" | "gestures"; file: string; error: string | null; reports: CrashReport[] };

/** One gestures run file: how each launch was driven and what each scenario came to. */
type GesturesSummary = {
	file: string;
	inputs: string[];
	launches: { input: string; complete: boolean; scenarios: { name: string; verdict: string; failedChecks: number }[] }[];
};

type SmokeSummary = {
	file: string;
	source: Source;
	complete: boolean;
	ok: number;
	failed: string[];
	skipped: string[];
	/** Pinned modules (`smoke.modules` in `gates.json`) no line of the run reported. */
	missing: string[];
	/** Skips the platform does not list (`smoke.skips` in `gates.json`). */
	unexpectedSkips: string[];
	fatals: number;
	/** Modules the run reported that `gates.json` does not pin. */
	unpinned: string[];
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
	/** The warnings of the smoke run (it is another app: it does not identify itself the way the QA runs do), which only the smoke lane reads. Absent in reports written before. */
	smokeWarnings?: string[];
	/** What a report shows without failing a gate: settings an earlier run left on a device, which a suite cleared before it measured. Absent in reports written before. */
	notes?: string[];
	/** The QA gates (everything but `smoke.*`), which `gates` judges. */
	gates: GateRow[];
	verdict: ReturnType<typeof tally>;
	/** The smoke gates, which `gates --smoke` judges on their own. Absent in reports written before the smoke app existed. */
	smokeGates?: GateRow[];
	smokeVerdict?: ReturnType<typeof tally>;
};

type ReportDeviceEntry = {
	platform: "android" | "ios";
	/** What the device is for (`devices` in `gates.json`): a gate that is not for its role is informational. Null: not listed, every gate judges it. */
	role: Role | null;
	name: string | null;
	/** The run kinds the device provides (`devices` in `gates.json`); null: every kind. */
	runs: RunKind[] | null;
	info: DeviceInfo;
	app: AppInfo;
	lab: LabSummary | null;
	boot: BootSummary | null;
	soak: SoakSummary | null;
	crashes: CrashesSummary | null;
	smoke: SmokeSummary | null;
	gestures: GesturesSummary | null;
	/** iOS only: the crash reports of the phone each run file recorded. */
	crashReports: CrashReportsSummary[];
	suites: SuitesSummary;
	metrics: Metrics;
};

function crashReportSummaries(platform: Platform, files: [CrashReportsSummary["run"], string | undefined, CrashReportsRecord | null][]): CrashReportsSummary[] {
	if (platform !== "ios") return [];
	return files.flatMap(([run, path, file]) => {
		if (!file || !path) return [];
		const error = file.crashReportsError ?? (file.crashReports === undefined ? "recorded before the crash log was read" : null);
		return [{ run, file: path.slice(path.lastIndexOf("runs/")), error, reports: error === null ? (file.crashReports ?? []) : [] }];
	});
}

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
			interrupted: run.interrupted ?? null,
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
 * of the executable: its CDHash), an Android run by the digest of the installed APK; null when the run could not tell.
 */
export function buildKey(app: AppInfo): string | null {
	if (app.installed)
		return `main.jsbundle ${app.installed.jsbundleSha256.slice(0, 12)}, CDHash ${app.installed.cdHash.slice(0, 12)}`;
	return app.installedSha256 ? `sha256 ${app.installedSha256.slice(0, 12)}` : null;
}

type Measured = { app: AppInfo; source: Source };

/** The commit an iOS run was built at (its build record), else the one the harness ran at. */
const commitOf = (run: Measured): string => {
	const { commit, dirty } = run.app.build ?? run.source;
	return `${commit}${dirty ? "+dirty" : ""}`;
};

/**
 * What the runs of one device must agree on: every run says which build it measured, and all of them the same build (the
 * installed artifact: the APK digest on Android, the `installed` pair on iOS). A build nobody identified cannot be told from
 * another, so it is a warning too. The commit a run was started at is not compared here: harness-only commits land between the
 * runs of one campaign, and runs of one artifact at different commits are a note (`buildNotes`).
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
	if (present.some(({ run }) => run.app.build && run.app.build.cdHash === null))
		warnings.push(`${serial}: the build record (qa/out/ios-build.json) has no CDHash: build again`);
	return warnings;
}

/**
 * The commit of each run of a device, when the runs measured one artifact (every run identified, all with the same identity):
 * the runs of one campaign may be taken at different commits when only the harness changed in between, so a difference is a note.
 * A difference in the identity is `buildWarnings`' warning, and then the commits say nothing more.
 */
export function buildNotes(serial: string, runs: [string, Measured | null][]): string[] {
	const present = runs.flatMap(([label, run]) => (run ? [{ label, run }] : []));
	const keys = present.map(({ run }) => buildKey(run.app));
	if (present.length === 0 || keys.includes(null) || new Set(keys).size > 1) return [];
	const commits = new Set(present.map(({ run }) => commitOf(run)));
	if (commits.size < 2) return [];
	return [
		`${serial}: the runs of one build (${keys[0]}) were taken at different commits (${present.map(({ label, run }) => `${label}: ${commitOf(run)}`).join(", ")}); the installed artifact is the same`,
	];
}

/**
 * What the Android suites' sessions recorded of the device's state. A run that could not put the device back
 * (`restoreFailures`: it was lost, a setting did not take) left it in a changed state, a warning like the cross-build ones:
 * `gates` fails on it. A run that found settings an earlier run left (`leftovers`) cleared them before it measured, so its
 * numbers stand; the note shows that the earlier run did not restore. A run that saw the device restart (`deviceRestarts`: the
 * emulator died or a watchdog restarted it) re-applied its settings and retried the case in flight, so it is still a measured run:
 * a note per restart; a restart that broke a case is that case's own error.
 */
export function sessionFindings(
	serial: string,
	runs: [string, (SessionRecord & { signedInPhase?: SignedInRecord | null }) | null][],
): { warnings: string[]; notes: string[] } {
	const warnings: string[] = [];
	const notes: string[] = [];
	for (const [label, run] of runs) {
		if (!run) continue;
		if (run.restoreFailures && run.restoreFailures.length > 0)
			warnings.push(
				`${serial}: the device was left in a changed state by the ${label} run (${run.restoreFailures.join("; ")})`,
			);
		if (run.leftovers && run.leftovers.length > 0)
			notes.push(
				`${serial}: the ${label} run found what an earlier run left on the device, so that run did not restore it, and cleared it (${run.leftovers.join("; ")})`,
			);
		// The signed-in phase's own words: why it did not run, or did not end, are not the device's state and not a warning (its gates fail
		// by themselves, as not measured), but a reader of the report should not have to open the run file to learn it.
		if (run.signedInPhase?.detail)
			notes.push(`${serial}: the signed-in phase of the ${label} run: ${run.signedInPhase.detail}${run.signedInPhase.signedIn ? "" : " (nothing signed-in was run)"}`);
		for (const restart of run.deviceRestarts ?? [])
			notes.push(
				`${serial}: the device restarted at ${restart.at} (boot id ${restart.bootId}) during the ${label} run, which re-applied its settings and retried the case in flight`,
			);
	}
	return { warnings, notes };
}

export async function loadGates(): Promise<GatesFile> {
	const file = JSON.parse(await readFile(gatesPath, "utf8")) as GatesFile;
	checkGatesFile(file);
	return file;
}

/** The devices of a report as the gates see them. Roles come from `gates.json` as it is now, so editing them needs no new measurement. */
export function reportDevices(report: ReportFile, gates: GatesFile): Record<string, ReportDevice> {
	return Object.fromEntries(
		Object.entries(report.devices).map(([serial, entry]) => [
			serial,
			{ platform: entry.platform, role: gates.devices[serial]?.role ?? null, runs: gates.devices[serial]?.runs ?? null, metrics: entry.metrics },
		]),
	);
}

export function printVerdict(rows: GateRow[], all: boolean): boolean {
	console.log(renderTable(rows, all));
	const { gates, informational, ok } = tally(rows);
	console.log(
		`\n${gates.pass} gates pass, ${gates.fail} fail, ${gates.notMeasured} not measured (a gate that was not measured fails)${informational > 0 ? `; ${informational} informational, not counted` : ""}`,
	);
	for (const entry of tallyByDevice(rows))
		console.log(
			`  ${entry.device}${entry.role ? ` (${entry.role})` : ""}: ${entry.gates.pass} pass, ${entry.gates.fail} fail, ${entry.gates.notMeasured} not measured${entry.informational > 0 ? `, ${entry.informational} informational` : ""}`,
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
	const smokeWarnings: string[] = [];
	const notes: string[] = [];
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
		const smokePath = files.smoke.get(key);
		const smoke = smokePath ? await readJson<SmokeFile>(smokePath) : null;
		const gesturesPath = files.gestures.get(key);
		const gestures = gesturesPath ? await readJson<GesturesFile>(gesturesPath) : null;
		const suites: SuiteFiles = {
			parity: parityPath ? await readJson<ParityFile>(parityPath) : null,
			a11y: a11yPath ? await readJson<A11yFile>(a11yPath) : null,
			resilience: resiliencePath ? await readJson<ResilienceFile>(resiliencePath) : null,
		};
		const reference = lab ?? boot ?? soak ?? crashes ?? suites.parity ?? suites.a11y ?? suites.resilience ?? gestures ?? smoke;
		if (!reference) continue;
		const serial = reference.device.serial;
		const platform: Platform = reference.device.platform;
		// The smoke run measured another app (`io.rasheed.svelteqa.smoke`), so it is not compared with the others' builds.
		const measured: [string, Measured | null][] = [
			["lab", lab],
			["boot", boot],
			["soak", soak],
			["crash", crashes],
			["parity", suites.parity],
			["accessibility", suites.a11y],
			["resilience", suites.resilience],
			["gestures", gestures],
		];
		warnings.push(...buildWarnings(serial, measured));
		smokeWarnings.push(...buildWarnings(serial, [["smoke", smoke]]));
		notes.push(...buildNotes(serial, measured));
		const found = sessionFindings(serial, [
			["parity", suites.parity],
			["accessibility", suites.a11y],
			["resilience", suites.resilience],
		]);
		warnings.push(...found.warnings);
		notes.push(...found.notes);
		const pinned = gates.scenarios[platform];
		const pins = { modules: gates.smoke.modules[platform], skips: gates.smoke.skips[platform] };
		const pinnedGestures = gates.gestures?.[platform] ?? allScenarios;
		devices[serial] = {
			platform,
			role: gates.devices[serial]?.role ?? null,
			name: gates.devices[serial]?.name ?? null,
			runs: gates.devices[serial]?.runs ?? null,
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
			smoke:
				smoke && smokePath
					? {
							file: smokePath.slice(smokePath.lastIndexOf("runs/")),
							source: smoke.source,
							complete: smoke.complete,
							ok: smoke.results.filter((result) => result.status === "ok").length,
							failed: smoke.results.filter((result) => result.status === "fail").map((result) => result.module),
							skipped: smoke.results.filter((result) => result.status === "skip").map((result) => result.module),
							missing: missingModules(smoke.results, pins.modules),
							unexpectedSkips: unexpectedSkips(smoke.results, pins),
							fatals: smoke.crashes.length,
							unpinned: unpinnedModules(smoke.results, pins.modules),
						}
					: null,
			gestures:
				gestures && gesturesPath
					? {
							file: gesturesPath.slice(gesturesPath.lastIndexOf("runs/")),
							inputs: gestures.inputs,
							launches: gestures.launches.map((launch) => ({
								input: launch.input,
								complete: launch.complete,
								scenarios: launch.scenarios.map((result) => ({ name: result.name, verdict: result.verdict, failedChecks: failedChecks(result) })),
							})),
						}
					: null,
			crashReports: crashReportSummaries(platform, [
				["lab", labPath, lab],
				["boot", bootPath, boot],
				["parity", parityPath, suites.parity],
				["a11y", a11yPath, suites.a11y],
				["gestures", gesturesPath, gestures],
			]),
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
			metrics: deviceMetrics(lab, boot, pinned, soak, crashes, suites, smoke ? { file: smoke, pins } : null, gestures, pinnedGestures, gates.signedIn?.[platform] ?? []),
		};
	}

	const lanes = splitGates(gates.gates);
	const judged = Object.fromEntries(
		Object.entries(devices).map(([serial, entry]) => [
			serial,
			{ platform: entry.platform, role: entry.role, runs: entry.runs, metrics: entry.metrics },
		]),
	);
	const rows = evaluate(lanes.standard, judged);
	const smokeRows = evaluate(lanes.smoke, judged);
	const output: ReportFile = {
		schema: 1,
		generatedAt: new Date().toISOString(),
		builds: await readBuilds(),
		devices,
		warnings,
		smokeWarnings,
		notes,
		gates: rows,
		verdict: tally(rows),
		smokeGates: smokeRows,
		smokeVerdict: tally(smokeRows),
	};
	await writeFile(reportPath, `${JSON.stringify(output, null, "\t")}\n`);

	for (const [serial, entry] of Object.entries(devices)) {
		const m = entry.metrics;
		console.log(
			`${serial}: ${entry.info.model} (${entry.info.kind}, ${entry.info.abi}, ${entry.info.refreshHz ?? "?"} Hz)${entry.role ? ` [${entry.role}${entry.name ? `: ${entry.name}` : ""}]` : ""}`,
		);
		console.log(
			`  boot warm p90 ${m["boot.warm.p90"] ?? "-"} ms (${m["boot.warm.samples"] ?? 0} samples, ${m["boot.warm.retried"] ?? 0} retried), cold p90 ${m["boot.cold.p90"] ?? "-"} ms (${m["boot.cold.samples"] ?? 0} samples, ${m["boot.cold.retried"] ?? 0} retried)`,
		);
		console.log(
			`  lab ${m["lab.runs"] ?? 0} complete run(s) (--run ${entry.lab?.run ?? "not recorded"}), checks ${m["lab.checks.passed"] ?? "-"} passed / ${m["lab.checks.failed"] ?? "-"} failed, fatals ${m["log.fatals"] ?? "not measured"}, engine warnings ${m["log.engineWarnings"] ?? "-"}`,
		);
		for (const [index, run] of (entry.lab?.runs ?? []).entries())
			if (run.interrupted)
				console.log(`  lab run ${index + 1} is incomplete: interrupted by ${run.interrupted.by} at ${run.interrupted.at} (device clock), after ${run.scenarios.length} scenario(s)`);
		if (entry.platform === "ios") {
			console.log(`  crash reports ${m["log.crashReports"] ?? "not measured"}`);
			for (const summary of entry.crashReports) {
				if (summary.error !== null) console.log(`    ${summary.run}: not measured (${summary.error})`);
				for (const crash of summary.reports)
					console.log(`    ${summary.run}: ${crash.file} pid ${crash.pid ?? "?"} ${crash.exceptionType ?? "unreadable"}${crash.signal ? ` ${crash.signal}` : ""}${crash.attributedTo ? ` [${crash.attributedTo}]` : ""}: ${crash.reason ?? "no reason"}`);
			}
		}
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
		if (entry.smoke)
			console.log(
				`  smoke ${m["smoke.ok"] ?? 0} ok, ${m["smoke.failed"] ?? "-"} failed${entry.smoke.failed.length ? ` (${entry.smoke.failed.join(", ")})` : ""}, ${m["smoke.skipped"] ?? 0} skipped${entry.smoke.unexpectedSkips.length ? ` (unexpected: ${entry.smoke.unexpectedSkips.join(", ")})` : ""}, ${m["smoke.missing"] ?? "-"} missing${entry.smoke.missing.length ? ` (${entry.smoke.missing.join(", ")})` : ""} of ${m["smoke.modules"] ?? "-"} pinned, ${entry.smoke.fatals} fatals${entry.smoke.complete ? "" : ", the run did not complete"}${entry.smoke.unpinned.length ? `; not pinned: ${entry.smoke.unpinned.join(", ")}` : ""}`,
			);
		if (entry.gestures)
			console.log(
				`  gestures ${m["gestures.launches"] ?? 0} complete launch(es) (${entry.gestures.inputs.join(", ")}), ${m["gestures.scenarios.missing"] ?? "-"} scenarios missing, agreement mismatches ${m["gestures.agreement.mismatches"] ?? "not measured"}, fatals ${m["gestures.fatals"] ?? "-"}, engine warnings ${m["gestures.engineWarnings"] ?? "-"}; checks failed: ${entry.gestures.launches.flatMap((launch) => launch.scenarios.filter((result) => result.failedChecks > 0).map((result) => `${result.name} (${launch.input})`)).join(", ") || "none"}`,
			);
		if (entry.crashes)
			console.log(
				`  crashes ${m["crashes.coldStarts"] ?? 0} cold starts (${m["crashes.coldStartCrashes"] ?? "-"} crashed, ${m["crashes.coldStartsNoBoot"] ?? "-"} without boot), ${m["crashes.suites"] ?? 0} suites (${m["crashes.suiteCrashes"] ?? "-"} crashed, ${m["crashes.suitesIncomplete"] ?? "-"} incomplete), ANRs ${m["crashes.anrs"] ?? "-"}`,
			);
	}
	for (const note of notes) console.log(`note: ${note}`);
	for (const warning of warnings) console.log(`warning: ${warning}`);
	for (const warning of smokeWarnings) console.log(`warning (smoke): ${warning}`);
	console.log("");
	printVerdict(rows, false);
	// The smoke app's gates are their own lane (`gates --smoke`); they are shown when a smoke run exists.
	if (Object.values(devices).some((entry) => entry.smoke)) {
		console.log("\nnative module smoke gates (the smoke app; `gates --smoke` judges them):");
		printVerdict(smokeRows, false);
	}
	console.log("\nwrote qa/report.json");
}
