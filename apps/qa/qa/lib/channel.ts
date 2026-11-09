import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { androidDir, outDir } from "./paths.ts";

/**
 * The EAS Update channel of a QA build. Only QA channels are accepted: `qa`, or `qa-` plus a suffix. The harness publishes to the channel
 * it is given, so `preview`, `production` and anything else that is not named like a QA channel is refused before anything is built or
 * published.
 */
export function qaChannel(value: string | boolean | undefined, flag = "updates-channel"): string | null {
	if (value === undefined) return null;
	if (typeof value !== "string" || !/^qa(-[a-z0-9]+)*$/.test(value))
		throw new Error(
			`--${flag} must name a QA channel (qa, or qa- and a suffix), not ${JSON.stringify(value)}: the harness never builds for or publishes to preview or production`,
		);
	return value;
}

/** Where a build for a channel is kept: the plain QA build owns `qa/out`, so a channel build never replaces it. */
export function channelOutDir(channel: string | null, base: string = outDir): string {
	return channel === null ? base : join(base, `channel-${channel}`);
}

const markerFile = ".native-qa-updates-channel";

/** The channel `apps/qa/android` was generated for; "" when it was generated without one (or before the harness recorded it). */
export async function generatedChannel(directory: string = androidDir): Promise<string> {
	try {
		return (await readFile(join(directory, markerFile), "utf8")).trim();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}

export async function recordGeneratedChannel(channel: string | null, directory: string = androidDir): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, markerFile), `${channel ?? ""}\n`);
}

/**
 * Why `expo prebuild` has to run again for a build with `channel`, or null: the channel is read from the app config when the project is
 * generated (it ends up in AndroidManifest.xml), and a change of environment does not touch any file `prebuild` is compared against.
 */
export function channelPrebuildReason(generated: string, channel: string | null): string | null {
	const wanted = channel ?? "";
	if (generated === wanted) return null;
	return generated === ""
		? `the generated project has no updates channel and this build is for ${wanted}`
		: wanted === ""
			? `the generated project is for the ${generated} channel and this build has none`
			: `the generated project is for the ${generated} channel and this build is for ${wanted}`;
}
