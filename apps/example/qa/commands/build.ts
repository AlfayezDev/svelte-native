import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describeApk } from "../lib/app.ts";
import {
	channelOutDir,
	channelPrebuildReason,
	generatedChannel,
	qaChannel,
	recordGeneratedChannel,
} from "../lib/channel.ts";
import { execToFile } from "../lib/exec.ts";
import { flagString, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { reexecUnderLock } from "../lib/lock.ts";
import {
	androidDir,
	gradleLock,
	platformDir,
	qaDir,
	repoRoot,
	svelteNativeCli,
} from "../lib/paths.ts";
import { writeBuild } from "../lib/runs.ts";
import type { BuildFile } from "../lib/types.ts";
import { iosBuild } from "./ios-build.ts";

const abis = ["x86_64", "arm64-v8a"];
/**
 * `UPDATES_CHANNEL` is always set, empty for a plain QA build: app.config.ts then turns update checks off, whatever the calling shell
 * exports. A build for a channel is the only one that checks for updates on launch.
 */
const buildEnv = (channel: string | null) => ({
	CI: "1",
	EXPO_NO_TELEMETRY: "1",
	EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com",
	UPDATES_CHANNEL: channel ?? "",
});
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
async function prebuildReason(channel: string | null): Promise<string | null> {
	const generated = await modifiedTime(join(androidDir, "app/build.gradle"));
	if (generated === null) return "apps/platform/android is missing";
	const channelReason = channelPrebuildReason(await generatedChannel(), channel);
	if (channelReason) return channelReason;
	const inputs = [
		join(platformDir, "app.config.ts"),
		join(platformDir, "package.json"),
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
async function keepDebugArtifacts(abi: string, outDir: string): Promise<Pick<BuildFile, "sourceMap" | "symbols">> {
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
	env: Record<string, string>,
): Promise<void> {
	console.log(`== ${title}`);
	const code = await execToFile(command, args, logPath, { cwd, env });
	if (code !== 0) throw new Error(`${title} failed with exit code ${code}; see ${logPath}`);
}

export async function build(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosBuild(argv);
	const { values } = parseFlags(argv, {
		abi: { type: "string" },
		prebuild: { type: "boolean" },
		"updates-channel": { type: "string" },
	});
	const abi = flagString(values.abi) ?? "x86_64";
	if (!abis.includes(abi)) throw new Error(`--abi must be one of ${abis.join(", ")}`);
	const channel = qaChannel(values["updates-channel"]);
	reexecUnderLock(gradleLock, ["build", ...argv]);

	// A build for a channel is kept apart (qa/out/channel-<channel>), so the plain QA build the gates measure is never replaced by it.
	const outDir = channelOutDir(channel);
	const env = buildEnv(channel);
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
		env,
	);
	const reason = values.prebuild ? "--prebuild" : await prebuildReason(channel);
	if (reason) {
		console.log(`prebuild: ${reason}`);
		await step(
			"expo prebuild (android)",
			"pnpm",
			["exec", "expo", "prebuild", "--platform", "android", "--no-install"],
			platformDir,
			logPath,
			env,
		);
		await recordGeneratedChannel(channel);
	}
	await step(
		`gradle assembleRelease (${abi})`,
		join(androidDir, "gradlew"),
		[":app:assembleRelease", `-PreactNativeArchitectures=${abi}`, "--console=plain", gradleJvm],
		androidDir,
		logPath,
		env,
	);

	const built = join(androidDir, "app/build/outputs/apk/release/app-release.apk");
	const target = join(outDir, `app-${abi}.apk`);
	await copyFile(built, target);
	const apk = await describeApk(target);
	const debug = await keepDebugArtifacts(abi, outDir);
	await writeBuild(
		{
			schema: 1,
			kind: "build",
			abi,
			finishedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
			prebuilt: reason !== null,
			...(channel ? { updatesChannel: channel } : {}),
			source: await currentSource(),
			apk,
			...debug,
			logFile: relative(qaDir, logPath),
		},
		outDir,
	);
	console.log(
		`built ${target}${channel ? ` for the ${channel} channel` : ""} (${(apk.sizeBytes / 1e6).toFixed(1)} MB, sha256 ${apk.sha256.slice(0, 12)}) in ${((Date.now() - started) / 1000).toFixed(0)} s`,
	);
}
