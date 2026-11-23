import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platformDir, expoSvelteCli } from "../lib/paths.ts";
import { sourcesOfMap, type RawSourceMap } from "../lib/source-map.ts";

/**
 * The JavaScript bundle of each app (packages/expo-svelte/native/svelte-core/SPEC.md, "Native modules (smoke test)" and "What the product contains: no development lab (JavaScript)"). The smoke test's libraries are in the smoke app only,
 * so Metro resolves them, and the smoke checks, to a stub in the product and the QA app: the bundle the JavaScript boot gate
 * measures must not carry thirty libraries it never calls. Bundled the way React Native's Gradle plugin does it (`expo export:embed`,
 * release, not minified: Hermes compiles it), without the Hermes step.
 *
 * The development lab (`src/routes/__dev/**`, `src/lib/native/dev/**`) is in the QA app and the smoke app and not in the product: route
 * discovery leaves the `/__dev` routes out of the product's route table and Metro stubs what is still imported from the lab's directories.
 * The product's modules are listed from the bundle's source map. Each variant has a route table of its own (`.expo-svelte/routes.<variant>.ts`),
 * which Metro writes when its config loads, so a bundle never touches another variant's table, and the tests below can run beside a live
 * development server of the QA app.
 */
const { smokeOnlyBundlePackages, libraryVendoredPackages } = createRequire(import.meta.url)("../smoke-packages.cjs") as { smokeOnlyBundlePackages: string[]; libraryVendoredPackages: string[] };

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
 *
 * Moved on 11 November 2026 (feat/qa-coverage, after main's HTML elements, span press, and transitions with `animate:flip` were merged in) from 5,719,571 to 6,003,584 bytes (1,205 modules). The same recipe read 5,867,760
 * bytes in 1,190 modules at eda5a64 (main, with the transitions: they are about 51 KB of main's own baseline below, the keyframe tracks, the worklet that samples them, the host's playback and layout read, and the node's
 * DOM-like surface in the renderer, which every app carries). The lab's coverage of what landed without it adds 135,824 more (2.3 %), all of it the lab's, which only the QA app and the smoke app carry: the built-in
 * BlurView's section and its nine pixel checks with their helpers (+16,971), the class probe, the ten class checks and their runner (+23,769), the class table `src/global.css` makes (+6,548: Tailwind reads every word of
 * `src/` as a candidate, so the table holds the classes the probes use and those the sources happen to contain), the six HTML checks and their runner (+10,762), the screen of HTML elements the checks read, its route, the
 * gestures page of the span press and its scenario, with the classes they add to the table (+33,053 together, not split), and, for transitions, the screen of `in:`, `out:`, `transition:` and `animate:flip` on HTML
 * elements, its route, the five checks with their runner and expectations, and the classes they add to the table (+44,721 together, not split; the first five were measured against main's earlier 5,811,760, so the
 * split is not exact to the byte). The production variant has no lab and no `css` option: 4,207,070 bytes in 906 modules, +209 over main's 4,206,861 at eda5a64, which is the `mergeHostProps` export of the library's
 * renderer entry that the checks read the host's props through (0.1 % over its own baseline below). Both were measured in a checkout whose installed Svelte had the library's patch applied to a scratch copy of the
 * compiler (`patches/svelte@5.56.7.patch`, which lets the compiler accept transitions with a custom renderer), the same bytes an install with the patch gives, because the patch changes the compiler and not what it emits.
 *
 * Moved on 13 November 2026 (feat/exports-grouped), from 6,003,584 to 6,007,156 bytes (+3,572, 1,205 to 1,206 modules): the generated entry imports `expo-svelte/app` (one module that imports the boot modules and the Fabric host in the order it
 * imported them), and the main entry exports the animation, the gestures and the SVG components, which the QA app carried already for its lab. The product variant moved far more (see `productBaseline`): it is the variant that did not carry them.
 *
 * Moved on 14 November 2026 (feat/native-fetch), from 6,007,156 to 7,085,004 bytes (+1,077,848, 17.9 %; 1,206 to 1,403 modules), in two parts, both measured with this recipe on the same tree. The library's own `fetch`, `Blob`, `FormData`, `crypto` and
 * `localStorage` (the JavaScript layer over the `SvelteFetch` module, the web `crypto` and `Storage` objects, `/mmkv`) and the lab's Web APIs screen and checks: 6,146,358 bytes in 1,239 modules (+139,202, 2.3 %). Then the four packages the library now requires
 * as peers, react-native-quick-crypto, react-native-mmkv, react-native-nitro-modules and react-native-quick-base64: they were the smoke test's libraries, which Metro stubbed in this variant, and `crypto` and `localStorage` read them, so the QA app
 * bundles the real ones (+938,646 bytes, 164 modules; quick-crypto's implementation of Node's crypto API and the modules it needs are most of it). The smoke app carried them already and does not move (9,173,998 bytes in 1,938 modules).
 *
 * Moved on 23 November 2026 (chore/expo-sdk-58, Expo SDK 58 with React Native 0.88 and React 19.3), from 7,085,004 to 8,029,217 bytes (+944,213, 13.3 %; 1,709 modules). Measured on that tree with this recipe; the old number was not measured again
 * on SDK 57, so the move is not split module by module. By package, the 1,709 modules: react-native-reanimated 1,392,134 (271 modules), the library's own 1,228,904, react-native 1,204,841 (452), the app 855,753, svelte 771,448,
 * react-native-quick-crypto 360,762, @sveltejs/kit 242,808, react-native-worklets 233,516, readable-stream 228,962, expo 183,895, react-native-svg 105,372, react-native-gesture-handler 74,314. What is known: the sources of the libraries that moved
 * grew (reanimated 4.5.1 to 4.7.1 +106 KB, worklets 0.10.1 to 0.13.0 +46 KB, gesture handler 2.32.0 to 3.3.0 +239 KB of which 74 KB is bundled, svg +23 KB), and each library appears once, as the library's copy.
 */
const baseline = { commit: "Expo SDK 58 with React Native 0.88 (chore/expo-sdk-58: 8,029,217 bytes in 1,709 modules, +13.3 % over the 7,085,004 of feat/native-fetch); before that, the library's own fetch, Blob, crypto and localStorage with the Web APIs lab (+139,202 bytes, 2.3 %), and the four packages the library requires as peers, which every app bundles now (+938,646 bytes; feat/native-fetch: 7,085,004 bytes in 1,403 modules, +17.9 % over the 6,007,156 of feat/exports-grouped)", bytes: 8_029_217 };

/**
 * The production variant's bundle without the lab, built with the same recipe. It may grow by 1 % before a test says so. Measured again at 727bded, which makes the library's
 * polyfills load Expo's WinterCG runtime (a standard `URL`, `fetch`, `TextDecoder`, ... that the router needs): 4,074,366 bytes, 120,873 (3.1 %) over the 3,953,493 of 1bbbec6 without
 * it (the QA app, which imported the runtime already, did not move).
 *
 * Moved on 14 November 2026 (feat/native-fetch), from 4,505,761 to 5,586,438 bytes (+1,080,677, 24.0 %; 980 to 1,180 modules): the library's own `fetch`, `Blob`, `FormData`, `crypto` and `localStorage` (4,645,130 bytes in 1,014 modules, +139,369, 3.1 %: the
 * product has no lab, so this is the library's code alone), and the four required peers, which the product bundled as stubs before and bundles for real now (+941,308 bytes, 166 modules).
 *
 * Moved on 23 November 2026 (chore/expo-sdk-58), from 5,586,438 to 5,883,511 bytes (+297,073, 5.3 %; 1,302 modules): Expo SDK 58 with React Native 0.88, and the libraries the library carries at their SDK 58 versions (reanimated 1,392,134 bytes,
 * react-native 652,028 in 271 modules, worklets 233,516, gesture handler 74,314). Not measured again on SDK 57, so not split module by module.
 */
const productBaseline = { commit: "Expo SDK 58 with React Native 0.88 (chore/expo-sdk-58: 5,883,511 bytes in 1,302 modules, +5.3 % over the 5,586,438 of feat/native-fetch); before that, the library's own fetch, Blob, crypto and localStorage (+139,369 bytes, 3.1 %), and the four packages the library requires as peers, which every app bundles now (+941,308 bytes; feat/native-fetch: 5,586,438 bytes in 1,180 modules, +24.0 % over the 4,505,761 of feat/exports-grouped)", bytes: 5_883_511 };

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
/** `expo-svelte sync` for a variant (the command a developer or the QA harness runs). */
function sync(variant: string): void {
	// The QA app's variant is `qa` (the library's own default for no variant is `app`).
	const done = spawnSync("node", [expoSvelteCli, "sync"], { cwd: platformDir, env: { ...process.env, APP_VARIANT: variant || "qa", EXPO_NO_TELEMETRY: "1" }, encoding: "utf8" });
	if (done.status !== 0) throw new Error(`expo-svelte sync (${variant || "qa"}) failed: ${done.stderr.slice(0, 400)}`);
}
/**
 * `syncedFirst`: the variants `expo-svelte sync` runs for before the bundle is made (none by default: Metro writes the route table of the
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
		["exec", "expo", "export:embed", "--platform", "android", "--dev", "false", "--minify", "false", "--reset-cache", "--entry-file", ".expo-svelte/entry.ts", "--bundle-output", output, "--sourcemap-output", sourceMap, "--assets-dest", join(directory, "assets")],
		{ cwd: platformDir, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	if (done.status !== 0) throw new Error(`export:embed (${variant || "qa"}) failed: ${(done.stderr || done.stdout).slice(-600)}`);
	// The source map lists the modules of the bundle, as paths from the repository root (`/apps/qa/src/…`).
	const sources = sourcesOfMap(JSON.parse(readFileSync(sourceMap, "utf8")) as RawSourceMap);
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
const libraryCode = ["RNFBAppModule", "MixpanelReactNative", "IntercomEventEmitter", "RNCNetInfo", "RNCAsyncStorage", "SslPublicKeyPinning", "StatsigClient", "RNSentry"];
/** Strings of the packages the library carries (vendored: react-native-quick-crypto, react-native-quick-base64, react-native-mmkv and react-native-nitro-modules), which every app carries: the Nitro runtime's hybrid objects and quick-base64's native module. */
const peerCode = ["QuickBase64", "HybridObject"];

describe("the JavaScript bundles", () => {
	for (const [name, variant] of [["QA", ""], ["product", "production"]] as const) {
		test(`${name}: none of the smoke test's libraries is in the bundle, only the stubs that stand for them`, () => {
			const { text } = bundled(variant);
			const lines = text.split("\n");
			for (const library of smokeOnlyBundlePackages) {
				const mentions = lines.filter((line) => line.includes(library));
				// A package's name is in the bundle on the lines of its own stub if some code still requires it, and nowhere else (the library's own location code
				// is its own native module and names no package: `MISSING_LOCATION` in src/geolocation.ts says to turn the capability on, not what to install).
				expect([library, mentions.filter((line) => !/_core\.js|is not linked in this app|var smokeModules/.test(line))]).toEqual([library, []]);
			}
			for (const code of libraryCode) expect([code, text.includes(code)]).toEqual([code, false]);
			expect(text).not.toContain("RNGetRandomValues.getRandomBase64");
			// The checks are a stub too: the runner and the page, which are the lab's, are all of the smoke test the QA app carries, and the product has none of it.
			expect(text.includes("smoke-checks")).toBe(variant === "");
		}, 120_000);
	}
	test("every app bundles the packages the library carries (crypto and localStorage are made of four of them; the animation, gestures and svg of the rest), its own copies and no stub", () => {
		for (const variant of ["", "production", "smoke"]) {
			const { modules, text } = bundled(variant);
			// The ones the library vendors are its own copies (`packages/expo-svelte/vendor/<name>/`), one each: the app's import, quick-crypto's imports of the Nitro runtime and the base64 module and the library's own all reach the same files, and no installed original is bundled beside them (`react-native-quick-base64` is installed all the same, for the Buffer package, and so are gesture handler, Reanimated and Worklets, which a package manager installs for Expo Router's peers: none of them is reached).
			// Metro's stub for a package is a file named after it (`.expo-svelte/stubs/<variant>/<package>.js`): there is none for these.
			for (const library of libraryVendoredPackages) {
				expect([variant, library, modules.some((module) => module.startsWith(`packages/expo-svelte/vendor/${library}/`))]).toEqual([variant, library, true]);
				expect([variant, library, modules.filter((module) => module.includes(`node_modules/${library}/`))]).toEqual([variant, library, []]);
				expect([variant, library, modules.filter((module) => stubModule.test(module) && module.includes(library))]).toEqual([variant, library, []]);
			}
			for (const code of peerCode) expect([variant, code, text.includes(code)]).toEqual([variant, code, true]);
		}
	}, 120_000);
	test("the smoke app's bundle has them, so the stubs are what keeps them out", () => {
		const { text, bytes } = bundled("smoke");
		for (const code of libraryCode) expect([code, text.includes(code)]).toEqual([code, true]);
		expect(text).toContain("RNGetRandomValues.getRandomBase64");
		expect(bytes).toBeGreaterThan(bundled("").bytes * 1.15);
	}, 120_000);
	test("the QA app's bundle is within 1 % of the reference commit's, and the product's within 1 % of its own", () => {
		expect(bundled("").bytes / baseline.bytes).toBeLessThan(1.01);
		expect(bundled("production").bytes / productBaseline.bytes).toBeLessThan(1.01);
	}, 120_000);
});

/** Modules of the development lab: the routes under `__dev` and what `src/lib/native/dev` holds. */
const labModule = /^apps\/qa\/src\/(?:lib\/native\/dev|routes\/__dev)\//;
/** A stub Metro puts where an import would reach a module the app does not carry. */
const stubModule = /^apps\/qa\/\.expo-svelte\/stubs\//;
/** The generated route table of a variant: each bundle has its own variant's and no other (`.expo-svelte/routes.<variant>.ts`). */
const tableModule = /^apps\/qa\/\.expo-svelte\/routes\.[^/]+\.ts$/;
/**
 * The generated class table of a variant (`.expo-svelte/classes.<variant>.ts`, the `css` option of `metro.config.cjs`): the lab's own classes are what the checks of the native checks lab read, so the QA app and the smoke app
 * have a table and the product, which has no lab and no class, has none (`css` is off for it).
 */
const classTable = /^apps\/qa\/\.expo-svelte\/classes\.[^/]+\.ts$/;
/** What the product has in the class table's place: the library's own empty table (an app with no `css` option). */
const emptyClassTable = "packages/expo-svelte/src/css/empty-table.ts";
/** What only the lab may bring along: its assets, the workspace package (the foreign view wrappers) and the libraries. */
const labDependency = /^(?:apps\/qa\/assets\/native\/lab\/|packages\/expo-svelte\/|node_modules\/)|\/node_modules\//;

describe("the development lab", () => {
	test("the product has no /__dev route and no module of the lab; what shared code still imports from it is a stub", () => {
		const { modules, text } = bundled("production");
		expect(modules.filter((module) => labModule.test(module))).toEqual([]);
		expect(modules.filter((module) => /\/__dev\//.test(module) || module.includes("assets/native/lab"))).toEqual([]);
		// The root layout's hooks (the error counter, the update harness's faults and report, the QA module) name modules of the lab behind `nativeLabEnabled`: all resolve to the directory's stub.
		expect(modules.filter((module) => stubModule.test(module)).toSorted()).toEqual(["apps/qa/.expo-svelte/stubs/production/_core.js", "apps/qa/.expo-svelte/stubs/production/src_lib_native_dev_.js"]);
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
		expect([...product].filter((module) => tableModule.test(module))).toEqual(["apps/qa/.expo-svelte/routes.production.ts"]);
		expect([...qa].filter((module) => tableModule.test(module))).toEqual(["apps/qa/.expo-svelte/routes.qa.ts"]);
		// The class table is the lab's too: the QA app has its own variant's, the product none.
		expect([...product].filter((module) => classTable.test(module))).toEqual([]);
		expect([...qa].filter((module) => classTable.test(module))).toEqual(["apps/qa/.expo-svelte/classes.qa.ts"]);
		expect([product.has(emptyClassTable), qa.has(emptyClassTable)]).toEqual([true, false]);
		const missing = [...product].filter((module) => !qa.has(module) && !stubModule.test(module) && !tableModule.test(module) && module !== emptyClassTable);
		expect(missing).toEqual([]);
		const lab = [...qa].filter((module) => !product.has(module) && !stubModule.test(module) && !tableModule.test(module) && !classTable.test(module));
		// No module of the app outside the lab is only in the QA app, and the product has none of the lab's own modules.
		expect(lab.filter((module) => !labModule.test(module) && !labDependency.test(module))).toEqual([]);
		expect(lab.filter((module) => labModule.test(module)).length).toBe([...qa].filter((module) => labModule.test(module)).length);
		// The libraries only the lab imports are out of the product with it.
		for (const library of ["expo-video/", "expo-keep-awake/"]) {
			expect([library, [...qa].some((module) => module.includes(library))]).toEqual([library, true]);
			expect([library, [...product].some((module) => module.includes(library))]).toEqual([library, false]);
		}
		// react-native-svg is not one of them: it is a required peer, and the main entry exports its components, so every app has its extraction code.
		expect(["react-native-svg/", [...product].some((module) => module.includes("react-native-svg/"))]).toEqual(["react-native-svg/", true]);
		expect(lab.length).toBeGreaterThan(100);
	}, 120_000);
	test("a route table synced for another variant changes nothing: each variant bundles its own", () => {
		// `expo-svelte sync` for the QA app, then the product is bundled (a forgotten sync before `eas update`, a QA sync before a product export):
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
			const directory = join(platformDir, ".expo-svelte");
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
		// The packages' stubs, the smoke checks' and the core, per variant whose Metro has run here (29 for the QA app since the library's four
		// required peers are linked in every variant; a checkout where the smoke app was bundled before has its stubs too).
		expect(Object.keys(before).filter((file) => file.includes("/stubs/")).length).toBeGreaterThan(20);
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
		expect([...smoke].filter((module) => tableModule.test(module))).toEqual(["apps/qa/.expo-svelte/routes.smoke.ts"]);
		expect([...smoke].filter((module) => classTable.test(module))).toEqual(["apps/qa/.expo-svelte/classes.smoke.ts"]);
		expect(bundled("").modules.filter((module) => !smoke.has(module) && !stubModule.test(module) && !tableModule.test(module) && !classTable.test(module))).toEqual([]);
	}, 120_000);
});
