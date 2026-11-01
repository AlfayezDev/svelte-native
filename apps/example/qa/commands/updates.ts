import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
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
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { defaultPackage, platformDir, qaDir, runsDir, svelteNativeCli } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BuildFile, Launch } from "../lib/types.ts";
import {
	bootComparison,
	parsePublished,
	publishArguments,
	publishEnvironment,
	runUpdatesScenario,
	type PublishedUpdate,
	type UpdateKind,
	type UpdateLaunch,
	type UpdatesDriver,
	type UpdatesFile,
} from "../lib/updates.ts";
import { defaultSettle, launchSettled, parseUpdateObservation } from "../lib/updates-log.ts";
import { sleep } from "../lib/wait.ts";
import { launchSlot } from "./boot.ts";

/** Pinned: the version eas.json asks for is `>= 24.14.0`, and what `eas` on a machine is varies. `NATIVE_QA_EAS` replaces the whole command. */
const defaultEas = "npx -y eas-cli@27.2.0";

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

type Eas = { command: string; args: string[] };

function easCommand(value: string | undefined): Eas {
	const parts = (value ?? process.env.NATIVE_QA_EAS ?? defaultEas).trim().split(/\s+/);
	const [command, ...args] = parts;
	if (!command) throw new Error("--eas is empty");
	return { command, args };
}

async function runEas(eas: Eas, args: string[], env: Record<string, string>, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
	return exec(eas.command, [...eas.args, ...args], { cwd: platformDir, env, timeoutMs });
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
		eas: { type: "string" },
		environment: { type: "string" },
		dexopt: { type: "string" },
		package: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const lock = lockFor(serial);
	if (lock) reexecUnderLock(lock, ["updates", ...argv]);

	const channel = qaChannel(values.channel ?? "qa", "channel") as string;
	const warmCount = integerFlag(values.warm, "warm", 30);
	const options = { maxLaunches: integerFlag(values["max-launches"], "max-launches", 4), settleLaunches: integerFlag(values.settle, "settle", 3) };
	if (options.maxLaunches < 2) throw new Error("--max-launches must be at least 2: one start downloads an update and the next runs it");
	const packageName = flagString(values.package) ?? defaultPackage;
	const environment = flagString(values.environment) ?? "development";
	const eas = easCommand(flagString(values.eas));
	const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com";
	const dexopt = dexoptFlag(values.dexopt);

	await assertOnline(serial);
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

	// The harness publishes as the logged-in user; fail now, not after the app has been installed.
	const who = await runEas(eas, ["whoami"], { CI: "1" }, 120_000);
	if (who.code !== 0) throw new Error(`eas whoami failed (${eas.command} ${eas.args.join(" ")}): ${(who.stderr || who.stdout).trim().slice(0, 300)}`);

	const logs: string[] = [];
	const note = (line: string) => {
		console.log(line);
		logs.push(line);
	};
	const runTag = `qa-${stamp(startedAt)}`;
	note(`${device.kind} ${device.model} (${serial}) ${device.abi}; channel ${channel}; ${apk}; ${baseline ? `baseline ${baseline}` : "no baseline build"}`);

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
		}
	} else note("no baseline build (qa/out/app-<abi>.apk): the boot comparison is skipped");

	// 2. The channel build, with an empty updates store: its first start runs the embedded bundle.
	const app = await prepareApp(serial, device, { apk, noInstall: false, packageName, dexopt });
	await forceStop(serial, packageName);
	const cleared = await shell(serial, `pm clear ${packageName}`);
	if (!cleared.stdout.includes("Success")) throw new Error(`pm clear ${packageName} failed: ${cleared.stdout.trim()} ${cleared.stderr.trim()}`);

	const sync = await exec(process.execPath, [svelteNativeCli, "sync"], { cwd: platformDir, timeoutMs: 600_000 });
	if (sync.code !== 0) throw new Error(`svelte-native sync failed: ${(sync.stderr || sync.stdout).trim().slice(0, 400)}`);

	let launchCount = 0;
	const driver: UpdatesDriver = {
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
			const ran = launch.running ? (launch.running.kind === "update" ? `update ${launch.running.id}` : "the embedded bundle") : "no bundle logged";
			console.log(
				`  launch ${String(index).padStart(2)} ${phase.padEnd(8)} ran ${ran}${launch.probe?.marker ? ` [${launch.probe.marker}]` : ""}, ${launch.booted ? "booted" : "did not boot"}, check ${launch.check ? (launch.check.outcome === "none" ? `none (${launch.check.reason})` : launch.check.outcome === "downloaded" ? `downloaded ${launch.check.id}` : launch.check.outcome) : "-"}${launch.failedIds.length ? `, recovered from ${launch.failedIds.join(", ")}` : ""}${launch.crashes || launch.jsErrors ? `, ${launch.crashes} crash(es), ${launch.jsErrors} JS error(s)` : ""} (${launch.settledBy})`,
			);
			return launch;
		},

		async publish(kind: UpdateKind): Promise<PublishedUpdate> {
			const marker = `${runTag}-${kind}`;
			const message = `native-qa updates ${runTag} ${kind}`;
			note(`publishing ${kind} update ${marker} to the ${channel} channel`);
			const published = await runEas(eas, publishArguments(channel, environment, message), publishEnvironment(kind, marker, channel, apiUrl), 20 * 60_000);
			logs.push(`--- eas update (${kind}) exit ${published.code}`, published.stderr.split("\n").slice(-15).join("\n"));
			if (published.code !== 0) throw new Error(`eas update failed (exit ${published.code}): ${(published.stderr || published.stdout).trim().slice(-600)}`);
			const update = parsePublished(published.stdout, kind, marker);
			note(`  published ${update.id} (group ${update.group})`);
			return update;
		},

		async bootSeries(): Promise<Launch[]> {
			note(`warm boot with updates enabled: ${warmCount} launches`);
			const launches: Launch[] = [];
			for (let index = 1; index <= warmCount; index++) {
				const { launch } = await launchSlot(serial, packageName, "warm", index, 0);
				launches.push(launch);
			}
			return launches;
		},
	};

	const scenario = await runUpdatesScenario(driver, options);
	await forceStop(serial, packageName);

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
		eas: { command: [eas.command, ...eas.args].join(" "), environment },
		options,
		scenario,
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
	await writeFile(join(runsDir, `${name}.log`), `${logs.join("\n")}\n`);
	await writeRun("updates", serial, startedAt, file);
	const { good, bad, cleanup } = scenario;
	note(
		`applied ${good.applied} (${good.launchesToApply ?? "-"} launches), rolled back ${bad.rolledBack} (to ${bad.rolledBackTo ?? "-"}, failed id ${bad.failedIdReported ?? "-"}), bad retried ${bad.retried}, unexpected faults ${scenario.unexpectedFaults}, channel healthy ${cleanup.healthy}`,
	);
	if (file.boot.delta)
		note(`warm boot p50 ${file.boot.enabled?.p50 ?? "-"} ms against ${file.boot.baseline?.p50 ?? "-"} (${signed(file.boot.delta.p50)}), p90 ${file.boot.enabled?.p90 ?? "-"} against ${file.boot.baseline?.p90 ?? "-"} (${signed(file.boot.delta.p90)}), informational`);
	for (const error of scenario.errors) console.error(`problem: ${error}`);
	console.log(`wrote qa/runs/${name}.json`);
}

const signed = (value: number | null) => (value === null ? "-" : `${value >= 0 ? "+" : ""}${value} ms`);
