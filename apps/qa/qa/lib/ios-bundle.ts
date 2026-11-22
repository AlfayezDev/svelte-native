import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./exec.ts";
import { outDir, platformDir, expoSvelteCli } from "./paths.ts";
import { appVariantOf, type Variant } from "./variant.ts";

/**
 * The modules of the iPhone build's JavaScript. Xcode's bundle phase keeps no source map, and the Android build gets one from React Native's Gradle plugin; the `foreign`
 * run's check that the libraries' own JavaScript is not in the release bundle needs the module list, so `build --platform ios` has Metro make the bundle of the same tree
 * on the PC (`expo export:embed --platform ios`, release settings, the way `qa/test/bundle.test.ts` makes Android's) and keeps its map next to the build record.
 * The map is Metro's graph of the tree the Mac was given; Hermes compiles that bundle, it does not change which modules are in it.
 */

export type IosBundleMap = { path: string; sizeBytes: number; sha256: string; sources: number };

export function iosBundleMapPath(variant: Variant): string {
	return join(outDir, variant === "qa" ? "ios-bundle.map" : `ios-bundle-${variant}.map`);
}

/** Metro's source map of the iOS bundle of [variant], made in a scratch directory and kept at [iosBundleMapPath]. */
export async function makeIosBundleMap(variant: Variant): Promise<IosBundleMap> {
	const scratch = await mkdtemp(join(tmpdir(), "native-qa-ios-bundle-"));
	try {
		const env = { APP_VARIANT: appVariantOf[variant], CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production", TMPDIR: join(scratch, "metro") };
		await mkdir(env.TMPDIR, { recursive: true });
		const synced = await exec("node", [expoSvelteCli, "sync"], { cwd: platformDir, env, timeoutMs: 300_000 });
		if (synced.code !== 0) throw new Error(`expo-svelte sync failed (${synced.code}): ${synced.stderr.trim().slice(-400)}`);
		const bundle = join(scratch, "main.jsbundle");
		const map = join(scratch, "main.jsbundle.map");
		const made = await exec(
			"pnpm",
			["exec", "expo", "export:embed", "--platform", "ios", "--dev", "false", "--minify", "false", "--reset-cache", "--entry-file", ".expo-svelte/entry.ts", "--bundle-output", bundle, "--sourcemap-output", map, "--assets-dest", join(scratch, "assets")],
			{ cwd: platformDir, env, timeoutMs: 1_200_000 },
		);
		if (made.code !== 0) throw new Error(`expo export:embed (ios, ${variant}) failed (${made.code}): ${(made.stderr || made.stdout).trim().slice(-600)}`);
		const text = await readFile(map);
		const sources = (JSON.parse(text.toString("utf8")) as { sources?: unknown }).sources;
		if (!Array.isArray(sources) || sources.length === 0) throw new Error("the iOS bundle's source map lists no module");
		await mkdir(outDir, { recursive: true });
		const target = iosBundleMapPath(variant);
		await writeFile(target, text);
		return { path: target, sizeBytes: (await stat(target)).size, sha256: createHash("sha256").update(text).digest("hex"), sources: sources.length };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
