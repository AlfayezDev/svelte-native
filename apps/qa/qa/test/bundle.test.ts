import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platformDir, svelteNativeCli } from "../lib/paths.ts";

/**
 * The JavaScript bundle of each app (packages/svelte-native/native/svelte-engine/SPEC.md, "Native modules (smoke test)" and "What the product contains: no development lab (JavaScript)"). The smoke test's libraries are in the smoke app only,
 * so Metro resolves them, and the smoke checks, to a stub in the product and the QA app: the bundle the JavaScript boot gate
 * measures must not carry thirty libraries it never calls. Bundled the way React Native's Gradle plugin does it (`expo export:embed`,
 * release, not minified: Hermes compiles it), without the Hermes step.
 *
 * The development lab (`src/routes/__dev/**`, `src/lib/native/dev/**`) is in the QA app and the smoke app and not in the product: route
 * discovery leaves the `/__dev` routes out of the product's route table and Metro stubs what is still imported from the lab's directories.
 * The product's modules are listed from the bundle's source map. Each variant has a route table of its own (`.svelte-native/routes.<variant>.ts`),
 * which Metro writes when its config loads, so a bundle never touches another variant's table, and the tests below can run beside a live
 * development server of the QA app.
 */
const { smokeOnlyBundlePackages } = createRequire(import.meta.url)("../smoke-packages.cjs") as { smokeOnlyBundlePackages: string[] };

/**
 * The size of the same bundle at a reference commit (JavaScript before Hermes, bytes), built with this recipe: the QA app may grow by
 * 1 % over it before a test says so; a legitimate feature that does it moves this number, with the commit that explains why.
 *
 * Measured again on 9 November 2026 at 1bbbec6, the first commit of this repository whose example app has no code of the product it was
 * extracted from (no session, no account screens, no database client, no product message catalog; a layout stand-in and a home screen
 * instead). What changed is the app and not the library: the QA app 5,628,280 bytes in 1,151 modules, the production variant 3,953,493 in
 * 851 (the smoke app, which no baseline holds, 8,682,070 in 1,870). In the repository the example came out of, the same recipe read 12,224,724
 * (QA, with the remote functions lab) and 10,813,791 (production, +0.5 % over its 10,760,249 baseline): the 6.6 and 6.9 MB between the two
 * are the product's, not measured module by module. The production variant is 1,674,787 bytes (29.8 %) under the QA app: the lab and the
 * libraries only it imports.
 */
const baseline = { commit: "1bbbec6 (the example without the product's code)", bytes: 5_628_280 };

/**
 * The production variant's bundle without the lab, built with the same recipe. It may grow by 1 % before a test says so. Measured again at 727bded, which makes the library's
 * polyfills load Expo's WinterCG runtime (a standard `URL`, `fetch`, `TextDecoder`, ... that the router needs): 4,074,366 bytes, 120,873 (3.1 %) over the 3,953,493 of 1bbbec6 without
 * it (the QA app, which imported the runtime already, did not move).
 */
const productBaseline = { commit: "727bded (Polyfills: Expo's WinterCG runtime is loaded)", bytes: 4_074_366 };

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

type Bundle = { text: string; bytes: number; modules: string[] };
/** `svelte-native sync` for a variant (the command a developer or the QA harness runs). */
function sync(variant: string): void {
	// The QA app's variant is `qa` (the library's own default for no variant is `app`).
	const done = spawnSync("node", [svelteNativeCli, "sync"], { cwd: platformDir, env: { ...process.env, APP_VARIANT: variant || "qa", EXPO_NO_TELEMETRY: "1" }, encoding: "utf8" });
	if (done.status !== 0) throw new Error(`svelte-native sync (${variant || "qa"}) failed: ${done.stderr.slice(0, 400)}`);
}
/**
 * `syncedFirst`: the variants `svelte-native sync` runs for before the bundle is made (none by default: Metro writes the route table of the
 * variant it bundles when its config loads, which is what the tests below rely on).
 */
function bundle(variant: string, syncedFirst: readonly string[] = []): Bundle {
	const directory = temporary(`native-qa-bundle-${variant || "qa"}-`);
	const output = join(directory, "index.android.bundle");
	const sourceMap = join(directory, "index.android.bundle.map");
	// `bun test` sets NODE_ENV=test. Metro's transform cache is not keyed by it and survives `--reset-cache`, so a bundle made after a
	// run with another NODE_ENV carries Reanimated's and Worklets' debug information (+6 %): production, and a cache of its own (TMPDIR).
	const env = { ...process.env, APP_VARIANT: variant, CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production", TMPDIR: temporary("native-qa-metro-") };
	for (const synced of syncedFirst) sync(synced);
	const done = spawnSync(
		"pnpm",
		["exec", "expo", "export:embed", "--platform", "android", "--dev", "false", "--minify", "false", "--reset-cache", "--entry-file", ".svelte-native/entry.ts", "--bundle-output", output, "--sourcemap-output", sourceMap, "--assets-dest", join(directory, "assets")],
		{ cwd: platformDir, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	if (done.status !== 0) throw new Error(`export:embed (${variant || "qa"}) failed: ${(done.stderr || done.stdout).slice(-600)}`);
	// The source map lists the modules of the bundle, as paths from the repository root (`/apps/qa/src/…`).
	const { sources } = JSON.parse(readFileSync(sourceMap, "utf8")) as { sources: string[] };
	return { text: readFileSync(output, "utf8"), bytes: statSync(output).size, modules: sources.map((source) => source.replace(/^\//, "")) };
}

const bundles = new Map<string, Bundle>();
const bundled = (variant: string, syncedFirst: readonly string[] = []) => {
	const key = `${variant}<${syncedFirst.join(",")}`;
	let found = bundles.get(key);
	if (!found) {
		found = bundle(variant, syncedFirst);
		bundles.set(key, found);
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
			expect(text).not.toContain("RNGetRandomValues.getRandomBase64");
			// The checks are a stub too: the runner and the page, which are the lab's, are all of the smoke test the QA app carries, and the product has none of it.
			expect(text.includes("smoke-checks")).toBe(variant === "");
		}, 120_000);
	}
	test("the smoke app's bundle has them, so the stubs are what keeps them out", () => {
		const { text, bytes } = bundled("smoke");
		for (const code of libraryCode) expect([code, text.includes(code)]).toEqual([code, true]);
		expect(text).toContain("RNGetRandomValues.getRandomBase64");
		expect(bytes).toBeGreaterThan(bundled("").bytes * 1.2);
	}, 120_000);
	test("the QA app's bundle is within 1 % of the reference commit's, and the product's within 1 % of its own", () => {
		expect(bundled("").bytes / baseline.bytes).toBeLessThan(1.01);
		expect(bundled("production").bytes / productBaseline.bytes).toBeLessThan(1.01);
	}, 120_000);
});

/** Modules of the development lab: the routes under `__dev` and what `src/lib/native/dev` holds. */
const labModule = /^apps\/qa\/src\/(?:lib\/native\/dev|routes\/__dev)\//;
/** A stub Metro puts where an import would reach a module the app does not carry. */
const stubModule = /^apps\/qa\/\.svelte-native\/stubs\//;
/** The generated route table of a variant: each bundle has its own variant's and no other (`.svelte-native/routes.<variant>.ts`). */
const tableModule = /^apps\/qa\/\.svelte-native\/routes\.[^/]+\.ts$/;
/** What only the lab may bring along: its assets, the workspace package (the foreign view wrappers) and the libraries. */
const labDependency = /^(?:apps\/qa\/assets\/native\/lab\/|packages\/svelte-native\/|node_modules\/)|\/node_modules\//;

describe("the development lab", () => {
	test("the product has no /__dev route and no module of the lab; what shared code still imports from it is a stub", () => {
		const { modules, text } = bundled("production");
		expect(modules.filter((module) => labModule.test(module))).toEqual([]);
		expect(modules.filter((module) => /\/__dev\//.test(module) || module.includes("assets/native/lab"))).toEqual([]);
		// The root layout's hooks (the error counter, the update harness's faults and report, the QA module) name modules of the lab behind `nativeLabEnabled`: all resolve to the directory's stub.
		expect(modules.filter((module) => stubModule.test(module)).toSorted()).toEqual(["apps/qa/.svelte-native/stubs/production/_core.js", "apps/qa/.svelte-native/stubs/production/src_lib_native_dev_.js"]);
		expect(text).not.toContain("Mobile development lab");
		// The route table does not name the lab, and the one place that knows its path is the session guard, which sends a link to it away (defence in depth).
		expect(text.split("\n").filter((line) => line.includes("__dev")).map((line) => line.trim())).toEqual(['if (path === "/__dev" || path.startsWith("/__dev/")) {']);
	}, 120_000);
	test("the QA app has all of it: every route of the lab and its hooks, and nothing of the product is missing", () => {
		const qa = bundled("").modules;
		const lab = qa.filter((module) => labModule.test(module));
		expect(lab.length).toBeGreaterThan(50);
		const routes = readdirSync(join(platformDir, "src/routes/__dev"), { recursive: true, encoding: "utf8" }).filter((path) => /(?:^|\/)\+(?:layout\.)?mobile\.svelte$/.test(path));
		expect(routes.length).toBeGreaterThan(8);
		for (const route of routes) expect(qa).toContain(`apps/qa/src/routes/__dev/${route}`);
		for (const hook of ["errors.ts", "qa.ts", "update-probe.ts", "LabLink.svelte", "launch.ts"]) expect(qa).toContain(`apps/qa/src/lib/native/dev/${hook}`);
	}, 120_000);
	test("the QA app is the product plus the lab: whatever the product has, the QA app has, and the rest is the lab or a library only it imports", () => {
		const qa = new Set(bundled("").modules);
		const product = new Set(bundled("production").modules);
		// Each has the route table of its own variant, and only that one.
		expect([...product].filter((module) => tableModule.test(module))).toEqual(["apps/qa/.svelte-native/routes.production.ts"]);
		expect([...qa].filter((module) => tableModule.test(module))).toEqual(["apps/qa/.svelte-native/routes.qa.ts"]);
		const missing = [...product].filter((module) => !qa.has(module) && !stubModule.test(module) && !tableModule.test(module));
		expect(missing).toEqual([]);
		const lab = [...qa].filter((module) => !product.has(module) && !stubModule.test(module) && !tableModule.test(module));
		// No module of the app outside the lab is only in the QA app, and the product has none of the lab's own modules.
		expect(lab.filter((module) => !labModule.test(module) && !labDependency.test(module))).toEqual([]);
		expect(lab.filter((module) => labModule.test(module)).length).toBe([...qa].filter((module) => labModule.test(module)).length);
		// The libraries only the lab imports are out of the product with it.
		for (const library of ["react-native-svg/", "expo-video/", "expo-keep-awake/"]) {
			expect([library, [...qa].some((module) => module.includes(library))]).toEqual([library, true]);
			expect([library, [...product].some((module) => module.includes(library))]).toEqual([library, false]);
		}
		expect(lab.length).toBeGreaterThan(100);
	}, 120_000);
	test("a route table synced for another variant changes nothing: each variant bundles its own", () => {
		// `svelte-native sync` for the QA app, then the product is bundled (a forgotten sync before `eas update`, a QA sync before a product export):
		// the product's table is its own file, so the product still has no lab route, and no module of the lab but the stub.
		const forgotten = bundled("production", [""]);
		expect(forgotten.modules.filter((module) => labModule.test(module))).toEqual([]);
		expect(forgotten.modules.filter((module) => /\/__dev\//.test(module))).toEqual([]);
		expect(forgotten.text.split("\n").filter((line) => line.includes("__dev")).length).toBe(1);
		expect(forgotten.bytes).toBe(bundled("production").bytes);
		// And the product's table synced before a QA bundle: the QA app has every route of the lab.
		const leftover = bundled("", ["production"]);
		expect(leftover.modules.filter((module) => /apps\/qa\/src\/routes\/__dev\/.*\+mobile\.svelte$/.test(module)).length).toBeGreaterThan(8);
		expect(leftover.bytes).toBe(bundled("").bytes);
	}, 120_000);
	test("a bundle writes no file another variant's Metro (a live development server of the QA app) reads: not its table, not the stubs", () => {
		const watched = () => {
			const directory = join(platformDir, ".svelte-native");
			// What the Metro of the QA app and of the smoke app reads: their tables, the entry and their stubs (a directory of their own each).
			const stubs = ["qa", "smoke"].flatMap((variant) => (existsSync(join(directory, "stubs", variant)) ? readdirSync(join(directory, "stubs", variant)).map((name) => join(directory, "stubs", variant, name)) : []));
			const files = [join(directory, "routes.qa.ts"), join(directory, "routes.smoke.ts"), join(directory, "entry.ts"), ...stubs];
			return Object.fromEntries(files.map((file) => [file, existsSync(file) ? statSync(file).mtimeMs : null]));
		};
		// Both tables exist and are current (the QA harness and a developer ran `sync`); the QA app's Metro has loaded them and its stubs.
		sync("");
		sync("smoke");
		bundle("");
		const before = watched();
		expect(Object.values(before).filter((time) => time === null)).toEqual([]);
		expect(Object.keys(before).filter((file) => file.includes("/stubs/")).length).toBeGreaterThan(30); // the packages' stubs, the smoke checks' and the core, per variant
		bundle("production");
		expect(watched()).toEqual(before);
		bundle("smoke");
		bundle("");
		expect(watched()).toEqual(before); // a current table is not rewritten by the Metro that loads it, nor by a bundle of the same variant
	}, 240_000);
	test("the product is smaller than the QA app by the lab, and the smoke app has the QA app's", () => {
		const qa = bundled("").bytes;
		const product = bundled("production").bytes;
		expect(product).toBeLessThan(qa * 0.93);
		expect(qa - product).toBeGreaterThan(900_000);
		const smoke = new Set(bundled("smoke").modules);
		expect([...smoke].filter((module) => tableModule.test(module))).toEqual(["apps/qa/.svelte-native/routes.smoke.ts"]);
		expect(bundled("").modules.filter((module) => !smoke.has(module) && !stubModule.test(module) && !tableModule.test(module))).toEqual([]);
	}, 120_000);
});
