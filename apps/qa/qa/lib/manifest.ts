import { existsSync } from "node:fs";
import { join } from "node:path";

/** The updates configuration of an Android manifest, as Expo's config plugin writes it (`expo.modules.updates.*` meta-data). */
export type ManifestUpdates = {
	enabled: string | null;
	checkOnLaunch: string | null;
	updateUrl: string | null;
	/** The request headers meta-data, parsed; null when the build has none. */
	requestHeaders: Record<string, string> | null;
};

const entities: Record<string, string> = { "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&apos;": "'" };
const decode = (text: string) => text.replace(/&(?:quot|amp|lt|gt|apos);/g, (entity) => entities[entity] ?? entity);

export function parseManifestUpdates(xml: string): ManifestUpdates {
	const value = (key: string): string | null => {
		for (const match of xml.matchAll(/<meta-data\b[^>]*>/g)) {
			const tag = match[0];
			if (new RegExp(`android:name="expo\\.modules\\.updates\\.${key}"`).test(tag)) {
				const given = /android:value="([^"]*)"/.exec(tag)?.[1];
				return given === undefined ? null : decode(given);
			}
		}
		return null;
	};
	const headers = value("UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY");
	let requestHeaders: Record<string, string> | null = null;
	if (headers !== null) {
		try {
			requestHeaders = JSON.parse(headers) as Record<string, string>;
		} catch {
			throw new Error(`the request headers meta-data is not JSON: ${headers.slice(0, 120)}`);
		}
	}
	return { enabled: value("ENABLED"), checkOnLaunch: value("EXPO_UPDATES_CHECK_ON_LAUNCH"), updateUrl: value("EXPO_UPDATE_URL"), requestHeaders };
}

/**
 * The build must be what was asked for, in both directions: a build for a channel checks on launch and sends that channel in its request
 * headers (and nothing else); a build for none never checks and sends no channel. A mismatch is an error, because a plain build that
 * checks would make the boot gates measure update checks, and a channel build that does not would run a scenario it cannot pass.
 */
export function assertManifestMatches(config: ManifestUpdates, channel: string | null): void {
	const headers = config.requestHeaders ?? {};
	const sent = Object.keys(headers);
	if (channel === null) {
		if (config.checkOnLaunch !== "NEVER") throw new Error(`a plain QA build must not check for updates, but its merged manifest has EXPO_UPDATES_CHECK_ON_LAUNCH=${config.checkOnLaunch ?? "(absent)"}`);
		if (sent.length > 0) throw new Error(`a plain QA build must not name a channel, but its merged manifest sends ${JSON.stringify(headers)}`);
		return;
	}
	if (config.checkOnLaunch !== "ALWAYS") throw new Error(`a build for the ${channel} channel must check on launch, but its merged manifest has EXPO_UPDATES_CHECK_ON_LAUNCH=${config.checkOnLaunch ?? "(absent)"}`);
	if (headers["expo-channel-name"] !== channel || sent.length !== 1)
		throw new Error(`a build for the ${channel} channel must send exactly expo-channel-name=${channel}, but its merged manifest sends ${JSON.stringify(config.requestHeaders)}`);
}

/** Where Gradle puts the merged manifest of the release variant (the path differs between Android Gradle plugin versions). */
export function mergedManifestPath(androidDir: string): string {
	const candidates = [
		"app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
		"app/build/intermediates/merged_manifests/release/AndroidManifest.xml",
		"app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml",
	].map((path) => join(androidDir, path));
	const found = candidates.find(existsSync);
	if (!found) throw new Error(`no merged manifest of the release variant under ${androidDir} (looked for ${candidates.map((path) => path.slice(androidDir.length + 1)).join(", ")})`);
	return found;
}
