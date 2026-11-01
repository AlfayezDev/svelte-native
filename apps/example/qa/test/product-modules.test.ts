import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// The QA-only native modules (the in-app touch injector, the iOS QA inspection and gesture trace, the view bench) are in the QA build and not
// in the product build. The exclusion is a list in `app.config.ts` that the svelte-native plugin writes into settings.gradle and the Podfile;
// here the autolinking CLI of the installed Expo resolves the module list with exactly that list, as Gradle and CocoaPods do. The list is
// the one the native module smoke test uses too (qa/test/smoke.test.ts checks its smoke half): the product excludes the smoke test's
// libraries and the QA modules, the QA app the libraries only, the smoke app nothing.

const app = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(app, "package.json"));
const autolinking = resolve(dirname(require.resolve("expo-modules-autolinking/package.json", { paths: [require.resolve("expo/package.json")] })), "bin/expo-modules-autolinking.js");

/** The `autolinkingExclude` option `app.config.ts` gives the svelte-native plugin, for a build variant. */
function configuredExclude(variant: "production" | "qa" | "smoke"): string[] {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.APP_VARIANT;
	if (variant !== "qa") env.APP_VARIANT = variant;
	const run = spawnSync(process.execPath, ["-e", "import('./app.config.ts').then((m) => console.log(JSON.stringify(m.default.plugins)))"], { cwd: app, env, encoding: "utf8" });
	if (run.status !== 0) throw new Error(`app.config.ts did not evaluate: ${run.stderr}`);
	const plugins = JSON.parse(run.stdout) as (string | [string, { autolinkingExclude?: string[] }])[];
	const entry = plugins.find((plugin): plugin is [string, { autolinkingExclude?: string[] }] => Array.isArray(plugin) && plugin[0] === "@rasheed/svelte-native/expo");
	if (!entry) throw new Error("app.config.ts does not configure the svelte-native plugin");
	return entry[1].autolinkingExclude ?? [];
}

type Resolved = { modules: { packageName: string; projects?: { name: string; modules?: { classifier: string }[] }[] }[] };

/** `expo-modules-autolinking resolve` for a platform, with the exclusion; what Gradle's `useExpoModules()` and the Podfile's `use_expo_modules!` run. */
function resolved(platform: "android" | "apple", exclude: string[]): Resolved {
	const args = [autolinking, "resolve", "--platform", platform, "--json", ...exclude.flatMap((name) => ["--exclude", name])];
	const run = spawnSync(process.execPath, args, { cwd: app, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (run.status !== 0) throw new Error(`expo-modules-autolinking resolve failed: ${run.stderr}`);
	return JSON.parse(run.stdout) as Resolved;
}

const classes = (result: Resolved) => result.modules.flatMap((module) => (module.projects ?? []).flatMap((project) => (project.modules ?? []).map((entry) => entry.classifier)));
const packages = (result: Resolved) => result.modules.map((module) => module.packageName);

const qaOnly = ["svelte-qa-android", "svelte-qa-ios", "view-bench"];
const { smokeOnlyPackages } = require("./qa/smoke-packages.cjs") as { smokeOnlyPackages: string[] };

describe("the product build leaves the QA-only modules out of autolinking", () => {
	test("app.config.ts lists them for the product and for nobody else, next to the smoke test's libraries it also leaves out", () => {
		expect(configuredExclude("production").sort()).toEqual([...smokeOnlyPackages, ...qaOnly].sort());
		expect(configuredExclude("qa").sort()).toEqual([...smokeOnlyPackages].sort());
		expect(configuredExclude("smoke")).toEqual([]);
	});

	test("Android: the QA build links the injector and the bench, the product's module list has neither, and keeps the engine and the updates module", () => {
		const qa = classes(resolved("android", configuredExclude("qa")));
		expect(qa).toContain("expo.modules.svelteqa.SvelteQaTouchModule");
		expect(qa).toContain("expo.modules.viewbench.ViewBenchModule");
		const product = classes(resolved("android", configuredExclude("production")));
		expect(product.filter((name) => /Qa|QA|ViewBench/.test(name))).toEqual([]);
		expect(product).toContain("expo.modules.svelteengine.SvelteEngineModule");
		expect(product).toContain("expo.modules.svelteupdates.SvelteUpdatesModule");
	});

	test("iOS: the QA build links SvelteQA, the product's pods do not, and keep the screens, insets and updates modules", () => {
		expect(packages(resolved("apple", configuredExclude("qa")))).toContain("svelte-qa-ios");
		const product = packages(resolved("apple", configuredExclude("production")));
		expect(product).not.toContain("svelte-qa-ios");
		for (const kept of ["svelte-screens-ios", "svelte-insets-ios", "svelte-updates"]) expect(product).toContain(kept);
	});

	test("the engine's own module list does not carry the injector, so excluding svelte-qa-android is enough", () => {
		const engine = JSON.parse(readFileSync(resolve(app, "modules/svelte-engine/expo-module.config.json"), "utf8")) as { android: { modules: string[] } };
		expect(engine.android.modules).toEqual(["expo.modules.svelteengine.SvelteEngineModule"]);
		expect(existsSync(resolve(app, "modules/svelte-engine/android/src/main/java/expo/modules/svelteengine/views/QaTouch.kt"))).toBe(false);
		const qa = JSON.parse(readFileSync(resolve(app, "modules/svelte-qa-android/expo-module.config.json"), "utf8")) as { android: { modules: string[] } };
		expect(qa.android.modules).toEqual(["expo.modules.svelteqa.SvelteQaTouchModule", "expo.modules.svelteqa.SvelteQaPixelsModule"]);
	});
});
