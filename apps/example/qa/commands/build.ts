import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describeApk } from "../lib/app.ts";
import { execToFile } from "../lib/exec.ts";
import { flagString, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { reexecUnderLock } from "../lib/lock.ts";
import {
	androidDir,
	gradleLock,
	outDir,
	platformDir,
	repoRoot,
	svelteNativeCli,
} from "../lib/paths.ts";
import { writeBuild } from "../lib/runs.ts";
import type { BuildFile } from "../lib/types.ts";
import { iosBuild } from "./ios-build.ts";

const abis = ["x86_64", "arm64-v8a"];
const buildEnv = {
	CI: "1",
	EXPO_NO_TELEMETRY: "1",
	EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com",
	// This is the QA build: an APP_VARIANT=production in the shell must not turn it into the product (its autolinking leaves the
	// smoke test's libraries out), and nothing of the build uploads to Sentry (its Expo plugin, which adds the upload step, is not applied).
	APP_VARIANT: "",
	SENTRY_DISABLE_AUTO_UPLOAD: "true",
};
/** What `expo prebuild` was run for: written next to the generated project, so a prebuild of the product is not mistaken for the QA one. */
const variantMarker = join(androidDir, ".native-qa-variant");
const variantName = "qa";
/** The Samsung Pay SDK of the smoke test's `expo-samsung-pay`: proprietary, kept out of git, copied from the production app's `libs/`. */
const samsungPayJar = join(platformDir, "libs/samsungpay.jar");
const gradleJvm = "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g";

async function modifiedTime(path: string): Promise<number | null> {
	try {
		return (await stat(path)).mtimeMs;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

/** Why `expo prebuild` has to run again, or null when the generated android/ project is current. */
async function prebuildReason(): Promise<string | null> {
	const generated = await modifiedTime(join(androidDir, "app/build.gradle"));
	if (generated === null) return "apps/platform/android is missing";
	const marker = await readFile(variantMarker, "utf8").catch(() => null);
	if (marker?.trim() !== variantName)
		return `android/ was generated for ${marker === null ? "an unknown variant" : `the ${marker.trim()} variant`}, not ${variantName}`;
	const inputs = [
		join(platformDir, "app.config.ts"),
		join(platformDir, "package.json"),
		join(platformDir, "react-native.config.js"),
		join(platformDir, "qa/smoke-modules.json"),
		join(platformDir, "qa/firebase-fake/google-services.json"),
		join(repoRoot, "packages/svelte-native/src/expo.ts"),
	];
	for (const module of await readdir(join(platformDir, "modules")))
		inputs.push(join(platformDir, "modules", module, "expo-module.config.json"));
	for (const input of inputs) {
		const changed = await modifiedTime(input);
		if (changed !== null && changed > generated)
			return `${input.slice(repoRoot.length + 1)} is newer than android/app/build.gradle`;
	}
	return null;
}

/** Our own native code: the engine, and Reanimated with the engine's write sink. The rest of the native libraries are React Native's and Hermes's, symbolized from their own packages. */
const symbolLibraries = ["libsvelteengine.so", "libreanimated.so"];

/**
 * What `soak/symbolicate.ts` needs to read a release crash, kept next to the APK: the composed source map of the Hermes
 * bytecode bundle (React Native's Gradle plugin writes it at `build/generated/sourcemaps/react/release`, composing
 * Metro's map with Hermes's), and the unstripped native libraries from before Gradle's strip step.
 */
async function keepDebugArtifacts(abi: string): Promise<Pick<BuildFile, "sourceMap" | "symbols">> {
	const mapSource = join(
		androidDir,
		"app/build/generated/sourcemaps/react/release/index.android.bundle.map",
	);
	const mapTarget = join(outDir, `app-${abi}.bundle.map`);
	if ((await modifiedTime(mapSource)) === null)
		throw new Error(
			`the release build left no source map at ${mapSource}; the React Native Gradle plugin writes it with the Hermes bundle`,
		);
	await copyFile(mapSource, mapTarget);
	const symbolsDir = join(outDir, `app-${abi}.symbols`);
	await rm(symbolsDir, { recursive: true, force: true });
	await mkdir(symbolsDir, { recursive: true });
	const libs = join(
		androidDir,
		"app/build/intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out/lib",
		abi,
	);
	for (const library of symbolLibraries) {
		if ((await modifiedTime(join(libs, library))) === null)
			throw new Error(`no unstripped ${library} for ${abi} in ${libs}`);
		await copyFile(join(libs, library), join(symbolsDir, library));
	}
	const sourceMap = await describeApk(mapTarget);
	return {
		sourceMap: { path: mapTarget, sizeBytes: sourceMap.sizeBytes, sha256: sourceMap.sha256 },
		symbols: { dir: symbolsDir, files: symbolLibraries },
	};
}

async function step(
	title: string,
	command: string,
	args: string[],
	cwd: string,
	logPath: string,
): Promise<void> {
	console.log(`== ${title}`);
	const code = await execToFile(command, args, logPath, { cwd, env: buildEnv });
	if (code !== 0) throw new Error(`${title} failed with exit code ${code}; see ${logPath}`);
}

export async function build(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosBuild(argv);
	const { values } = parseFlags(argv, { abi: { type: "string" }, prebuild: { type: "boolean" } });
	const abi = flagString(values.abi) ?? "x86_64";
	if (!abis.includes(abi)) throw new Error(`--abi must be one of ${abis.join(", ")}`);
	reexecUnderLock(gradleLock, ["build", ...argv]);

	await mkdir(outDir, { recursive: true });
	const logPath = join(outDir, `build-${abi}.log`);
	await rm(logPath, { force: true });
	const started = Date.now();

	await step(
		"svelte-native sync",
		process.execPath,
		[svelteNativeCli, "sync"],
		platformDir,
		logPath,
	);
	if ((await modifiedTime(samsungPayJar)) === null)
		throw new Error(
			`${samsungPayJar} is missing: expo-samsung-pay (native module smoke test) does not compile without the Samsung Pay SDK. Copy libs/samsungpay.jar from the production app (it is proprietary and ignored by git).`,
		);
	const reason = values.prebuild ? "--prebuild" : await prebuildReason();
	if (reason) {
		console.log(`prebuild: ${reason}`);
		await step(
			"expo prebuild (android)",
			"pnpm",
			["exec", "expo", "prebuild", "--platform", "android", "--no-install"],
			platformDir,
			logPath,
		);
		await writeFile(variantMarker, `${variantName}\n`);
	}
	await step(
		`gradle assembleRelease (${abi})`,
		join(androidDir, "gradlew"),
		[":app:assembleRelease", `-PreactNativeArchitectures=${abi}`, "--console=plain", gradleJvm],
		androidDir,
		logPath,
	);

	const built = join(androidDir, "app/build/outputs/apk/release/app-release.apk");
	const target = join(outDir, `app-${abi}.apk`);
	await copyFile(built, target);
	const apk = await describeApk(target);
	const debug = await keepDebugArtifacts(abi);
	await writeBuild({
		schema: 1,
		kind: "build",
		abi,
		finishedAt: new Date().toISOString(),
		durationMs: Date.now() - started,
		prebuilt: reason !== null,
		source: await currentSource(),
		apk,
		...debug,
		logFile: `out/build-${abi}.log`,
	});
	console.log(
		`built ${target} (${(apk.sizeBytes / 1e6).toFixed(1)} MB, sha256 ${apk.sha256.slice(0, 12)}) in ${((Date.now() - started) / 1000).toFixed(0)} s`,
	);
}
