import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec, shellQuote } from "../lib/exec.ts";
import { flagString, parseFlags, requireString } from "../lib/flags.ts";
import { macFrom, remote, remoteOk } from "../lib/iphone/mac.ts";
import { currentSource, iosBuildPathOf, writeIosBuild } from "../lib/iphone/session.ts";
import { outDir, qaDir, repoRoot } from "../lib/paths.ts";
import { iosPrebuildLines } from "../lib/ios-project.ts";
import { appVariantOf, variantFlag } from "../lib/variant.ts";
import { sleep } from "../lib/wait.ts";

/**
 * The signed iOS build, made the one way the owner allows: the code is copied to the Mac checkout, prebuilt, and built by the
 * GUI Terminal (`open -a Terminal <script>`), because signing needs the login keychain of the logged-in user. The script and its
 * `.log` and `.exit` files are the ones fixed in the Mac recipe; this command never signs, never touches another directory and
 * does not change a setting of the Mac or the phone.
 */

const defaultScript = "/tmp/rasheed-ios-lab-20261025.command";
/**
 * The smoke app (`--variant smoke`) is another Xcode project (Expo names it from the display name, `Sveltesmoke`) with its own GUI
 * Terminal script, made like the lab one for that project; the lab script builds `RasheedSvelteQA` and cannot be reused.
 */
const defaultSmokeScript = "/tmp/rasheed-ios-smoke.command";
const productNames = { qa: "RasheedSvelteQA", smoke: "Sveltesmoke" } as const;
const smokeBundleMarker = "RNFBAppModule";
// DerivedData is the signed build's own cache on the Mac: `--delete` would wipe it and make every build a full ~6 min rebuild.
const excludes = ["DerivedData", "node_modules", ".git", "apps/platform/android/", "apps/platform/ios/", "build", "dist", ".svelte-kit", ".svelte-native", ".rasheed", ".env", ".expo", "*.log"];
const buildWaitMs = 30 * 60_000;

export async function iosBuild(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		platform: { type: "string" },
		mac: { type: "string" },
		"mac-checkout": { type: "string" },
		"build-script": { type: "string" },
		variant: { type: "string" },
	});
	const variant = variantFlag(values.variant);
	const mac = macFrom(flagString(values.mac));
	const checkout = requireString(values["mac-checkout"] ?? process.env.NATIVE_QA_MAC_CHECKOUT, "mac-checkout");
	const script = flagString(values["build-script"]) ?? (variant === "smoke" ? defaultSmokeScript : defaultScript);
	const done = script.replace(/\.command$/, ".exit");
	const buildLog = script.replace(/\.command$/, ".log");
	const began = Date.now();
	await mkdir(outDir, { recursive: true });
	const logFile = join(outDir, variant === "smoke" ? "ios-build-smoke.log" : "ios-build.log");
	const log: string[] = [];
	const note = (line: string) => {
		console.log(line);
		log.push(line);
	};

	note(`copying ${repoRoot} to ${mac.target}:${checkout}`);
	const synced = await exec(
		"rsync",
		["-rlpc", "--delete", "-e", "ssh -o BatchMode=yes", ...excludes.flatMap((pattern) => ["--exclude", pattern]), "--stats", `${repoRoot}/`, `${mac.target}:${checkout}/`],
		{ timeoutMs: 600_000 },
	);
	if (synced.code !== 0) throw new Error(`rsync exited with ${synced.code}: ${synced.stderr.trim().slice(0, 400)}`);
	note(`  ${/Number of regular files transferred: (\d+)/.exec(synced.stdout)?.[1] ?? "?"} files changed`);
	await remoteOk(mac, `ls ${shellQuote(script)} > /dev/null`);

	note("installing the dependencies, running expo prebuild and pod install on the Mac");
	const prepared = await remote(
		mac,
		[
			"set -o pipefail",
			`cd ${shellQuote(checkout)}`,
			"pnpm install --frozen-lockfile --ignore-scripts --prefer-offline 2>&1 | tail -n 1",
			"cd apps/platform",
			`export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH LANG=en_US.UTF-8 CI=1 EXPO_NO_TELEMETRY=1 APP_VARIANT=${appVariantOf[variant]}`,
			...iosPrebuildLines(variant, "/tmp/native-qa-prebuild.log"),
			"(cd ios && pod install > /tmp/native-qa-pods.log 2>&1) || { tail -n 20 /tmp/native-qa-pods.log; exit 1; }",
			"node ../../packages/svelte-native/src/cli.ts sync",
			`rm -f ${shellQuote(done)}`,
			`open -a Terminal ${shellQuote(script)}`,
		].join(" && "),
		{ timeoutMs: 1_500_000 },
	);
	if (prepared.code !== 0) throw new Error(`preparing the Mac build failed (${prepared.code}): ${(prepared.stdout + prepared.stderr).trim().slice(-800)}`);
	note("the build runs in the GUI Terminal; waiting for it to finish");

	let exitCode: string | null = null;
	while (Date.now() - began < buildWaitMs) {
		await sleep(20_000);
		const result = await remote(mac, `cat ${shellQuote(done)} 2>/dev/null`);
		if (/^\d+$/.test(result.stdout.trim())) {
			exitCode = result.stdout.trim();
			break;
		}
	}
	if (exitCode === null) throw new Error(`the build did not finish within ${buildWaitMs / 60_000} minutes (${buildLog} on the Mac)`);
	const tail = await remote(mac, `grep -E 'BUILD SUCCEEDED|BUILD FAILED|error:' ${shellQuote(buildLog)} | tail -n 5`);
	note(`build exit ${exitCode}: ${tail.stdout.trim().replaceAll("\n", " | ")}`);
	if (exitCode !== "0") throw new Error(`the signed build failed (exit ${exitCode}); see ${buildLog} on the Mac`);

	const app = `${checkout}/DerivedData/Build/Products/Release-iphoneos/${productNames[variant]}.app`;
	const digest = (await remoteOk(mac, `shasum -a 256 ${shellQuote(`${app}/main.jsbundle`)} && stat -f %z ${shellQuote(`${app}/main.jsbundle`)}`)).trim().split("\n");
	const sha = /^([0-9a-f]{64})/.exec(digest[0] ?? "")?.[1];
	if (!sha) throw new Error(`cannot read the bundle's digest: ${digest.join(" ")}`);
	// Xcode's bundle phase reads `APP_VARIANT` from the environment of the GUI Terminal script, not of this command. A smoke build whose script
	// lacks `export APP_VARIANT=smoke` is the QA app's JavaScript in the smoke app (the same main.jsbundle, none of the smoke libraries), and the
	// smoke run would only fail much later. `RNFBAppModule` is a string of React Native Firebase's JavaScript, a smoke-only library.
	const withSmokeLibraries = Number((await remoteOk(mac, `{ strings -a ${shellQuote(`${app}/main.jsbundle`)} | grep -c ${smokeBundleMarker}; } || true`)).trim().split("\n").pop());
	if ((variant === "smoke") !== withSmokeLibraries > 0)
		throw new Error(`${productNames[variant]}'s main.jsbundle ${withSmokeLibraries > 0 ? "carries" : "lacks"} the smoke libraries (${smokeBundleMarker}): the build script ${script} ${variant === "smoke" ? "must export APP_VARIANT=smoke" : "must not export APP_VARIANT"}`);
	// The code directory hash of the signed executable: what the app reads from its own signature (`SvelteQA.buildIdentity`).
	const signature = (await remoteOk(mac, `codesign -dvvv ${shellQuote(app)} 2>&1`)).trim();
	const cdHash = /^CDHash=([0-9a-f]{40})$/m.exec(signature)?.[1];
	if (!cdHash) throw new Error(`cannot read the app's CDHash from codesign: ${signature.split("\n").slice(-3).join(" ")}`);
	await remote(mac, `cd ${shellQuote(`${checkout}/apps/platform`)} && node ../../packages/svelte-native/src/cli.ts sync > /dev/null 2>&1`);
	await writeFile(logFile, `${log.join("\n")}\n`);
	await writeIosBuild({
		schema: 1,
		kind: "ios-build",
		finishedAt: new Date().toISOString(),
		durationMs: Date.now() - began,
		source: await currentSource(),
		macCheckout: checkout,
		appPath: app,
		bundleSha256: sha,
		jsbundleSha256: sha,
		cdHash,
		bundleBytes: Number(digest[1] ?? 0),
		logFile: logFile.slice(qaDir.length + 1),
	}, variant);
	note(`wrote ${iosBuildPathOf(variant).slice(qaDir.length + 1)} (main.jsbundle ${sha.slice(0, 12)}, CDHash ${cdHash.slice(0, 12)}, ${Math.round((Date.now() - began) / 1000)} s)`);
}
