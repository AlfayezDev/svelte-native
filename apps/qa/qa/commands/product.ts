import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertOnline, clearLogcat, deviceInfo, deviceProps, dumpLogcat, forceStop, shell, startApp, wake } from "../lib/adb.ts";
import { defaultApkPath, dexoptFlag, prepareApp } from "../lib/app.ts";
import { dumpUi } from "../lib/device.ts";
import { flagString, parseFlags, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { describeProduct, isHomeScreen, parseLaunchMs, productFatals, productPackage, productProblems, productWindowMs, type ProductFile } from "../lib/product.ts";
import { assertProductDevice, clearAppData, identify, refusePhone } from "../lib/reset.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { sleep } from "../lib/wait.ts";
import { loadGates } from "./report.ts";

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * The product boot check. Installs the example's production variant (`dev.alfayez.exposvelte.qaproduct`, `qa/out/app-production-<abi>.apk` from `native-qa
 * build --variant production`) on the OVH emulator, clears its data so it starts with no stored state, starts it cold and, for 15 s from the
 * start, looks for its first screen (the home screen) in the accessibility tree of its window while logcat collects what the app does. It
 * passes when the screen came and the app logged no JavaScript fatal and no native crash. Writes `qa/runs/product-<device>-<stamp>.json`, a
 * run kind of its own.
 *
 * Only a device that says it is an emulator and that `gates.json` lists as the lab is used: a phone is refused before the first adb
 * command, by its serial, and again by what the device reports about itself. A phone's copy of the production variant is never touched.
 * `windowMs` is the 15 s the check allows; only the tests pass another (a shorter one makes the check stricter, never weaker).
 */
export async function product(argv: string[], windowMs: number = productWindowMs): Promise<void> {
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"no-install": { type: "boolean" },
		dexopt: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const gates = await loadGates();
	refusePhone(identify(serial, {}, gates), "install or start the production variant");
	const lock = lockFor(serial);
	if (lock) await reexecUnderLock(lock, ["product", ...argv]);

	await assertOnline(serial);
	const identity = identify(serial, await deviceProps(serial), gates);
	assertProductDevice(identity);
	const startedAt = new Date();
	const device = await deviceInfo(serial);
	const apk = flagString(values.apk);
	if (values["no-install"] !== true && apk === undefined && !(await exists(defaultApkPath(device.abi, "production"))))
		throw new Error(`${defaultApkPath(device.abi, "production")} does not exist: build it with \`native-qa build --variant production --abi ${device.abi}\``);
	const app = await prepareApp(serial, device, {
		apk,
		noInstall: values["no-install"] === true,
		packageName: productPackage,
		dexopt: dexoptFlag(values.dexopt),
		variant: "production",
	});
	console.log(`${device.kind} ${device.model} (${serial}), Android ${device.osVersion}, ${device.abi}; product ${app.versionName} installed ${app.lastUpdateTime}`);

	// A start with no stored state (language, appearance), so the first screen is the home screen in the device's language.
	await clearAppData((command) => shell(serial, command), identity, productPackage);
	await mkdir(runsDir, { recursive: true });
	await wake(serial);
	await forceStop(serial, productPackage);
	await clearLogcat(serial);
	const launched = Date.now();
	const started = await startApp(serial, productPackage);
	const launchMs = parseLaunchMs(started);

	let firstScreenMs: number | null = null;
	while (firstScreenMs === null && Date.now() < launched + windowMs) {
		try {
			const tree = await dumpUi(serial, { attempts: 1, timeoutMs: 8000 });
			const elapsed = Date.now() - launched;
			if (isHomeScreen(tree) && elapsed <= windowMs) firstScreenMs = elapsed;
		} catch {
			// The window is not there yet, or the app is not idle: look again until the time is up.
		}
		if (firstScreenMs === null) await sleep(400);
	}
	// The window is held to its end whenever the screen came early: a crash right after the first screen is a crash of the start.
	await sleep(Math.max(0, launched + windowMs - Date.now()));
	const alive = (await shell(serial, `pidof ${productPackage}`)).stdout.trim().length > 0;
	const logcat = await dumpLogcat(serial);
	await forceStop(serial, productPackage);

	const logPath = join(runsDir, `product-${slug(serial)}-${stamp(startedAt)}.log`);
	await writeFile(logPath, logcat);
	const { fatals, jsErrors } = productFatals(logcat, alive);
	const file: ProductFile = {
		schema: 1,
		kind: "product",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		windowMs,
		firstScreen: { reached: firstScreenMs !== null, atMs: firstScreenMs },
		alive,
		fatals,
		jsErrorCount: jsErrors,
		launchMs,
		durationMs: Date.now() - launched,
		logFile: logPath.slice(qaDir.length + 1),
	};
	for (const line of describeProduct(file)) console.log(line);
	const name = await writeRun("product", serial, startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
	const problems = productProblems(file);
	if (problems.length === 0) {
		console.log("product boot: pass");
		return;
	}
	console.log("product boot: FAIL");
	for (const problem of problems) console.log(`  ${problem}`);
	process.exitCode = 1;
}
