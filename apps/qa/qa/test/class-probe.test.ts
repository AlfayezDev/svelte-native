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
import { classCheckNames } from "../../src/lib/native/dev/class-checks.ts";
import { platformDir, svelteNativeCli } from "../lib/paths.ts";

/**
 * The class checks of the native checks lab run on the host, against the real pieces: the QA app's class table (what `svelte-native css` makes of `src/global.css`), the library's renderer and class resolver,
 * the probe's own component (`ClassProbe.svelte`, lowered as the app's transformer lowers it) and the lab's runner (`class-lab.ts`). Only the platform is a stand-in: React Native's `Appearance`, `Dimensions`
 * and `Platform` (the device's scheme and window), and the host handles that `ref` gives (a layout). What this holds is that `{@attach}` on a lowered view hands out the renderer's node, that its props carry the
 * resolved class, and that the runner reads every check as passing when the table and the resolver are right; the device then reads the same of its own bundle, scheme and layout.
 */
const library = resolve(platformDir, "../../packages/svelte-native");
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

/** The QA app's class table, built in a project of its own with the repository's Tailwind linked in (as `class-checks.test.ts` does). */
function builtTable(): unknown {
	const root = mkdtempSync(join(tmpdir(), "native-qa-probe-"));
	made.push(root);
	mkdirSync(join(root, "src/lib"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	symlinkSync(dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json")), join(root, "node_modules/tailwindcss"));
	copyFileSync(join(platformDir, "src/global.css"), join(root, "src/global.css"));
	for (const file of ["ClassProbe.svelte", "class-checks.ts", "class-lab.ts"]) copyFileSync(join(platformDir, "src/lib/native/dev", file), join(root, "src/lib", file));
	const built = spawnSync(process.execPath, [svelteNativeCli, "css", "src/global.css", "--variant", "qa", "--json"], { cwd: root, encoding: "utf8" });
	if (built.status !== 0) throw new Error(`svelte-native css failed: ${built.stderr.slice(0, 400)}`);
	return JSON.parse(readFileSync(JSON.parse(built.stdout).file, "utf8").replace(/^[\s\S]*?export default /, "").replace(/\s+as typeof Table;\s*$/, "").replace(/,(\s*[}\]])/g, "$1"));
}

type Stub = { scheme: "light" | "dark"; appearance: Set<(preferences: { colorScheme: string }) => void>; window: { width: number; height: number }; windowListeners: Set<() => void> };
const stub: Stub = { scheme: "light", appearance: new Set(), window: { width: 411, height: 900 }, windowListeners: new Set() };
(globalThis as { __probe?: Stub & { overrides: string[] } }).__probe = Object.assign(stub, { overrides: [] as string[] });

// The platform modules the resolver and the runner read. `setColorScheme` answers as the device does: the scheme changes at once for whoever asks, and the change is announced a moment later.
const appearanceModule = `const stub = globalThis.__probe;
  const system = "light";
  export const getColorScheme = () => stub.scheme;
  export const setColorScheme = (scheme) => {
    stub.overrides.push(scheme);
    stub.scheme = scheme === "unspecified" ? system : scheme;
    setTimeout(() => { for (const listener of [...stub.appearance]) listener({ colorScheme: stub.scheme }); }, 20);
  };
  export const addChangeListener = (listener) => { stub.appearance.add(listener); return { remove() { stub.appearance.delete(listener); } }; };`;
const dimensionsModule = `const stub = globalThis.__probe;
  export default { get: () => stub.window, addEventListener: (type, listener) => { stub.windowListeners.add(listener); return { remove() { stub.windowListeners.delete(listener); } }; } };`;
const platformModule = `export default { OS: "android", Version: 36 };`;
const expoModulesCore = `export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;`;

/** A change to one of the library's sources, made as the bundle reads it: the broken variant a check must fail on. The text it replaces has to be there, so a change that no longer applies fails the test. */
type Mutation = { file: RegExp; from: string; to: string };

async function load(table: unknown, mutations: readonly Mutation[] = []) {
	const [{ componentOptions }, { lowerPrimitives }] = await Promise.all([
		import(pathToFileURL(join(library, "src/compile-options.ts")).href) as Promise<{ componentOptions(path: string): Record<string, unknown> }>,
		import(pathToFileURL(join(library, "src/lower.ts")).href) as Promise<{ lowerPrimitives(source: string, options: { filename: string }): string }>,
	]);
	const bundle = await build({
		stdin: {
			contents: `import ClassProbe from '${join(platformDir, "src/lib/native/dev/ClassProbe.svelte")}';
				import renderer, { NativeNode } from '${join(library, "src/renderer.ts")}';
				import '${join(library, "src/css/load-table.ts")}';
				import { runClassChecks } from '${join(platformDir, "src/lib/native/dev/class-lab.ts")}';
				import { mount, tick, unmount } from 'svelte';
				export { ClassProbe, renderer, NativeNode, runClassChecks, mount, tick, unmount };`,
			resolveDir: platformDir,
		},
		bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, define: { __DEV__: "true" },
		plugins: [{
			name: "class-probe",
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
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/classes-table$/ }, (args) => ({ path: args.path, namespace: "classes-table" }));
				builder.onLoad({ filter: /.*/, namespace: "classes-table" }, () => ({ contents: `export default ${JSON.stringify(table)};`, loader: "js" }));
				builder.onResolve({ filter: /^react-native\/Libraries\/Utilities\/(Appearance|Dimensions|Platform)$/ }, (args) => ({ path: args.path, namespace: "react-native" }));
				builder.onLoad({ filter: /.*/, namespace: "react-native" }, (args) => ({ contents: args.path.endsWith("Appearance") ? appearanceModule : args.path.endsWith("Dimensions") ? dimensionsModule : platformModule, loader: "js" }));
				builder.onResolve({ filter: /^react-native\/Libraries\// }, (args) => ({ path: args.path, namespace: "stub" }));
				builder.onResolve({ filter: /^(react-native|expo-modules-core|expo-constants)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
				builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: args.path === "expo-modules-core" ? expoModulesCore : "export {};", loader: "js" }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: join(library, "src/renderer.ts") }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native\/platform$/ }, () => ({ path: join(library, "src/platform.ts") }));
				builder.onResolve({ filter: /^@alfayez\/svelte-native$/ }, () => ({ path: "primitives", namespace: "package" }));
				builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
					contents: `export { default as View } from ${JSON.stringify(join(library, "src/components/View.svelte"))};
						export { default as Text } from ${JSON.stringify(join(library, "src/components/Text.svelte"))};`,
					loader: "js", resolveDir: library,
				}));
				builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: join(library, "src/environment.ts") }));
				// The probe's theme (the app's state module reads React Native): plain colours.
				builder.onResolve({ filter: /\/state\.svelte\.ts$/ }, () => ({ path: "theme", namespace: "theme" }));
				builder.onLoad({ filter: /.*/, namespace: "theme" }, () => ({ contents: `export const theme = { border: "#d6d8dd", muted: "#6b7078", foreground: "#191b1e" };`, loader: "js" }));
				builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
					const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
					return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
				});
				builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
					const source = await readFile(path, "utf8");
					// The app's transformer lowers the primitives of every page and component of the app; the library's own components are compiled as they are.
					const lowered = path.startsWith(library) ? source : lowerPrimitives(source, { filename: path });
					return { contents: compile(lowered, componentOptions(path)).js.code, loader: "js" };
				});
			},
		}],
	});
	const directory = mkdtempSync(join(tmpdir(), "native-qa-probe-bundle-"));
	made.push(directory);
	const file = join(directory, "bundle.mjs");
	writeFileSync(file, bundle.outputFiles[0]?.contents ?? "");
	return import(pathToFileURL(file).href) as Promise<{
		ClassProbe: unknown; renderer: unknown; NativeNode: new (kind: string) => unknown;
		runClassChecks(probe: unknown, report: (name: string, passed: boolean, detail?: string) => void): Promise<void>;
		mount(component: unknown, options: Record<string, unknown>): { node(name: string): unknown; handles(): unknown; setWide(next: boolean): void };
		tick(): Promise<void>; unmount(app: unknown): void;
	}>;
}

/** Mounts the probe, runs the class checks as the lab does (a layout stands in for `ref`) and answers what each reported, by name. */
async function ran(m: Awaited<ReturnType<typeof load>>) {
	const app = m.mount(m.ClassProbe, { target: new m.NativeNode("fragment"), renderer: m.renderer, props: {} });
	await m.tick();
	const at = (x: number, y: number, width: number, height: number) => ({ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(x, y, width, height) });
	const reports: { name: string; passed: boolean; detail: string }[] = [];
	await m.runClassChecks({ node: app.node, setWide: app.setWide, handles: () => ({ parent: at(10, 20, 72, 52), child: at(26, 36, 40, 20) }) }, (name, passed, detail = "") => { reports.push({ name, passed, detail }); });
	m.unmount(app);
	return reports;
}
const failed = (reports: { name: string; passed: boolean }[]) => reports.filter((report) => !report.passed).map((report) => report.name);

describe("the class checks on the host: the real table, resolver, renderer and probe, with the platform stubbed", () => {
	test("the probe's views hand out their nodes, with the class resolved into their props, and every check reads as passing", async () => {
		const m = await load(builtTable());
		const root = new m.NativeNode("fragment");
		const app = m.mount(m.ClassProbe, { target: root, renderer: m.renderer, props: {} });
		await m.tick();
		const prop = (name: string, key: string) => (app.node(name) as { getProp(key: string): unknown } | undefined)?.getProp(key);
		// the node is the renderer's own, and it holds what `hostClass` made of the class under the element's own style
		expect(prop("padding", "nativeClass")).toEqual({ alignSelf: "flex-start", paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 });
		expect(prop("tint", "nativeClass")).toMatchObject({ width: 32, height: 32, backgroundColor: "rgba(0, 166, 244, 0.5)" });
		expect(prop("inline", "nativeStyle")).toEqual({ backgroundColor: "#f97316" });

		const reports: { name: string; passed: boolean; detail: string }[] = [];
		// What `ref` gives on the device: the windows of the padded view and its child (the 40 x 20 child sits in the 16 dp padding).
		const at = (x: number, y: number, width: number, height: number) => ({ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(x, y, width, height) });
		const probe = { node: app.node, setWide: app.setWide, handles: () => ({ parent: at(10, 20, 72, 52), child: at(26, 36, 40, 20) }) };
		await m.runClassChecks(probe, (name, passed, detail = "") => { reports.push({ name, passed, detail }); });
		expect(reports.map((report) => report.name)).toEqual([...classCheckNames]);
		expect(reports.filter((report) => !report.passed)).toEqual([]);
		// the scheme was overridden to the other one and given back, once each; nothing was left over
		expect((globalThis as unknown as { __probe: { overrides: string[] } }).__probe.overrides).toEqual(["dark", "unspecified"]);
		m.unmount(app);
	}, 60_000);

	test("a tablet-width window has the md: padding, and the check follows it", async () => {
		stub.window = { width: 800, height: 1200 };
		try {
			const m = await load(builtTable());
			const app = m.mount(m.ClassProbe, { target: new m.NativeNode("fragment"), renderer: m.renderer, props: {} });
			await m.tick();
			expect((app.node("responsive") as { getProp(key: string): unknown }).getProp("nativeClass")).toMatchObject({ paddingTop: 40 });
			expect((app.node("capped") as { getProp(key: string): unknown }).getProp("nativeClass")).toMatchObject({ paddingTop: 8 });
			const reports: { name: string; passed: boolean }[] = [];
			const at = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 10, 10) };
			await m.runClassChecks({ node: app.node, setWide: app.setWide, handles: () => ({ parent: at, child: at }) }, (name, passed) => { reports.push({ name, passed }); });
			expect(reports.find((report) => report.name === classCheckNames[3])?.passed).toBe(true);
			m.unmount(app);
		} finally {
			stub.window = { width: 411, height: 900 };
		}
	}, 60_000);

	test("an inline style that the host puts under the class instead of over it fails the inline check, and only it (the real merge, with its order swapped)", async () => {
		const table = builtTable();
		// `native-props.ts`: the line that puts the class under the element's own style
		const swapped: Mutation = { file: /native-props\.ts$/, from: "[fromClass, merged.style]", to: "[merged.style, fromClass]" };
		expect(failed(await ran(await load(table)))).toEqual([]);
		expect(failed(await ran(await load(table, [swapped])))).toEqual([classCheckNames[7]]);
	}, 60_000);

	test("the window width: a resolver that applies md: everywhere, or max-md: everywhere, fails the breakpoint check on a phone", async () => {
		const table = builtTable();
		const always: Mutation = { file: /css\/runtime\.ts$/, from: "if (when.minWidth !== undefined && width < when.minWidth) return false;", to: "" };
		const never: Mutation = { file: /css\/runtime\.ts$/, from: "if (when.maxWidth !== undefined && width >= when.maxWidth) return false;", to: "if (when.maxWidth !== undefined) return false;" };
		expect(failed(await ran(await load(table)))).toEqual([]);
		expect(failed(await ran(await load(table, [always])))).toEqual([classCheckNames[3]]);
		expect(failed(await ran(await load(table, [never])))).toEqual([classCheckNames[3]]);
	}, 60_000);

	test("a probe that is not mounted is ten failures, not a count that fell", async () => {
		const m = await load(builtTable());
		const reports: { name: string; passed: boolean; detail: string }[] = [];
		await m.runClassChecks(undefined, (name, passed, detail = "") => { reports.push({ name, passed, detail }); });
		expect(reports).toHaveLength(classCheckNames.length);
		expect(reports.every((report) => !report.passed && report.detail.includes("not mounted"))).toBe(true);
	}, 60_000);
});
