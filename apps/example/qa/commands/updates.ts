import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
	deviceProps,
	dumpLogcat,
	forceStop,
	shell,
	startApp,
	wake,
} from "../lib/adb.ts";
import { dexoptFlag, defaultApkPath, describeApk, prepareApp } from "../lib/app.ts";
import { channelOutDir, qaChannel } from "../lib/channel.ts";
import { exec } from "../lib/exec.ts";
import { flagString, integerFlag, parseFlags, platformOf, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { channelLock, lockFor, reexecUnderLock } from "../lib/lock.ts";
import { easCommand, easEnvironment, easName, redact, tail, type Eas } from "../lib/eas.ts";
import { assertClearable, clearAppData, identify, resetMode, resetRelease, resetRequest } from "../lib/reset.ts";
import { defaultPackage, platformDir, qaDir, runsDir, svelteNativeCli } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BuildFile, Launch } from "../lib/types.ts";
import {
	badFaults,
	bootComparison,
	comparisonNotes,
	ensureHealthyChannel,
	parseChannelView,
	parsePublished,
	publishArguments,
	publishEnvironment,
	runUpdatesScenario,
	type BadFault,
	type DeviceState,
	type PublishedUpdate,
	type UpdateKind,
	type UpdateLaunch,
	type UpdatesDriver,
	type UpdatesFile,
	type UpdatesScenario,
} from "../lib/updates.ts";
import { defaultSettle, launchSettled, parseUpdateObservation } from "../lib/updates-log.ts";
import { sleep } from "../lib/wait.ts";
import { launchSlot } from "./boot.ts";
import { loadGates } from "./report.ts";

/** The lines of a launch's logcat that say anything about updates, kept in the run's log. */
const relevant = /SvelteUpdates|\[Svelte updates\]|\[Svelte QA updates\]|\[Svelte boot\]|Start proc|Displayed |handleHostException|FATAL EXCEPTION| E ReactNativeJS/;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function readBuild(directory: string, abi: string): Promise<BuildFile | null> {
	try {
		return JSON.parse(await readFile(join(directory, `build-${abi}.json`), "utf8")) as BuildFile;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

function parseFaults(value: string | boolean | undefined): BadFault[] {
	if (value === undefined) return [...badFaults];
	if (typeof value !== "string") throw new Error("--faults needs a list");
	const faults = value.split(",").map((fault) => fault.trim()).filter(Boolean);
	for (const fault of faults) if (!(badFaults as readonly string[]).includes(fault)) throw new Error(`--faults names ${JSON.stringify(fault)}; the faults are ${badFaults.join(", ")}`);
	if (faults.length === 0 || new Set(faults).size !== faults.length) throw new Error("--faults must list each fault once, at least one");
	return faults as BadFault[];
}

export async function updates(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") throw new Error("native-qa updates runs on Android; the iPhone path is not wired");
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"baseline-apk": { type: "string" },
		"no-baseline": { type: "boolean" },
		channel: { type: "string" },
		warm: { type: "string" },
		"max-launches": { type: "string" },
		settle: { type: "string" },
		faults: { type: "string" },
		eas: { type: "string" },
		environment: { type: "string" },
		dexopt: { type: "string" },
		package: { type: "string" },
		reset: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const channel = qaChannel(values.channel ?? "qa", "channel") as string;
	const warmCount = integerFlag(values.warm, "warm", 30);
	const reset = resetMode(values.reset);
	const options = {
		maxLaunches: integerFlag(values["max-launches"], "max-launches", 4),
		settleLaunches: integerFlag(values.settle, "settle", 3),
		expectReset: reset === "app",
		faults: parseFaults(values.faults),
	};
	if (options.maxLaunches < 2) throw new Error("--max-launches must be at least 2: one start downloads an update and the next runs it");
	if (options.settleLaunches < 1) throw new Error("--settle must be at least 1: without a launch after the bad update nothing shows it is not tried again");
	const packageName = flagString(values.package) ?? defaultPackage;
	const environment = flagString(values.environment) ?? "development";
	const eas: Eas = easCommand(flagString(values.eas));
	const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com";
	const dexopt = dexoptFlag(values.dexopt);

	// One run per device and one per channel: two runs publishing to a channel at once would each find the other's updates at its head.
	const deviceLock = lockFor(serial);
	if (deviceLock) reexecUnderLock(deviceLock, ["updates", ...argv]);
	reexecUnderLock(channelLock(channel), ["updates", ...argv]);

	await assertOnline(serial);
	// Who the device is, from what it says about itself: a phone reached by a wireless or forwarded serial is still the phone.
	const gates = await loadGates();
	const identity = identify(serial, await deviceProps(serial), gates);
	if (reset === "data") assertClearable(identity);
	const startedAt = new Date();
	const device = await deviceInfo(serial);
	const channelDir = channelOutDir(channel);
	const apk = flagString(values.apk) ?? join(channelDir, `app-${device.abi}.apk`);
	if (!(await exists(apk))) throw new Error(`${apk} does not exist: build it with \`native-qa build --updates-channel ${channel} --abi ${device.abi}\``);
	const build = await readBuild(channelDir, device.abi);
	if (build?.updatesChannel !== channel && !values.apk)
		throw new Error(`${join(channelDir, `build-${device.abi}.json`)} says the build is for ${build?.updatesChannel ?? "no channel"}, not ${channel}`);
	const baselineApk = values["no-baseline"] ? null : (flagString(values["baseline-apk"]) ?? defaultApkPath(device.abi));
	const baseline = baselineApk && (await exists(baselineApk)) ? baselineApk : null;
	if (values["baseline-apk"] && baseline === null) throw new Error(`--baseline-apk ${String(values["baseline-apk"])} does not exist`);
	const baselineBuild = baseline && !values["baseline-apk"] ? await readBuild(join(qaDir, "out"), device.abi) : null;

	// What eas-cli gets of this environment is a short list, and what comes back is redacted before it is logged or recorded.
	const runEas = (args: string[], extra: Record<string, string>, timeoutMs: number) =>
		exec(eas.command, [...eas.args, ...args], { cwd: platformDir, env: easEnvironment(process.env, extra), exactEnv: true, timeoutMs });
	const failure = (title: string, result: { code: number; stdout: string; stderr: string }) => new Error(`${title} (exit ${result.code}): ${tail(result.stderr || result.stdout, 8)}`);

	// The harness publishes as the logged-in user and to the channel's own branch; fail now, before anything is installed or published.
	const who = await runEas(["whoami"], { CI: "1" }, 120_000);
	if (who.code !== 0) throw failure(`eas whoami failed (${easName(eas)})`, who);
	const version = (await runEas(["--version"], { CI: "1" }, 120_000)).stdout.trim().split("\n")[0] ?? null;
	const view = await runEas(["channel:view", channel, "--json"], { CI: "1" }, 120_000);
	if (view.code !== 0) throw failure(`eas channel:view ${channel} failed`, view);
	const channelInfo = parseChannelView(view.stdout, channel);

	const logs: string[] = [];
	const note = (line: string) => {
		console.log(line);
		logs.push(line);
	};
	/** A warm launch is quiet on its own; a line every fifth keeps a half-hour run readable. */
	const progress = (series: string, launch: Launch) => {
		if (launch.index % 5 === 0 || launch.error) note(`  ${series} warm ${String(launch.index).padStart(2)}: ${launch.displayMs ?? "-"} ms${launch.error ? `  [${launch.error}]` : ""}`);
	};
	note(`${device.kind} ${device.model} (${serial}${identity.serialno && identity.serialno !== serial ? `, serial number ${identity.serialno}` : ""}; role ${identity.role ?? "none"}${identity.emulator ? ", emulator" : ""}) ${device.abi}; channel ${channel} -> branch ${channelInfo.branch}; ${apk}; ${baseline ? `baseline ${baseline}` : "no baseline build"}`);
	if (channelInfo.head) note(`channel head before the run: ${channelInfo.head.id} (${channelInfo.head.createdAt}, ${JSON.stringify(channelInfo.head.message)})`);

	// 1. The same app without a channel, warm: the boot the channel build is compared with.
	const baselineLaunches: Launch[] = [];
	let baselineSha: string | null = null;
	if (baseline) {
		await prepareApp(serial, device, { apk: baseline, noInstall: false, packageName, dexopt });
		baselineSha = (await describeApk(baseline)).sha256;
		note(`baseline warm boot: ${warmCount} launches of ${baseline}`);
		for (let index = 1; index <= warmCount; index++) {
			const { launch } = await launchSlot(serial, packageName, "warm", index, 0);
			baselineLaunches.push(launch);
			progress("baseline", launch);
		}
	} else note("no baseline build (qa/out/app-<abi>.apk): the boot comparison is skipped");

	const runTag = `qa-${stamp(startedAt)}`;
	const state: DeviceState = { finalBuild: "channel", resetSettingRemoved: false, note: null };
	let launchCount = 0;
	let live: UpdatesScenario | null = null;
	let publishing: Promise<unknown> = Promise.resolve();
	let driver: UpdatesDriver | null = null;

	/** Whatever the run did to the device settings, undone; the plain QA build put back. Safe to run more than once. */
	let restored = false;
	const restoreDevice = async () => {
		if (restored) return;
		restored = true;
		if (reset === "app") {
			try {
				await shell(serial, resetRelease);
				state.resetSettingRemoved = true;
			} catch (error) {
				note(`WARNING: could not remove the reset setting from ${serial}: ${redact(error instanceof Error ? error.message : String(error))}`);
			}
		}
		try {
			await forceStop(serial, packageName);
		} catch (error) {
			note(`WARNING: could not stop the app on ${serial}: ${redact(error instanceof Error ? error.message : String(error))}`);
		}
		if (baseline) {
			try {
				await prepareApp(serial, device, { apk: baseline, noInstall: false, packageName, dexopt });
				state.finalBuild = "plain";
			} catch (error) {
				state.note = `the plain QA build could not be put back: ${redact(error instanceof Error ? error.message : String(error))}`;
			}
		} else state.note = "there was no plain QA build to put back";
		if (state.finalBuild === "channel") console.error(`WARNING: the channel build is left installed on ${serial} (${state.note}); install the plain QA build before any other run measures it`);
	};

	// A run cut short must still leave the channel on a good update, and the device as it found it.
	const onSignal = (signal: NodeJS.Signals) => {
		console.error(`${signal}: publishing the clean-up update and restoring the device before exiting`);
		void (async () => {
			try {
				if (driver && live) await ensureHealthyChannel(driver, live);
			} catch (error) {
				console.error(`clean-up failed: ${redact(error instanceof Error ? error.message : String(error))}`);
			}
			await restoreDevice().catch(() => undefined);
			process.exit(signal === "SIGINT" ? 130 : 143);
		})();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	let app: UpdatesFile["app"] | undefined;
	let scenario: UpdatesScenario | undefined;
	try {
		// 2. The channel build, installed over what is there. It resets its own update state on the first start (--reset app), or
		// the data is cleared (--reset data, a lab emulator only).
		app = await prepareApp(serial, device, { apk, noInstall: false, packageName, dexopt });
		await forceStop(serial, packageName);
		if (reset === "data") await clearAppData((command) => shell(serial, command), identity, packageName);
		else {
			const requested = await shell(serial, resetRequest(runTag));
			if (requested.code !== 0) throw new Error(`could not set the reset flag: ${(requested.stderr || requested.stdout).trim()}`);
		}

		const sync = await exec(process.execPath, [svelteNativeCli, "sync"], { cwd: platformDir, timeoutMs: 600_000 });
		if (sync.code !== 0) throw new Error(`svelte-native sync failed: ${tail(sync.stderr || sync.stdout, 8)}`);

		const doPublish = async (kind: UpdateKind, fault: BadFault | null): Promise<PublishedUpdate> => {
			const marker = `${runTag}-${kind}${fault ? `-${fault}` : ""}`;
			const message = `native-qa updates ${runTag} ${kind}${fault ? ` ${fault}` : ""}`;
			note(`publishing ${kind}${fault ? ` (${fault})` : ""} update ${marker} to the ${channel} channel`);
			const published = await runEas(publishArguments(channel, environment, message), publishEnvironment(kind, marker, channel, apiUrl, fault), 20 * 60_000);
			logs.push(`--- eas update (${kind}${fault ? ` ${fault}` : ""}) exit ${published.code}`, tail(published.stderr, 15));
			if (published.code !== 0) throw failure("eas update failed", published);
			const update = parsePublished(published.stdout, kind, marker, fault);
			if (update.branch !== channelInfo.branch) throw new Error(`eas update published ${update.id} to the branch ${JSON.stringify(update.branch)}, not the channel's ${JSON.stringify(channelInfo.branch)}`);
			note(`  published ${update.id} (group ${update.group}, branch ${update.branch})`);
			return update;
		};

		driver = {
			async launch(phase): Promise<UpdateLaunch> {
				const index = ++launchCount;
				await wake(serial);
				await forceStop(serial, packageName);
				await sleep(1000);
				await clearLogcat(serial);
				const started = Date.now();
				// `am start -W` waits for the first frame; a bundle that cannot boot may leave it waiting, and the log is what counts.
				const am = startApp(serial, packageName).catch((error: unknown) => note(`  am start: ${error instanceof Error ? error.message : String(error)}`));
				let settledBy = null as ReturnType<typeof launchSettled>;
				while (settledBy === null) {
					await sleep(1000);
					settledBy = launchSettled(parseUpdateObservation(await dumpLogcat(serial), packageName), Date.now() - started, defaultSettle);
				}
				// The lines that follow what settled the launch (the probe, the end of a fatal) land a moment later.
				await sleep(1500);
				const text = await dumpLogcat(serial);
				await Promise.race([am, sleep(2000)]);
				const observation = parseUpdateObservation(text, packageName);
				logs.push(`=== launch ${index} (${phase}) ===`, ...text.split("\n").filter((line) => relevant.test(line)));
				const launch: UpdateLaunch = { ...observation, index, phase, settledBy };
				// The first start has consumed the reset request (or it will never be honoured): take it off the device before anything else runs.
				if (phase === "baseline" && reset === "app") {
					await shell(serial, resetRelease);
					state.resetSettingRemoved = true;
				}
				const ran = launch.running ? (launch.running.kind === "update" ? `update ${launch.running.id}` : "the embedded bundle") : "no bundle logged";
				console.log(
					`  launch ${String(index).padStart(2)} ${phase.padEnd(8)} ran ${ran}${launch.probe?.marker ? ` [${launch.probe.marker}]` : ""}, ${launch.booted ? "booted" : "did not boot"}, check ${launch.check ? (launch.check.outcome === "none" ? `none (${launch.check.reason})` : launch.check.outcome === "downloaded" ? `downloaded ${launch.check.id}` : launch.check.outcome) : "-"}${launch.reset ? `, QA reset forgot ${launch.reset.forgotten}` : ""}${launch.failedIds.length ? `, recovered from ${launch.failedIds.join(", ")}` : ""}${launch.crashes || launch.jsErrors ? `, ${launch.crashes} crash(es), ${launch.jsErrors} JS error(s)` : ""} (${launch.settledBy})`,
				);
				return launch;
			},

			// One publish at a time: each exports into the same dist/ directory, and a clean-up from a signal must not overlap the one in flight.
			publish(kind: UpdateKind, fault?: BadFault): Promise<PublishedUpdate> {
				const run = publishing.then(() => doPublish(kind, fault ?? null));
				publishing = run.catch(() => undefined);
				return run;
			},

			async bootSeries(): Promise<Launch[]> {
				note(`warm boot with updates enabled: ${warmCount} launches`);
				const launches: Launch[] = [];
				for (let index = 1; index <= warmCount; index++) {
					const { launch } = await launchSlot(serial, packageName, "warm", index, 0);
					launches.push(launch);
					progress("updates", launch);
				}
				return launches;
			},
		};

		scenario = await runUpdatesScenario(driver, options, (observed) => { live = observed; });
		// A run that failed in a way the scenario could not recover from still owes the channel its clean-up.
		if (scenario.attempts.length > 0 && !scenario.cleanup.healthy && scenario.cleanup.published === null) await ensureHealthyChannel(driver, scenario);
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		await restoreDevice();
	}
	if (!scenario || !app) throw new Error("the updates run produced no result");

	const source = await currentSource();
	const file: UpdatesFile = {
		schema: 1,
		kind: "updates",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source,
		device,
		app,
		channel,
		runtimeVersion: scenario.baseline?.probe?.runtimeVersion ?? null,
		build: build ? { commit: build.source.commit, dirty: build.source.dirty, sha256: build.apk.sha256, updatesChannel: build.updatesChannel ?? null } : null,
		eas: { command: easName(eas), version, environment },
		channelInfo,
		deviceState: state,
		options,
		scenario,
		notes: comparisonNotes(build ? { commit: build.source.commit, dirty: build.source.dirty } : null, baselineBuild ? { commit: baselineBuild.source.commit, dirty: baselineBuild.source.dirty } : null),
		boot: bootComparison(
			scenario.bootEnabled,
			baselineLaunches,
			baselineSha && baselineBuild ? { sha256: baselineSha, commit: baselineBuild.source.commit, dirty: baselineBuild.source.dirty } : baselineSha ? { sha256: baselineSha, commit: "unknown", dirty: false } : null,
		),
		logFile: "",
	};
	await mkdir(runsDir, { recursive: true });
	const name = `updates-${slug(serial)}-${stamp(startedAt)}`;
	file.logFile = `runs/${name}.log`;
	await writeFile(join(runsDir, `${name}.log`), `${redact(logs.join("\n"))}\n`);
	await writeRun("updates", serial, startedAt, file);
	const { good, bads, cleanup } = scenario;
	note(
		`applied ${good.applied} (${good.launchesToApply ?? "-"} launches), rolled back ${bads.map((bad) => `${bad.fault} ${bad.rolledBack}`).join(", ")} (to ${bads.map((bad) => bad.rolledBackTo ?? "-").join(", ")}), bad retried ${bads.map((bad) => bad.retried).join("+")} (checks refused ${bads.map((bad) => `${bad.blockedChecks}/${bad.launchesAfter}`).join(", ")}), unexpected faults ${scenario.unexpectedFaults ?? "not measured"}, channel healthy ${cleanup.healthy}; device left on the ${state.finalBuild} build`,
	);
	if (file.boot.delta)
		note(`warm boot p50 ${file.boot.enabled?.p50 ?? "-"} ms against ${file.boot.baseline?.p50 ?? "-"} (${signed(file.boot.delta.p50)}), p90 ${file.boot.enabled?.p90 ?? "-"} against ${file.boot.baseline?.p90 ?? "-"} (${signed(file.boot.delta.p90)}), informational`);
	for (const line of [...file.notes, ...scenario.notes]) console.log(`note: ${line}`);
	for (const error of scenario.errors) console.error(`problem: ${redact(error)}`);
	console.log(`wrote qa/runs/${name}.json`);
}

const signed = (value: number | null) => (value === null ? "-" : `${value >= 0 ? "+" : ""}${value} ms`);
