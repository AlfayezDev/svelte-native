import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

type Resolved = { modules: { packageName: string; projects?: { name: string; sourceDir: string; modules?: { classifier: string }[] }[]; pods?: { podName: string; podspecDir: string }[] }[] };

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
/** The library's own native modules are linked from the installed package, as an app outside this repository gets them (packages/svelte-native/expo-module.config.json). */
const library = "@rasheed/svelte-native";
const libraryDirectory = dirname(require.resolve("@rasheed/svelte-native/package.json"));
const libraryPods = ["SvelteBlur", "SvelteCapture", "SvelteInsets", "SvelteNavigation", "SvelteScreensIOS", "SvelteUpdates"];
const libraryProjects = ["svelte-engine", "svelte-updates", "svelte-blur"];
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
		expect(qa).toContain("expo.modules.svelteqa.SvelteQaPixelsModule");
		expect(qa).toContain("expo.modules.viewbench.ViewBenchModule");
		const product = classes(resolved("android", configuredExclude("production")));
		expect(product.filter((name) => /Qa|QA|ViewBench/.test(name))).toEqual([]);
		expect(product).not.toContain("expo.modules.svelteqa.SvelteQaPixelsModule");
		expect(product).toContain("expo.modules.svelteengine.SvelteEngineModule");
		expect(product).toContain("expo.modules.svelteupdates.SvelteUpdatesModule");
		expect(product).toContain("expo.modules.svelteblur.SvelteBlurModule");
	});

	test("iOS: the QA build links SvelteQA, the product's pods do not, and keep the library's screens, insets, navigation, capture and updates pods", () => {
		expect(packages(resolved("apple", configuredExclude("qa")))).toContain("svelte-qa-ios");
		const product = resolved("apple", configuredExclude("production"));
		expect(packages(product)).not.toContain("svelte-qa-ios");
		expect(packages(product)).toContain(library);
		expect(product.modules.find((module) => module.packageName === library)?.pods?.map((pod) => pod.podName).sort()).toEqual(libraryPods);
	});

	test("the library's modules come from the installed package and the QA modules from the app, each linked once, on both platforms", () => {
		const exclude = configuredExclude("qa");
		for (const platform of ["android", "apple"] as const) {
			const result = resolved(platform, exclude);
			const names = result.modules.flatMap((module) => (platform === "android" ? (module.projects ?? []).map((project) => project.name) : (module.pods ?? []).map((pod) => pod.podName)));
			expect(names.length).toBe(new Set(names).size);
			const own = result.modules.filter((module) => module.packageName === library);
			expect(own).toHaveLength(1);
			if (platform === "android") {
				expect(own[0]?.projects?.map((project) => project.name)).toEqual(libraryProjects);
				for (const project of own[0]?.projects ?? []) expect(project.sourceDir.startsWith(`${libraryDirectory}/native/`)).toBe(true);
			} else {
				for (const pod of own[0]?.pods ?? []) expect(pod.podspecDir.startsWith(`${libraryDirectory}/native/`)).toBe(true);
			}
			// nothing else in the app's list carries a library module: the QA modules are the app's own, and the six directories of the package are not local modules any more
			const others = result.modules.filter((module) => module.packageName !== library && /^svelte-/.test(module.packageName));
			expect(others.map((module) => module.packageName).sort()).toEqual(platform === "android" ? ["svelte-qa-android"] : ["svelte-qa-ios"]);
		}
		const android = resolved("android", exclude);
		expect(android.modules.find((module) => module.packageName === "view-bench")?.projects?.[0]?.sourceDir).toBe(resolve(app, "modules/view-bench/android"));
	});

	test("iOS: the product links the capture sweep with its launch subscriber (react-native-view-shot's tmpfile leftovers are deleted when a process starts, as Android's engine does), and the QA build does too", () => {
		for (const variant of ["production", "qa"] as const) {
			const sweep = resolved("apple", configuredExclude(variant)).modules.find((module) => module.packageName === library) as { appDelegateSubscribers?: string[]; swiftModuleNames?: string[] } | undefined;
			expect(sweep?.appDelegateSubscribers).toEqual(["SvelteCaptureSubscriber"]);
			// the Swift modules the generated provider imports: SvelteScreensIOS is Objective-C++ with no module of its own (`DEFINES_MODULE` is NO), so it is not in the list
			expect(sweep?.swiftModuleNames).toEqual(["SvelteCapture", "SvelteInsets", "SvelteNavigation", "SvelteUpdates", "SvelteBlur"]);
		}
	});

	test("the engine's own module list does not carry the injector, so excluding svelte-qa-android is enough", () => {
		const config = JSON.parse(readFileSync(resolve(libraryDirectory, "expo-module.config.json"), "utf8")) as { android: { projects: { name: string; modules: string[] }[] } };
		expect(config.android.projects.find((project) => project.name === "svelte-engine")?.modules).toEqual(["expo.modules.svelteengine.SvelteEngineModule"]);
		expect(existsSync(resolve(libraryDirectory, "native/svelte-engine/android/src/main/java/expo/modules/svelteengine/views/QaTouch.kt"))).toBe(false);
		const qa = JSON.parse(readFileSync(resolve(app, "modules/svelte-qa-android/expo-module.config.json"), "utf8")) as { android: { modules: string[] } };
		expect(qa.android.modules).toEqual(["expo.modules.svelteqa.SvelteQaTouchModule", "expo.modules.svelteqa.SvelteQaPixelsModule"]);
		// every module the QA package lists is a class one of its files defines (a name no file defines links nothing and fails at run time)
		const directory = resolve(app, "modules/svelte-qa-android/android/src/main/java/expo/modules/svelteqa");
		const defined = readdirSync(directory).filter((file) => file.endsWith(".kt")).map((file) => readFileSync(resolve(directory, file), "utf8")).join("\n");
		for (const name of qa.android.modules) expect(defined).toContain(`class ${name.split(".").pop()} : Module()`);
	});

	// The product ships the engine module. What reads the text of a view (a password field's included), what a service would read of the accessibility tree, what presses
	// the screen or performs an action, and what writes a profile to the app's files is the lab's: the module answers it in the QA app and in debuggable builds only
	// (`LabSwitches.allowed`), and each of those functions starts with the check. The functions are found by scanning the module, so a new one cannot be missed: every
	// function either starts with `requireLab(<its own name>)` or is one of the product's, named here.
	const productFunctions = [
		"install", "enableGestures", "reanimatedLoaded", "saveNavigation", "finishing", "getInsets", "dispatchCommand", "setNativeProps", "registerForeign", "captureView", "measure",
		// counters and microbenchmarks: they read and write no content of the app's
		"benchAnimated", "foreignStats", "collectJava", "stats",
		// a hint with no content: a commit attached many animated nodes, the engine puts its threads on the big cores for a moment (and does nothing outside the foreground)
		"animatedBatch",
	];
	const engineSource = () => readFileSync(resolve(libraryDirectory, "native/svelte-engine/android/src/main/java/expo/modules/svelteengine/SvelteEngineModule.kt"), "utf8");
	/** Every `Function(...)` and `AsyncFunction(...)` the module defines, and the lab check it opens with (the first statement after the lambda's parameters), if any. */
	function engineFunctions(source: string): { name: string; guard: string | null }[] {
		const head = /\b(?:Async)?Function\("(\w+)"\)\s*\{\s*(?:[\w\s:,?<>.]+->\s*)?(?:requireLab\("(\w+)"\))?/g;
		return [...source.matchAll(head)].map((match) => ({ name: match[1] ?? "", guard: match[2] ?? null }));
	}

	test("every function of the engine module is the product's or a lab hook that opens with requireLab for itself", () => {
		const functions = engineFunctions(engineSource());
		// the scan sees them all: as many heads as `Function(` declarations in the file
		expect(functions.length).toBe((engineSource().match(/\b(?:Async)?Function\("/g) ?? []).length);
		expect(functions.length).toBeGreaterThanOrEqual(productFunctions.length + 6);
		const unguarded = functions.filter((entry) => entry.guard === null).map((entry) => entry.name);
		// a function that is neither guarded nor listed as the product's is a lab hook that forgot the check (or a product function to list)
		expect(unguarded.filter((name) => !productFunctions.includes(name))).toEqual([]);
		// the list does not carry names the module no longer defines, nor a product function that is guarded
		expect(productFunctions.filter((name) => !functions.some((entry) => entry.name === name && entry.guard === null))).toEqual([]);
		// a guard names its own function (a copied line would otherwise pass for another hook's check)
		expect(functions.filter((entry) => entry.guard !== null && entry.guard !== entry.name)).toEqual([]);
		// the hooks known to be the lab's are among the guarded ones
		const guarded = functions.filter((entry) => entry.guard !== null).map((entry) => entry.name);
		for (const hook of ["inspect", "tap", "drag", "profileJs", "accessibilityNodes", "performAccessibilityAction"]) expect(guarded).toContain(hook);
	});

	test("the lab rule is the QA package or a debuggable build, and the module applies it", () => {
		const rule = readFileSync(resolve(libraryDirectory, "native/svelte-engine/android/src/main/java/expo/modules/svelteengine/LabSwitches.kt"), "utf8");
		expect(rule).toContain("fun allowed(packageName: String, debuggable: Boolean): Boolean = debuggable || packageName == QA_PACKAGE");
		expect(engineSource()).toContain("LabSwitches.allowed(context.packageName, debuggable)");
	});

	test("the iOS QA module's readbacks (inspect, samplePixels) refuse outside the QA bundle, which the product does not link at all", () => {
		const source = readFileSync(resolve(app, "modules/svelte-qa-ios/ios/SvelteQAModule.swift"), "utf8");
		for (const hook of ["inspect", "samplePixels"]) {
			const start = source.indexOf(`Function("${hook}")`);
			expect(start).toBeGreaterThan(-1);
			expect(source.slice(start, start + 220)).toContain("try SvelteQA.requireEnabled()");
		}
		expect(packages(resolved("apple", configuredExclude("production")))).not.toContain("svelte-qa-ios");
	});
});
