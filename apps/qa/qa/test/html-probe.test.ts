import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";
import { build, transform } from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { htmlCheckNames } from "../../src/lib/native/dev/html-checks.ts";
import { platformDir, svelteNativeCli } from "../lib/paths.ts";

/**
 * The HTML checks of the native checks lab run on the host against the real pieces: the QA app's class table, the HTML lowering, the renderer, the Fabric host (`fabric/host.ts`, which draws the text, lays out
 * the items, inherits the text style and hears the presses) and the lab's runner (`html-lab.ts`) on the lab's own screen (`HtmlScreen.svelte`). Only the platform is a stand-in: React Native's modules and a fake
 * Fabric binding (the package's own harness, `tests/html-harness.ts`, whose `fake` the host builds into). What this holds is that each check reads the thing its name says: it passes on the real host and fails on
 * the host with that one thing broken, by a change to the library's source as the bundle reads it.
 */
const library = resolve(platformDir, "../../packages/svelte-native");
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

/** The QA app's class table, built in a project of its own with the repository's Tailwind linked in (as `class-probe.test.ts` does). */
function builtTable(): unknown {
	const root = mkdtempSync(join(tmpdir(), "native-qa-html-"));
	made.push(root);
	mkdirSync(join(root, "src/lib"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	symlinkSync(dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json")), join(root, "node_modules/tailwindcss"));
	copyFileSync(join(platformDir, "src/global.css"), join(root, "src/global.css"));
	for (const file of ["HtmlScreen.svelte", "html-checks.ts", "html-lab.ts"]) copyFileSync(join(platformDir, "src/lib/native/dev", file), join(root, "src/lib", file));
	const built = spawnSync(process.execPath, [svelteNativeCli, "css", "src/global.css", "--variant", "qa", "--json"], { cwd: root, encoding: "utf8" });
	if (built.status !== 0) throw new Error(`svelte-native css failed: ${built.stderr.slice(0, 400)}`);
	return JSON.parse(readFileSync(JSON.parse(built.stdout).file, "utf8").replace(/^[\s\S]*?export default /, "").replace(/\s+as typeof Table;\s*$/, "").replace(/,(\s*[}\]])/g, "$1"));
}

/** A change to one of the library's sources, made as the bundle reads it. The text it replaces has to be there, so a change that no longer applies fails the test. */
type Mutation = { file: RegExp; from: string; to: string };

type Harness = { fake: unknown; host: { roots: Record<number, unknown[]>; warnings: string[] } };
type Probe = { node(name: string): unknown; counted(): unknown };
type Bundle = {
	Screen: unknown;
	startSurface(root: number, component: unknown, props: object): Probe;
	runHtmlChecks(probe: Probe | undefined, report: (name: string, passed: boolean, detail?: string) => void): Promise<void>;
	tick(): Promise<void>;
};

// The platform's modules as the package's own harness stubs them for the host (`tests/html-harness.ts`).
const platform = (reanimated: Record<string, string>): Record<string, string> => ({
	...reanimated,
	"react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
	"react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
	"react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
	"react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
	"react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null), openURL: () => Promise.resolve() };",
	"react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
	"react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
	"react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
	"react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
	"react-native/Libraries/Text/TextNativeComponent": "export {};",
	"react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
	"expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
	"react-native": "export const AppRegistry = { registerRunnable() {} };",
	"react-native/Libraries/Utilities/Appearance": "export const getColorScheme = () => 'light'; export const addChangeListener = () => ({ remove() {} });",
	"react-native/Libraries/Utilities/PixelRatio": "export default { get: () => 2, roundToNearestPixel: (value) => Math.round(value * 2) / 2 };",
	"react-native/Libraries/Utilities/Dimensions": "export default { get: () => ({ width: 400, height: 800 }), addEventListener: () => ({ remove() {} }) };",
	"@rasheed/svelte-native": "export const Text = null; export const View = null;",
});

async function load(table: unknown, mutations: readonly Mutation[] = []): Promise<{ bundle: Bundle; harness: Harness }> {
	const [{ componentOptions, lowersHtml }, { lowerPrimitives }, harness, { reanimatedStubs }] = await Promise.all([
		import(pathToFileURL(join(library, "src/compile-options.ts")).href) as Promise<{ componentOptions(path: string): Record<string, unknown>; lowersHtml(path: string): boolean }>,
		import(pathToFileURL(join(library, "src/lower.ts")).href) as Promise<{ lowerPrimitives(source: string, options: { filename: string; html: boolean; warn: (message: string) => void }): string }>,
		import(pathToFileURL(join(library, "tests/html-harness.ts")).href) as Promise<Harness>,
		import(pathToFileURL(join(library, "tests/reanimated-stubs.ts")).href) as Promise<{ reanimatedStubs: Record<string, string> }>,
	]);
	const stubs = platform(reanimatedStubs);
	const components = ["TextInput", "Switch", "Modal"];
	harness.host.warnings = [];
	const bundled = await build({
		stdin: {
			contents: `import Screen from ${JSON.stringify(join(platformDir, "src/lib/native/dev/HtmlScreen.svelte"))};
				import ${JSON.stringify(join(library, "src/css/load-table.ts"))};
				import { startSurface } from ${JSON.stringify(join(library, "src/fabric/host.ts"))};
				import { runHtmlChecks } from ${JSON.stringify(join(platformDir, "src/lib/native/dev/html-lab.ts"))};
				import { tick } from 'svelte';
				export { Screen, startSurface, runHtmlChecks, tick };`,
			resolveDir: platformDir,
		},
		bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, define: { __DEV__: "false" },
		plugins: [{
			name: "html-probe",
			setup(builder) {
				builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
					const applying = mutations.filter((mutation) => mutation.file.test(path));
					if (applying.length === 0) return undefined;
					let contents = await readFile(path, "utf8");
					for (const mutation of applying) {
						if (!contents.includes(mutation.from)) throw new Error(`the mutation of ${path} no longer applies: ${mutation.from}`);
						contents = contents.replace(mutation.from, mutation.to);
					}
					return { contents, loader: "ts" };
				});
				builder.onResolve({ filter: /^(react-native|expo-modules-core|@rasheed\/svelte-native$)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
				builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
				builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: join(library, "tests/view-configs-stub.ts") }));
				builder.onResolve({ filter: /^@rasheed\/svelte-native\/classes-table$/ }, (args) => ({ path: args.path, namespace: "classes-table" }));
				builder.onLoad({ filter: /.*/, namespace: "classes-table" }, () => ({ contents: `export default ${JSON.stringify(table)};`, loader: "js" }));
				builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: join(library, "src/renderer.ts") }));
				builder.onResolve({ filter: /^@rasheed\/svelte-native\/router$/ }, () => ({ path: join(library, "src/router.svelte.ts") }));
				builder.onResolve({ filter: /^@rasheed\/svelte-native\/core$/ }, () => ({ path: "core", namespace: "package" }));
				builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
					contents: components.map((name) => `export { default as ${name} } from ${JSON.stringify(join(library, `src/components/${name}.svelte`))};`).join("\n"),
					loader: "js", resolveDir: library,
				}));
				builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: join(library, "src/environment.ts") }));
				builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
					const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
					return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
				});
				// The way Metro's transformer does it, for the files it lowers HTML in (the lab's screen is the app's own).
				builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
					contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path, html: lowersHtml(path), warn: (message) => harness.host.warnings.push(message) }), componentOptions(path)).js.code,
					loader: "js",
				}));
			},
		}],
	});
	const directory = mkdtempSync(join(tmpdir(), "native-qa-html-bundle-"));
	made.push(directory);
	const file = join(directory, "bundle.mjs");
	writeFileSync(file, bundled.outputFiles[0]?.contents ?? "");
	// The bundled host reads `nativeFabricUIManager` when it is evaluated: the harness's fake goes in right before.
	(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = harness.fake;
	return { bundle: (await import(pathToFileURL(file).href)) as Bundle, harness };
}

let surface = 5_000;
/** Mounts the screen, lets the host draw it, runs the checks as the lab does and answers what each reported, by name. */
async function ran(table: unknown, mutations: readonly Mutation[] = []) {
	const { bundle } = await load(table, mutations);
	const probe = bundle.startSurface(surface++, bundle.Screen, {});
	for (let turn = 0; turn < 4; turn++) { await bundle.tick(); await Promise.resolve(); await Promise.resolve(); }
	const reports: { name: string; passed: boolean; detail: string }[] = [];
	await bundle.runHtmlChecks(probe, (name, passed, detail = "") => { reports.push({ name, passed, detail }); });
	return reports;
}
const failed = (reports: { name: string; passed: boolean }[]) => reports.filter((report) => !report.passed).map((report) => report.name);
const [inherit, row, block, heading, submit, password] = htmlCheckNames;

const host = /fabric\/host\.ts$/;

describe("the HTML checks on the host: the real table, lowering, renderer and Fabric host, with the platform stubbed", () => {
	test("the real host passes every check, in the order the lab reports them", async () => {
		const reports = await ran(builtTable());
		expect(reports.map((report) => report.name)).toEqual([...htmlCheckNames]);
		expect(failed(reports)).toEqual([]);
	}, 60_000);

	test("text style that does not reach the text (the host stops inheriting) fails the inheritance check and the heading's, whose size is twice the inherited one", async () => {
		const reports = await ran(builtTable(), [{ file: host, from: "if (above?.html) return above.textStyle;", to: "if (above?.html && false) return above.textStyle;" }]);
		expect(failed(reports)).toEqual([inherit, heading]);
	}, 60_000);

	test("a flex row the host does not lay out as items (its spans become one line) fails the row check", async () => {
		const reports = await ran(builtTable(), [{ file: /fabric\/html-flow\.ts$/, from: 'return layout.keyword === "flex" || layout.keyword === "inline-flex" || (layout.flexKeys?.size ?? 0) > 0;', to: "return false;" }]);
		expect(failed(reports)).toContain(row);
		expect(failed(reports)).not.toContain(block);
	}, 60_000);

	test("a block div whose spans the host makes items of their own (no line) fails the block check", async () => {
		const reports = await ran(builtTable(), [{ file: host, from: 'const inLine = !flex && child.kind === "element" && flowsInLine(child);', to: "const inLine = false;" }]);
		expect(failed(reports)).toContain(block);
		expect(failed(reports)).not.toContain(row);
	}, 60_000);

	test("a heading at the inherited size, not twice it, fails the heading check and only it", async () => {
		const reports = await ran(builtTable(), [{ file: host, from: "{ h1: 2, h2: 1.5,", to: "{ h1: 1, h2: 1.5," }]);
		expect(failed(reports)).toEqual([heading]);
	}, 60_000);

	test("a submission whose event cannot be prevented, or that never reaches the form, fails the submit check and only it", async () => {
		const unprevented = await ran(builtTable(), [{ file: /renderer\.ts$/, from: "preventDefault() { submit.defaultPrevented = true; }", to: "preventDefault() {}" }]);
		expect(failed(unprevented)).toEqual([submit]);
		const lost = await ran(builtTable(), [{ file: /renderer\.ts$/, from: 'node.dispatcher("submit")(submit);', to: "void submit;" }]);
		expect(failed(lost)).toEqual([submit]);
	}, 60_000);

	test("a button that is not a submit button but submits (the type is not read) fails the submit check", async () => {
		const reports = await ran(builtTable(), [{ file: /renderer\.ts$/, from: 'if (typeof type === "string" && type !== "" && type.toLowerCase() !== "submit") return;', to: "" }]);
		expect(failed(reports)).toEqual([submit]);
	}, 60_000);

	test("a password input the host does not hide fails the password check and only it", async () => {
		const reports = await ran(builtTable(), [{ file: /html-input\.ts$/, from: "password: { secureTextEntry: true,", to: "password: { secureTextEntry: false," }]);
		expect(failed(reports)).toEqual([password]);
	}, 60_000);

	test("the lab's files that are written in HTML lower and compile as the app's files do, with nothing to warn about: the screen, its route and the gestures page of the span press", async () => {
		const [{ componentOptions, lowersHtml }, { lowerPrimitives }] = await Promise.all([
			import(pathToFileURL(join(library, "src/compile-options.ts")).href) as Promise<{ componentOptions(path: string): Record<string, unknown>; lowersHtml(path: string): boolean }>,
			import(pathToFileURL(join(library, "src/lower.ts")).href) as Promise<{ lowerPrimitives(source: string, options: { filename: string; html: boolean; warn: (message: string) => void }): string }>,
		]);
		for (const file of ["src/lib/native/dev/HtmlScreen.svelte", "src/routes/__dev/html/+mobile.svelte", "src/lib/native/dev/gestures/Span.svelte"]) {
			const path = join(platformDir, file);
			const warnings: string[] = [];
			expect([file, lowersHtml(path)]).toEqual([file, true]);
			const lowered = lowerPrimitives(readFileSync(path, "utf8"), { filename: path, html: true, warn: (message) => warnings.push(message) });
			expect([file, warnings]).toEqual([file, []]);
			// no HTML element is left in the markup, and the file compiles with the library's options (the custom renderer)
			expect([file, /<(?:div|p|a|h1|form|input|button|hr|pre|span)[\s>]/.test(lowered.replace(/<script[\s\S]*?<\/script>/, ""))]).toEqual([file, false]);
			expect(() => compile(lowered, componentOptions(path))).not.toThrow();
		}
	}, 60_000);

	test("a screen that is not mounted is six failures, not a count that fell", async () => {
		const { bundle } = await load(builtTable());
		const reports: { name: string; passed: boolean; detail: string }[] = [];
		await bundle.runHtmlChecks(undefined, (name, passed, detail = "") => { reports.push({ name, passed, detail }); });
		expect(reports).toHaveLength(htmlCheckNames.length);
		expect(reports.every((report) => !report.passed && report.detail.includes("not mounted"))).toBe(true);
	}, 60_000);
});
