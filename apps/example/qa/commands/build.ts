import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
import { apkPath, appVariantOf, buildLogName, packageOf, stemOf, variantFlag, type Variant } from "../lib/variant.ts";
import type { BuildFile } from "../lib/types.ts";
import { iosBuild } from "./ios-build.ts";

const abis = ["x86_64", "arm64-v8a"];
/** The environment of a build. The variant is set explicitly, so an `APP_VARIANT` in the shell cannot turn one app into another. */
function buildEnv(variant: Variant): Record<string, string> {
	return {
		CI: "1",
		EXPO_NO_TELEMETRY: "1",
		EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com",
		APP_VARIANT: appVariantOf[variant],
		// Nothing of a build uploads to Sentry (its Expo plugin, which adds the upload step, is not applied).
		SENTRY_DISABLE_AUTO_UPLOAD: "true",
	};
}
const gradleJvm = "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g";
/**
 * What `expo prebuild` was run for is written next to the generated project. `android/` holds one variant at a time; the other is
 * parked as `android-<variant>/` (its Gradle outputs with it), so switching between the QA and the smoke app renames directories
 * instead of generating a project over the other's files.
 */
const variantMarker = join(androidDir, ".native-qa-variant");
/** The Samsung Pay SDK of the smoke app's `expo-samsung-pay`: proprietary, kept out of git, copied from the production app's `libs/`. Only the smoke build needs it. */
const samsungPayJar = join(platformDir, "libs/samsungpay.jar");

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

/** The variant the project in `dir` was generated for; null when there is none. A project made before variants existed is the QA app. */
export async function generatedFor(dir: string = androidDir): Promise<Variant | null> {
	if ((await modifiedTime(join(dir, "app/build.gradle"))) === null) return null;
	const marker = (await readFile(join(dir, ".native-qa-variant"), "utf8").catch(() => "qa")).trim();
	return marker === "smoke" ? "smoke" : "qa";
}

/**
 * Makes `dir` (`android/`) the variant's project: the one already there, or the one parked for it as `<dir>-<variant>` (the one in
 * the way is parked in its place), or none, in which case the reason to prebuild is returned.
 */
export async function selectVariantProject(variant: Variant, dir: string = androidDir): Promise<string | null> {
	const parked = (name: Variant) => `${dir}-${name}`;
	const current = await generatedFor(dir);
	if (current === variant) return null;
	if (current !== null) {
		await rm(parked(current), { recursive: true, force: true });
		await rename(dir, parked(current));
	}
	if ((await modifiedTime(parked(variant))) !== null) {
		await rename(parked(variant), dir);
		return null;
	}
	return current === null ? `${dir} is missing` : `${dir} was generated for the ${current} app, and none is parked for ${variant}`;
}

/** Our own native code: the engine, and Reanimated with the engine's write sink. The rest of the native libraries are React Native's and Hermes's, symbolized from their own packages. */
const symbolLibraries = ["libsvelteengine.so", "libreanimated.so"];

/**
 * What `soak/symbolicate.ts` needs to read a release crash, kept next to the APK: the composed source map of the Hermes
 * bytecode bundle (React Native's Gradle plugin writes it at `build/generated/sourcemaps/react/release`, composing
 * Metro's map with Hermes's), and the unstripped native libraries from before Gradle's strip step.
 */
async function keepDebugArtifacts(abi: string, variant: Variant): Promise<Pick<BuildFile, "sourceMap" | "symbols">> {
	const mapSource = join(
		androidDir,
		"app/build/generated/sourcemaps/react/release/index.android.bundle.map",
	);
	const mapTarget = join(outDir, `app-${stemOf(variant, abi)}.bundle.map`);
	if ((await modifiedTime(mapSource)) === null)
		throw new Error(
			`the release build left no source map at ${mapSource}; the React Native Gradle plugin writes it with the Hermes bundle`,
		);
	await copyFile(mapSource, mapTarget);
	const symbolsDir = join(outDir, `app-${stemOf(variant, abi)}.symbols`);
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
	variant: Variant,
): Promise<void> {
	console.log(`== ${title}`);
	const code = await execToFile(command, args, logPath, { cwd, env: buildEnv(variant) });
	if (code !== 0) throw new Error(`${title} failed with exit code ${code}; see ${logPath}`);
}

export async function build(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosBuild(argv);
	const { values } = parseFlags(argv, { abi: { type: "string" }, prebuild: { type: "boolean" }, variant: { type: "string" } });
	const abi = flagString(values.abi) ?? "x86_64";
	if (!abis.includes(abi)) throw new Error(`--abi must be one of ${abis.join(", ")}`);
	const variant = variantFlag(values.variant);
	reexecUnderLock(gradleLock, ["build", ...argv]);

	await mkdir(outDir, { recursive: true });
	const logPath = join(outDir, buildLogName(variant, abi));
	await rm(logPath, { force: true });
	const started = Date.now();
	console.log(`building the ${variant} app (${packageOf[variant]})`);

	if (variant === "smoke" && (await modifiedTime(samsungPayJar)) === null)
		throw new Error(
			`${samsungPayJar} is missing: expo-samsung-pay (native module smoke test) does not compile without the Samsung Pay SDK. Copy libs/samsungpay.jar from the production app (it is proprietary and ignored by git).`,
		);
	await step("svelte-native sync", process.execPath, [svelteNativeCli, "sync"], platformDir, logPath, variant);
	const switched = await selectVariantProject(variant);
	const reason = values.prebuild ? "--prebuild" : (switched ?? (await prebuildReason()));
	if (reason) {
		console.log(`prebuild: ${reason}`);
		await step(
			`expo prebuild (android, ${variant})`,
			"pnpm",
			["exec", "expo", "prebuild", "--platform", "android", "--no-install"],
			platformDir,
			logPath,
			variant,
		);
		await writeFile(variantMarker, `${variant}\n`);
	}
	await step(
		`gradle assembleRelease (${variant}, ${abi})`,
		join(androidDir, "gradlew"),
		[":app:assembleRelease", `-PreactNativeArchitectures=${abi}`, "--console=plain", gradleJvm],
		androidDir,
		logPath,
		variant,
	);

	const built = join(androidDir, "app/build/outputs/apk/release/app-release.apk");
	const target = apkPath(variant, abi);
	await copyFile(built, target);
	const apk = await describeApk(target);
	const debug = await keepDebugArtifacts(abi, variant);
	await writeBuild({
		schema: 1,
		kind: "build",
		variant,
		abi,
		finishedAt: new Date().toISOString(),
		durationMs: Date.now() - started,
		prebuilt: reason !== null,
		source: await currentSource(),
		apk,
		...debug,
		logFile: `out/${buildLogName(variant, abi)}`,
	});
	console.log(
		`built ${target} (${(apk.sizeBytes / 1e6).toFixed(1)} MB, sha256 ${apk.sha256.slice(0, 12)}) in ${((Date.now() - started) / 1000).toFixed(0)} s`,
	);
}
