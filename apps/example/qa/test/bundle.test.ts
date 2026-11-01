import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platformDir, repoRoot } from "../lib/paths.ts";

/**
 * The JavaScript bundle of each app (SPEC.md, "Native modules (smoke test)"). The smoke test's libraries are in the smoke app only,
 * so Metro resolves them, and the smoke checks, to a stub in the product and the QA app: the bundle the JavaScript boot gate
 * measures must not carry thirty libraries it never calls. Bundled the way React Native's Gradle plugin does it (`expo export:embed`,
 * release, not minified: Hermes compiles it), without the Hermes step.
 */
const { smokeOnlyBundlePackages } = createRequire(import.meta.url)("../smoke-packages.cjs") as { smokeOnlyBundlePackages: string[] };

/**
 * The size of the same bundle at a reference commit (JavaScript before Hermes, bytes), built with this recipe: the QA app may grow by
 * 1 % over it before a test says so; a legitimate feature that does it moves this number, with the commit that explains why.
 * c75c31491 (before the smoke test): 10,944,737. The merge of the native-view libraries and the react-native-svg port: +4.4 %, all of
 * it the `/__dev/foreign` lab page's imports of the thirteen wrappers and the svg components (the lab ships in every variant).
 */
const baseline = { commit: "merge of feat/svelte-native-svg and feat/svelte-native-smoke", bytes: 11_429_553 };

/** What this run made: the bundle directories (about 15 to 34 MB each) and the Metro caches of their own. All removed when the tests end. */
const made: string[] = [];
const temporary = (prefix: string): string => {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	made.push(directory);
	return directory;
};
afterAll(() => {
	for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

function bundle(variant: string): { text: string; bytes: number } {
	const directory = temporary(`native-qa-bundle-${variant || "qa"}-`);
	const output = join(directory, "index.android.bundle");
	// `bun test` sets NODE_ENV=test. Metro's transform cache is not keyed by it and survives `--reset-cache`, so a bundle made after a
	// run with another NODE_ENV carries Reanimated's and Worklets' debug information (+6 %): production, and a cache of its own (TMPDIR).
	const env = { ...process.env, APP_VARIANT: variant, CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production", TMPDIR: temporary("native-qa-metro-") };
	const sync = spawnSync("node", [join(repoRoot, "packages/svelte-native/src/cli.ts"), "sync"], { cwd: platformDir, env, encoding: "utf8" });
	if (sync.status !== 0) throw new Error(`svelte-native sync failed: ${sync.stderr.slice(0, 400)}`);
	const done = spawnSync(
		"pnpm",
		["exec", "expo", "export:embed", "--platform", "android", "--dev", "false", "--minify", "false", "--reset-cache", "--entry-file", ".svelte-native/entry.ts", "--bundle-output", output, "--assets-dest", join(directory, "assets")],
		{ cwd: platformDir, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	if (done.status !== 0) throw new Error(`export:embed (${variant || "qa"}) failed: ${(done.stderr || done.stdout).slice(-600)}`);
	return { text: readFileSync(output, "utf8"), bytes: statSync(output).size };
}

const bundles = new Map<string, { text: string; bytes: number }>();
const bundled = (variant: string) => {
	let found = bundles.get(variant);
	if (!found) {
		found = bundle(variant);
		bundles.set(variant, found);
	}
	return found;
};

/** Strings that belong to the libraries' own code and to nothing else in the app. */
const libraryCode = ["RNFBAppModule", "MixpanelReactNative", "IntercomEventEmitter", "RNCNetInfo", "RNCAsyncStorage", "SslPublicKeyPinning", "QuickBase64", "HybridObject", "StatsigClient", "RNSentry"];

describe("the JavaScript bundles", () => {
	for (const [name, variant] of [["QA", ""], ["product", "production"]] as const) {
		test(`${name}: none of the smoke test's libraries is in the bundle, only the stubs that stand for them`, () => {
			const { text } = bundled(variant);
			const lines = text.split("\n");
			for (const library of smokeOnlyBundlePackages) {
				const mentions = lines.filter((line) => line.includes(library));
				// A package's name is in the bundle on the lines of its own stub if some code still requires it, and nowhere else.
				expect([library, mentions.filter((line) => !/_core\.js|is not linked in this app|var smokeModules/.test(line))]).toEqual([library, []]);
			}
			for (const code of libraryCode) expect([code, text.includes(code)]).toEqual([code, false]);
			// The checks are a stub too: the runner and the page are all of the smoke test the app carries.
			expect(text).not.toContain("RNGetRandomValues.getRandomBase64");
			expect(text).toContain("smoke-checks");
		}, 120_000);
	}
	test("the smoke app's bundle has them, so the stubs are what keeps them out", () => {
		const { text, bytes } = bundled("smoke");
		for (const code of libraryCode) expect([code, text.includes(code)]).toEqual([code, true]);
		expect(text).toContain("RNGetRandomValues.getRandomBase64");
		expect(bytes).toBeGreaterThan(bundled("").bytes * 1.2);
	}, 120_000);
	test("the QA app's bundle is the product's, and within 1 % of the reference commit's", () => {
		const qa = bundled("").bytes;
		const product = bundled("production").bytes;
		expect(Math.abs(qa - product) / product).toBeLessThan(0.001);
		expect(qa / baseline.bytes).toBeLessThan(1.01);
	}, 120_000);
});
