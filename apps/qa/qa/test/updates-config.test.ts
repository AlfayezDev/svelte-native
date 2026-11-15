import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The QA app's over-the-air update settings (`app.config.ts`, `eas.json`): moved here from the package's tests, which are about the library, not about this app.
const app = join(import.meta.dirname, "../..");

describe("build configuration", () => {
	// The config reads the channel when it is evaluated, so each case evaluates it in its own process.
	const load = (channel: string | undefined) => {
		const env = { ...process.env };
		delete env.UPDATES_CHANNEL;
		if (channel !== undefined) env.UPDATES_CHANNEL = channel;
		const evaluated = Bun.spawnSync([process.execPath, "-e", `import(${JSON.stringify(pathToFileURL(join(app, "app.config.ts")).href)}).then((module) => console.log(JSON.stringify(module.default)))`], { env });
		return JSON.parse(evaluated.stdout.toString()) as { runtimeVersion: unknown; updates: Record<string, unknown> };
	};
	test("app.config points at the project's EAS Update URL with an app-version runtime policy", () => {
		const config = load("production");
		expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
		expect(config.updates).toEqual({
			url: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
			checkAutomatically: "ON_LOAD",
			fallbackToCacheTimeout: 0,
			requestHeaders: { "expo-channel-name": "production" },
		});
	});
	test("a build without a channel (a local build, or `eas update` reading the config) sends no channel and does not check", () => {
		const config = load(undefined);
		expect(config.updates.url).toBe("https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0");
		expect(config.updates.checkAutomatically).toBe("NEVER");
		expect(config.updates.requestHeaders).toBeUndefined();
	});
	test("each store-bound profile has a channel, and the config reads the same one", () => {
		const eas = JSON.parse(readFileSync(join(app, "eas.json"), "utf8")) as { build: Record<string, { channel?: string; env?: Record<string, string> }> };
		for (const profile of ["preview", "production"]) {
			expect(eas.build[profile]?.channel).toBe(profile);
			expect(eas.build[profile]?.env?.UPDATES_CHANNEL).toBe(profile);
		}
		expect(eas.build.development?.channel).toBeUndefined();
	});
});
