import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
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
import { assertManifestMatches, mergedManifestPath, parseManifestUpdates } from "../lib/manifest.ts";
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
import { prebuildProject, selectVariantProject, staleReason } from "../lib/project.ts";
import { writeBuild } from "../lib/runs.ts";
import { apkPath, appVariantOf, buildLogName, packageOf, stemOf, variantFlag, type Variant } from "../lib/variant.ts";
import type { BuildFile } from "../lib/types.ts";
import { iosBuild } from "./ios-build.ts";

const abis = ["x86_64", "arm64-v8a"];
/**
 * The environment of a build. The variant is set explicitly, so an `APP_VARIANT` in the shell cannot turn one app into another.
 * `UPDATES_CHANNEL` is always set, empty for a build without a channel: app.config.ts then turns update checks off, whatever the calling
 * shell exports. A build for a channel (the QA app only) is the only one that checks for updates on launch.
 */
export function buildEnv(variant: Variant, channel: string | null = null): Record<string, string> {
	return {
		CI: "1",
		EXPO_NO_TELEMETRY: "1",
		APP_VARIANT: appVariantOf[variant],
		// The product reads its Maps key from the environment (an EAS secret) and the Maps SDK throws at the first map when the manifest has
		// none. This build is only ever started on the OVH emulator for the boot check and shows no map, so it gets the placeholder the QA app has.
		...(variant === "production" ? { GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "svelte-qa-placeholder-key" } : {}),
		UPDATES_CHANNEL: channel ?? "",
		// Nothing of a build uploads to Sentry (its Expo plugin, which adds the upload step, is not applied).
		SENTRY_DISABLE_AUTO_UPLOAD: "true",
	};
}
const gradleJvm = "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g";

async function modifiedTime(path: string): Promise<number | null> {
	try {
		return (await stat(path)).mtimeMs;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

/** Everything that changes what `expo prebuild` generates: the Expo config and what it reads (the smoke modules and packages, the Firebase files), the packages, the Svelte native plugin and the local modules. */
export async function prebuildInputs(): Promise<string[]> {
	const inputs = [
		join(platformDir, "app.config.ts"),
		join(platformDir, "package.json"),
		join(platformDir, "react-native.config.js"),
		join(platformDir, "qa/smoke-modules.json"),
		join(platformDir, "qa/smoke-packages.cjs"),
		join(platformDir, "qa/firebase-fake/google-services.json"),
		join(repoRoot, "packages/svelte-native/src/expo.ts"),
	];
	for (const module of await readdir(join(platformDir, "modules")))
		inputs.push(join(platformDir, "modules", module, "expo-module.config.json"));
	return inputs;
}

/**
 * Why `expo prebuild` has to run again, or null when the generated android/ project is current: an input is newer than it, or it was
 * generated for another updates channel (the channel is read from the app config when the project is generated, it ends up in
 * AndroidManifest.xml, and a change of environment touches no input).
 */
async function prebuildReason(channel: string | null): Promise<string | null> {
	return (await staleReason(join(androidDir, "app/build.gradle"), await prebuildInputs())) ?? channelPrebuildReason(await generatedChannel(), channel);
}

/** Our own native code: the engine, and Reanimated with the engine's write sink. The rest of the native libraries are React Native's and Hermes's, symbolized from their own packages. */
const symbolLibraries = ["libsvelteengine.so", "libreanimated.so"];

/**
 * What `soak/symbolicate.ts` needs to read a release crash, kept next to the APK: the composed source map of the Hermes
 * bytecode bundle (React Native's Gradle plugin writes it at `build/generated/sourcemaps/react/release`, composing
 * Metro's map with Hermes's), and the unstripped native libraries from before Gradle's strip step.
 */
async function keepDebugArtifacts(abi: string, variant: Variant, outDir: string): Promise<Pick<BuildFile, "sourceMap" | "symbols">> {
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
		variant: { type: "string" },
		"updates-channel": { type: "string" },
	});
	const abi = flagString(values.abi) ?? "x86_64";
	if (!abis.includes(abi)) throw new Error(`--abi must be one of ${abis.join(", ")}`);
	const variant = variantFlag(values.variant);
	const channel = qaChannel(values["updates-channel"]);
	// The update scenario runs in the QA app (`io.rasheed.svelteqa`, the one the channel's builds and `native-qa updates` are about); the smoke app never checks for updates.
	if (channel !== null && variant !== "qa") throw new Error(`--updates-channel builds the QA app, not the ${variant} app`);
	await reexecUnderLock(gradleLock, ["build", ...argv]);

	// A build for a channel is kept apart (qa/out/channel-<channel>), so the plain QA build the gates measure is never replaced by it.
	const outDir = channelOutDir(channel);
	const env = buildEnv(variant, channel);
	await mkdir(outDir, { recursive: true });
	const logPath = join(outDir, buildLogName(variant, abi));
	await rm(logPath, { force: true });
	const started = Date.now();
	console.log(`building the ${variant} app (${packageOf[variant]})${variant === "production" ? " for the product boot check (native-qa product); never for a phone" : ""}`);

	await step("svelte-native sync", process.execPath, [svelteNativeCli, "sync"], platformDir, logPath, env);
	const switched = await selectVariantProject(variant, androidDir);
	const reason = values.prebuild ? "--prebuild" : (switched ?? (await prebuildReason(channel)));
	if (reason) {
		console.log(`prebuild: ${reason}`);
		// The channel is written down inside the prebuild, so a project is only ever finished together with the channel it was generated for.
		await prebuildProject(variant, androidDir, async () => {
			await step(
				`expo prebuild (android, ${variant})`,
				"pnpm",
				["exec", "expo", "prebuild", "--platform", "android", "--no-install"],
				platformDir,
				logPath,
				env,
			);
			await recordGeneratedChannel(channel);
		});
	}
	await step(
		`gradle assembleRelease (${variant}, ${abi})`,
		join(androidDir, "gradlew"),
		[":app:assembleRelease", `-PreactNativeArchitectures=${abi}`, "--console=plain", gradleJvm],
		androidDir,
		logPath,
		env,
	);

	// What Gradle merged is what the APK carries: the build must be the one that was asked for, in both directions, or it fails here.
	assertManifestMatches(parseManifestUpdates(await readFile(mergedManifestPath(androidDir), "utf8")), channel);

	const built = join(androidDir, "app/build/outputs/apk/release/app-release.apk");
	const target = apkPath(variant, abi, outDir);
	await copyFile(built, target);
	const apk = await describeApk(target);
	const debug = await keepDebugArtifacts(abi, variant, outDir);
	await writeBuild(
		{
			schema: 1,
			kind: "build",
			variant,
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
