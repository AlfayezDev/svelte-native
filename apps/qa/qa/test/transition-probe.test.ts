import { mkdirSync, mkdtempSync, rmSync, symlinkSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";
import { build, transform } from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { transitionCheckNames } from "../../src/lib/native/dev/transition-checks.ts";
import { platformDir, svelteNativeCli } from "../lib/paths.ts";

/**
 * The transition checks of the native checks lab run on the host against the real pieces: the QA app's class table, the HTML lowering, Svelte's own transitions, the renderer, the Fabric host
 * (`fabric/host.ts`), the host's animation layer (`fabric/transitions.ts`, `fabric/animation.ts`) and the lab's runner (`transition-lab.ts`) on the lab's own screen (`TransitionsScreen.svelte`). What is a stand-in
 * is the platform: React Native's modules, a fake Fabric binding (a layout of the committed tree, with Reanimated's registry over the props of every commit, as its commit hook does) and Reanimated, in a
 * form that is not the package's recorder (`tests/support/reanimated-stubs.ts`, which the test moves by hand) but a UI thread of its own: a shared value animated `withTiming` is a function of a clock, the mappers
 * run each frame, the animation's callback is called when its time is up, and the JavaScript thread's timers run only when the test lets the clock go on, so a JavaScript thread that is busy (the lab's
 * own busy-wait on the clock) stands still while the UI side goes on. Time is virtual: a 300 ms block costs a few hundred reads of the clock.
 *
 * What this holds is that each check reads the thing its name says: it passes on the real animation layer and fails on the layer with that one thing broken, by a change to the library's source as the
 * bundle reads it.
 */
const library = resolve(platformDir, "../../packages/svelte-native");
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

/** The QA app's class table, built in a project of its own with the repository's Tailwind linked in (as `html-probe.test.ts` does). */
function builtTable(): unknown {
	const root = mkdtempSync(join(tmpdir(), "native-qa-transitions-"));
	made.push(root);
	mkdirSync(join(root, "src/lib"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	symlinkSync(dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json")), join(root, "node_modules/tailwindcss"));
	copyFileSync(join(platformDir, "src/global.css"), join(root, "src/global.css"));
	for (const file of ["TransitionsScreen.svelte", "transition-checks.ts", "transition-lab.ts"]) copyFileSync(join(platformDir, "src/lib/native/dev", file), join(root, "src/lib", file));
	const built = spawnSync(process.execPath, [svelteNativeCli, "css", "src/global.css", "--variant", "qa", "--json"], { cwd: root, encoding: "utf8" });
	if (built.status !== 0) throw new Error(`svelte-native css failed: ${built.stderr.slice(0, 400)}`);
	return JSON.parse(readFileSync(JSON.parse(built.stdout).file, "utf8").replace(/^[\s\S]*?export default /, "").replace(/\s+as typeof Table;\s*$/, "").replace(/,(\s*[}\]])/g, "$1"));
}

/** A change to one of the library's sources, made as the bundle reads it. The text it replaces has to be there, so a change that no longer applies fails the test. */
type Mutation = { file: RegExp; from: string; to: string };

type Probe = { node(name: string): unknown; seen(): readonly string[]; items(): readonly number[]; setShown(value: boolean): void; setOpen(value: boolean): void; shuffle(): void };
type Bundle = {
	Screen: unknown;
	startSurface(root: number, component: unknown, props: object): Probe;
	runTransitionChecks(probe: Probe | undefined, report: (name: string, passed: boolean, detail?: string) => void): Promise<void>;
	tick(): Promise<void>;
};

// ---- the fake Fabric binding: a layout of the committed tree, and Reanimated's registry over each commit ----

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown; family: object; shown?: Record<string, unknown> };
type Registry = { registry?: Map<number, Record<string, unknown>>; marked?: FakeNode[] };
const ROW = 50;
const surfaces: Record<number, FakeNode[]> = {};
const registryOf = () => (globalThis as { __anim?: Registry }).__anim;
const find = (nodes: FakeNode[], accept: (node: FakeNode) => boolean): FakeNode[] => nodes.flatMap((node) => [...(accept(node) ? [node] : []), ...find(node.children, accept)]);
/** The layout of the committed tree: a node is as wide as 100 and as high as 50 and sits at its index among its siblings times 50. */
function locate(target: FakeNode): { rect: number[]; path: FakeNode[] } | undefined {
	const search = (nodes: FakeNode[], path: FakeNode[]): { rect: number[]; path: FakeNode[] } | undefined => {
		let index = 0;
		for (const node of nodes) {
			if (node === target) return { rect: [0, index * ROW, 100, ROW], path: [...path, node] };
			index++;
			const found = search(node.children, [...path, node]);
			if (found) return found;
		}
		return undefined;
	};
	for (const nodes of Object.values(surfaces)) { const found = search(nodes, []); if (found) return found; }
	return undefined;
}
/** The box of the last node of [path] with the transforms the commit carries (the props, with Reanimated's registry over them) applied from the node up, about the centre of each one's layout box. */
function transformed(path: FakeNode[], rect: number[]): number[] {
	let [x, y, width, height] = rect as [number, number, number, number];
	for (let at = path.length - 1; at >= 0; at--) {
		const node = path[at] as FakeNode;
		const own = locate(node)?.rect as [number, number, number, number];
		const centre = { x: own[0] + own[2] / 2, y: own[1] + own[3] / 2 };
		let sx = 1; let sy = 1; let tx = 0; let ty = 0;
		for (const entry of ((node.shown ?? node.props).transform as Record<string, number>[] | null | undefined) ?? []) {
			sx *= entry.scale ?? entry.scaleX ?? 1; sy *= entry.scale ?? entry.scaleY ?? 1; tx += entry.translateX ?? 0; ty += entry.translateY ?? 0;
		}
		x = centre.x + sx * (x - centre.x) + tx; y = centre.y + sy * (y - centre.y) + ty; width *= sx; height *= sy;
	}
	return [x, y, width, height];
}
const fake = {
	createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown): FakeNode { return { tag, name, props: { ...props }, children: [], sealed: false, target, family: {} }; },
	cloneNodeWithNewChildren(node: FakeNode): FakeNode { return { ...node, children: [], sealed: false }; },
	cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>): FakeNode { return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
	cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>): FakeNode { return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
	appendChild(parent: FakeNode, child: FakeNode) { if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`); parent.children.push(child); },
	createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
	appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
	completeRoot(root: number, set: { children: FakeNode[] }) {
		const anim = registryOf();
		// The commit hook: what Reanimated's registry holds for a tag is put over the props of every commit of it. Then the mount: a shadow node that was marked removable and is in no tree lets the registry of its tag go.
		const seal = (node: FakeNode) => { node.sealed = true; node.shown = { ...node.props, ...anim?.registry?.get(node.tag) }; node.children.forEach(seal); };
		set.children.forEach(seal);
		surfaces[root] = set.children;
		const marked = anim?.marked ?? [];
		if (anim) anim.marked = [];
		for (const wrapper of marked) {
			const mounted = Object.values(surfaces).some((nodes) => find(nodes, (node) => node.family === wrapper.family).length > 0);
			if (!mounted) anim?.registry?.delete(wrapper.tag);
		}
	},
	/** React Native's synchronous layout read of the committed tree: the box of the node, with the committed transform of the chain when [includeTransform]. */
	getBoundingClientRect(node: FakeNode, includeTransform: boolean): number[] | undefined {
		const found = locate(node);
		return found ? (includeTransform ? transformed(found.path, found.rect) : found.rect) : undefined;
	},
	measure() {},
	measureInWindow() {},
	dispatchCommand() {},
	registerEventHandler() {},
};

// ---- Reanimated, with a UI thread of its own ----

type Timing = { m: { _value: number; timing: Timing | null }; from: number; to: number; start: number; config: { duration: number }; callback?: (finished: boolean) => void };
type Ui = { now: number; active: Set<Timing> };

/**
 * `react-native-reanimated` for the bundle: the package's recorder (`tests/support/reanimated-stubs.ts`: mappers, the props registry, view descriptors) with `makeMutable` and `withTiming` made a UI thread's.
 * A shared value that is animated is read as a function of the clock (`globalThis.__ui.now`) from any thread, as Reanimated's is; the test's frame ends the animations whose time is up (the callback) and runs
 * the mappers. A write of a number takes the animation off, as a write does.
 */
const reanimated = `
	const A = (globalThis.__anim ??= { descriptors: [], mappers: [], updates: [], css: [], removable: [] });
	const U = globalThis.__ui;
	export const makeMutable = (initial) => {
		const m = { _value: initial, timing: null, _isReanimatedSharedValue: true,
			get value() { const t = this.timing; if (!t) return this._value; const p = Math.min(1, Math.max(0, (U.now - t.start) / t.config.duration)); return t.from + (t.to - t.from) * p; },
			set value(next) {
				if (this.timing) { U.active.delete(this.timing); this.timing = null; }
				if (next && next.__timing) { const t = { m: this, from: this.value, to: next.to, start: U.now, config: next.config, callback: next.callback }; this.timing = t; U.active.add(t); }
				else this._value = next;
			} };
		return m;
	};
	export const Easing = { linear: function linear(t) { return t; } };
	export const withTiming = (to, config, callback) => ({ __timing: true, to, config, callback });
	export const cancelAnimation = (m) => { const t = m.timing; if (!t) return; m._value = m.value; U.active.delete(t); m.timing = null; t.callback?.(false); };
	export const setGestureState = () => {};
	export const isSharedValue = (v) => v?._isReanimatedSharedValue === true;
	export const startMapper = (worklet, inputs) => { const id = A.mappers.length + 1; A.mappers.push({ id, worklet, inputs, stopped: false }); return id; };
	export const stopMapper = (id) => { A.mappers.find((m) => m.id === id).stopped = true; };`;

// The platform's modules as the package's own harness stubs them for the host (`tests/support/html-harness.ts`).
const platform = (recorder: Record<string, string>): Record<string, string> => ({
	...recorder,
	"react-native-reanimated": reanimated,
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
	"@alfayez/svelte-native": "export const Text = null; export const View = null;",
});

type Harness = { host: { warnings: string[] } };
async function load(table: unknown, mutations: readonly Mutation[]): Promise<Bundle> {
	const [{ componentOptions, lowersHtml }, { lowerPrimitives }, harness, { reanimatedStubs }, { vendorAliases }] = await Promise.all([
		import(pathToFileURL(join(library, "src/compile-options.ts")).href) as Promise<{ componentOptions(path: string): Record<string, unknown>; lowersHtml(path: string): boolean }>,
		import(pathToFileURL(join(library, "src/lower.ts")).href) as Promise<{ lowerPrimitives(source: string, options: { filename: string; html: boolean; warn: (message: string) => void }): string }>,
		import(pathToFileURL(join(library, "tests/support/html-harness.ts")).href) as Promise<Harness>,
		import(pathToFileURL(join(library, "tests/support/reanimated-stubs.ts")).href) as Promise<{ reanimatedStubs: Record<string, string> }>,
		import(pathToFileURL(join(library, "tests/support/paths.ts")).href) as Promise<{ vendorAliases(): Record<string, string> }>,
	]);
	const stubs = platform(reanimatedStubs);
	const components = ["TextInput", "Switch", "Modal"];
	harness.host.warnings = [];
	const bundled = await build({
		stdin: {
			contents: `import Screen from ${JSON.stringify(join(platformDir, "src/lib/native/dev/TransitionsScreen.svelte"))};
				import ${JSON.stringify(join(library, "src/css/load-table.ts"))};
				import { startSurface } from ${JSON.stringify(join(library, "src/fabric/host.ts"))};
				import { runTransitionChecks } from ${JSON.stringify(join(platformDir, "src/lib/native/dev/transition-lab.ts"))};
				import { tick } from 'svelte';
				export { Screen, startSurface, runTransitionChecks, tick };`,
			resolveDir: platformDir,
		},
		bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, define: { __DEV__: "false" },
		// What Metro does for every importer: the names of the packages the library carries (and every path below them) are its copies in vendor/.
		alias: vendorAliases(),
		plugins: [{
			name: "transition-probe",
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
				// The packages the library carries are imported as `#vendor/<name>` by its own sources, and by name by the rest: the stand-ins are written for the names. Gesture handler is the one that is real.
				builder.onResolve({ filter: /^(react-native|expo-modules-core|@alfayez\/svelte-native$|#vendor\/)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
				builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? stubs[args.path.replace(/^#vendor\//, "")] ?? "export {};", loader: "js" }));
				builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: join(library, "tests/support/view-configs-stub.ts") }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/classes-table$/ }, (args) => ({ path: args.path, namespace: "classes-table" }));
				builder.onLoad({ filter: /.*/, namespace: "classes-table" }, () => ({ contents: `export default ${JSON.stringify(table)};`, loader: "js" }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: join(library, "src/renderer.ts") }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/router$/ }, () => ({ path: join(library, "src/router.svelte.ts") }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/core$/ }, () => ({ path: "core", namespace: "package" }));
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
	const directory = mkdtempSync(join(tmpdir(), "native-qa-transitions-bundle-"));
	made.push(directory);
	const file = join(directory, "bundle.mjs");
	writeFileSync(file, bundled.outputFiles[0]?.contents ?? "");
	// The bundled host reads `nativeFabricUIManager` when it is evaluated: the fake goes in right before.
	(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;
	return (await import(pathToFileURL(file).href)) as Bundle;
}

// ---- the virtual clock: JavaScript's timers and clock, and the UI thread's frame ----

/** Every macrotask turn lets all the microtasks that are queued, and the ones those queue, run. */
const turn = () => new Promise<void>((done) => { setImmediate(done); });

/**
 * Takes over the timers and the clock for one run. A read of `Date.now()` or `performance.now()` moves the clock a little (a JavaScript thread that waits on the clock must see it go on), `step` moves it by a
 * frame: the timers that are due run (the JavaScript thread), then the UI thread's frame (the animations whose time is up call back, the mappers write), and the microtasks that came of them run.
 */
function virtualTime(ui: Ui) {
	const original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, now: Date.now, performanceNow: performance.now };
	let next = 1;
	let timers: { id: number; at: number; run: () => void; every: number | null }[] = [];
	const epoch = 1_700_000_000_000;
	const read = () => { ui.now += 0.25; return ui.now; };
	const add = (run: () => void, ms: number | undefined, every: boolean) => { const id = next++; timers.push({ id, at: ui.now + Math.max(0, Number(ms ?? 0)), run, every: every ? Math.max(1, Number(ms ?? 0)) : null }); return id; };
	globalThis.setTimeout = ((run: () => void, ms?: number) => add(run, ms, false)) as unknown as typeof setTimeout;
	globalThis.setInterval = ((run: () => void, ms?: number) => add(run, ms, true)) as unknown as typeof setInterval;
	globalThis.clearTimeout = globalThis.clearInterval = ((id: number) => { timers = timers.filter((timer) => timer.id !== id); }) as typeof clearTimeout;
	Date.now = () => epoch + read();
	performance.now = () => read();
	const uiFrame = () => {
		for (const timing of [...ui.active]) {
			if (ui.now < timing.start + timing.config.duration) continue;
			ui.active.delete(timing);
			timing.m._value = timing.to;
			timing.m.timing = null;
			timing.callback?.(true);
		}
		const anim = (globalThis as { __anim?: { mappers: { stopped: boolean; worklet: () => void }[] } }).__anim;
		for (const mapper of (anim?.mappers ?? []).filter((entry) => !entry.stopped)) mapper.worklet();
	};
	return {
		async step(ms = 16) {
			const end = ui.now + ms;
			for (;;) {
				const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
				if (!due) break;
				ui.now = Math.max(ui.now, due.at);
				if (due.every === null) timers = timers.filter((timer) => timer !== due);
				else due.at = ui.now + due.every;
				due.run();
				await turn();
			}
			ui.now = Math.max(ui.now, end);
			uiFrame();
			await turn();
		},
		restore() {
			Object.assign(globalThis, { setTimeout: original.setTimeout, clearTimeout: original.clearTimeout, setInterval: original.setInterval, clearInterval: original.clearInterval });
			Date.now = original.now;
			performance.now = original.performanceNow;
		},
	};
}

let surface = 7_000;
/** Mounts the screen, lets the host draw it, runs the checks as the lab does (the JavaScript thread's timers and the UI thread's frames driven in 16 ms steps) and answers what each reported, by name. */
async function ran(table: unknown, mutations: readonly Mutation[] = []) {
	delete (globalThis as { __anim?: unknown }).__anim;
	const ui: Ui = { now: 0, active: new Set() };
	(globalThis as { __ui?: Ui }).__ui = ui;
	const bundle = await load(table, mutations);
	const clock = virtualTime(ui);
	try {
		const probe = bundle.startSurface(surface++, bundle.Screen, {});
		for (let step = 0; step < 4; step++) await clock.step();
		const reports: { name: string; passed: boolean; detail: string }[] = [];
		let finished = false;
		const running = bundle.runTransitionChecks(probe, (name, passed, detail = "") => { reports.push({ name, passed, detail }); }).finally(() => { finished = true; });
		let steps = 0;
		for (; !finished && steps < 3_000; steps++) await clock.step();
		await running;
		return { reports, steps, ms: ui.now };
	} finally {
		clock.restore();
	}
}
const failed = (reports: { name: string; passed: boolean }[]) => reports.filter((report) => !report.passed).map((report) => report.name);
const [intro, outro, flip, reversed, busy] = transitionCheckNames;
const transitions = /fabric\/transitions\.ts$/;

describe("the transition checks on the host: the real table, lowering, Svelte's transitions, renderer, Fabric host and animation layer, with the platform stubbed", () => {
	test("the real animation layer passes every check, in the order the lab reports them, in a few seconds of the UI thread's time", async () => {
		const { reports, ms } = await ran(builtTable());
		expect(reports.map((report) => report.name)).toEqual([...transitionCheckNames]);
		expect(reports.filter((report) => !report.passed)).toEqual([]);
		expect(ms).toBeLessThan(15_000);
	}, 120_000);

	test("an animation that stays on its element after it is over (the worklet and the view's mark are never taken off) fails the intro check", async () => {
		const reports = await ran(builtTable(), [{ file: transitions, from: "if (state.entries.length === 0 && state.restore === null) return;", to: "" }]);
		expect(failed(reports.reports)).toEqual([intro]);
		expect(reports.reports.find((report) => report.name === intro)?.detail).toContain("animatedStyle true");
	}, 120_000);

	test("an outro that ends at once, and not after its duration (the node leaves before half of it), fails the outro check", async () => {
		const reports = await ran(builtTable(), [{ file: transitions, from: "progress.value = withTiming(1, { duration: spec.total, easing: Easing.linear }", to: 'progress.value = withTiming(1, { duration: spec.keys.includes("transform") && spec.keys.includes("opacity") ? 1 : spec.total, easing: Easing.linear }' }]);
		expect(failed(reports.reports)).toEqual([outro]);
		expect(reports.reports.find((report) => report.name === outro)?.detail).toContain("attached at half false");
	}, 120_000);

	test("an item that, when its flip ends, is put back at the first frame (Reanimated's last values of it are the animation's start, not the node's own) fails the flip check", async () => {
		const reports = await ran(builtTable(), [{
			file: transitions,
			from: "state.restore = { ...state.restore, ...restoreValues(playback.spec, own) };",
			to: "{ const first: Values = {}; sampleSpec(playback.spec, 0, first); state.restore = { ...state.restore, ...first }; }",
		}]);
		expect(failed(reports.reports)).toEqual([flip]);
		expect(reports.reports.find((report) => report.name === flip)?.detail).toMatch(/moved (?!0\b)/);
	}, 120_000);

	test("values to write back that are never given up once the node has left the tree (the acknowledgement skips a node with no parent) stay on the node that left, and fail the reversal check", async () => {
		const reports = await ran(builtTable(), [{
			file: transitions,
			from: "stopMapper(id);\n      if (state.generation !== generation || state.restore === null) return;",
			to: "stopMapper(id);\n      if (state.generation !== generation || state.restore === null || node.parent === null) return;",
		}]);
		expect(failed(reports.reports)).toEqual([reversed]);
		expect(reports.reports.find((report) => report.name === reversed)?.detail).toContain("restore pending true");
	}, 120_000);

	test("progress that the JavaScript thread moves (a timer, not the UI runtime's shared value) stands still while JS is blocked and fails the check of the UI thread", async () => {
		const reports = await ran(builtTable(), [{
			file: transitions,
			from: `progress.value = withTiming(1, { duration: spec.total, easing: Easing.linear }, (finished) => {
        "worklet";
        if (finished) scheduleOnRN(done);
      });`,
			to: `const startedAt = Date.now();
      const tick = setInterval(() => { const at = Math.min(1, (Date.now() - startedAt) / spec.total); progress.value = at; if (at >= 1) { clearInterval(tick); done(); } }, 16);`,
		}]);
		expect(failed(reports.reports)).toEqual([busy]);
		expect(reports.reports.find((report) => report.name === busy)?.detail).toMatch(/progress [\d.]+ -> [\d.]+ ms/);
	}, 120_000);

	test("a screen that is not mounted is five failures, not a count that fell", async () => {
		const ui: Ui = { now: 0, active: new Set() };
		(globalThis as { __ui?: Ui }).__ui = ui;
		const bundle = await load(builtTable(), []);
		const reports: { name: string; passed: boolean; detail: string }[] = [];
		await bundle.runTransitionChecks(undefined, (name, passed, detail = "") => { reports.push({ name, passed, detail }); });
		expect(reports).toHaveLength(transitionCheckNames.length);
		expect(reports.every((report) => !report.passed && report.detail.includes("not mounted"))).toBe(true);
	}, 120_000);

	test("the lab's files written in HTML lower and compile as the app's files do, with nothing to warn about: the screen and its route", async () => {
		const [{ componentOptions, lowersHtml }, { lowerPrimitives }, { compile }] = await Promise.all([
			import(pathToFileURL(join(library, "src/compile-options.ts")).href) as Promise<{ componentOptions(path: string): Record<string, unknown>; lowersHtml(path: string): boolean }>,
			import(pathToFileURL(join(library, "src/lower.ts")).href) as Promise<{ lowerPrimitives(source: string, options: { filename: string; html: boolean; warn: (message: string) => void }): string }>,
			import("svelte/compiler"),
		]);
		for (const file of ["src/lib/native/dev/TransitionsScreen.svelte", "src/routes/__dev/transitions/+mobile.svelte"]) {
			const path = join(platformDir, file);
			const warnings: string[] = [];
			expect([file, lowersHtml(path)]).toEqual([file, true]);
			const lowered = lowerPrimitives(readFileSync(path, "utf8"), { filename: path, html: true, warn: (message) => warnings.push(message) });
			expect([file, warnings]).toEqual([file, []]);
			expect([file, /<(?:div|p|ul|li|button)[\s>]/.test(lowered.replace(/<script[\s\S]*?<\/script>/, ""))]).toEqual([file, false]);
			expect(() => compile(lowered, componentOptions(path) as never)).not.toThrow();
		}
	}, 120_000);
});
