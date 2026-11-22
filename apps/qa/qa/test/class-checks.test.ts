import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { htmlCheckNames } from "../../src/lib/native/dev/html-checks.ts";
import { transitionCheckNames } from "../../src/lib/native/dev/transition-checks.ts";
import { allSides, classCheckNames, classStyle, expectations, flattenStyle, isColor, mdBreakpoint, parseColor, sentStyle, sides, sky500, white, zinc400, zinc900, type Style } from "../../src/lib/native/dev/class-checks.ts";
import type { GatesFile } from "../lib/gates.ts";
import { platformDir, expoSvelteCli } from "../lib/paths.ts";
import { sample } from "./sample.ts";

/**
 * The class checks of the native checks lab (`src/lib/native/dev/class-checks.ts`, `class-lab.ts`, `ClassProbe.svelte`): the device reads what a mounted view's classes became; here the host holds what it is
 * asked to expect against what the build makes of `src/global.css` (Tailwind 4.3.3 and the library's converter, the same code Metro runs), and holds the number of checks the gates pin against the page.
 */
const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as GatesFile;
const source = (path: string) => readFileSync(join(platformDir, path), "utf8");
const page = source("src/routes/__dev/+mobile.svelte");
const probe = source("src/lib/native/dev/ClassProbe.svelte");

describe("the number of functional checks", () => {
	/** The checks the page's own runner makes (Svelte's runes, bindings, blocks and the Reanimated one): every `check("...")` of `+mobile.svelte` but the three that report an exception. */
	const own = [...page.matchAll(/\bcheck\("([^"]+)"/g)].map((match) => match[1] ?? "").filter((name) => !name.endsWith("completed"));

	test("28 of the page's own, one for each class check, each HTML check and each transition check: 49", () => {
		expect(own).toHaveLength(28);
		expect(classCheckNames).toHaveLength(10);
		expect(htmlCheckNames).toHaveLength(6);
		expect(transitionCheckNames).toHaveLength(5);
		expect(new Set([...classCheckNames, ...htmlCheckNames, ...transitionCheckNames]).size).toBe(classCheckNames.length + htmlCheckNames.length + transitionCheckNames.length);
		const total = own.length + classCheckNames.length + htmlCheckNames.length + transitionCheckNames.length;
		const bar = gates.gates.find((gate) => gate.id === "checks.passed")?.bar;
		expect(bar).toEqual({ android: { min: total }, ios: { min: total } });
		expect(gates.gates.find((gate) => gate.id === "checks.passed")?.title).toBe(`Functional checks passed (of ${total})`);
	});

	test("the page calls the class checks after its own, the HTML checks after those and the transition checks last, once each", () => {
		expect(page.match(/runClassChecks\(/g)).toHaveLength(1);
		expect(page.match(/runHtmlChecks\(/g)).toHaveLength(1);
		expect(page.match(/runTransitionChecks\(/g)).toHaveLength(1);
		expect(page.indexOf("await verifyAnimation();")).toBeLessThan(page.indexOf("runClassChecks("));
		expect(page.indexOf("runClassChecks(")).toBeLessThan(page.indexOf("runHtmlChecks("));
		expect(page.indexOf("runHtmlChecks(")).toBeLessThan(page.indexOf("runTransitionChecks("));
	});

	test("the lab's result line stays under logcat's 4 KB cut with all of them passing (a passing check carries no detail)", () => {
		// The Android harness counts the entries of one logcat line (`parseLabChecks`): an entry cut off by the limit is a check that never happened. The line of the 28-check run read 2,224 characters.
		const line = sample("lab-run.log").split("\n").find((entry) => entry.includes('"phase":"checks"')) ?? "";
		expect(line.length).toBeGreaterThan(2000);
		const added = [...classCheckNames, ...htmlCheckNames, ...transitionCheckNames].reduce((sum, name) => sum + JSON.stringify({ name, passed: true, detail: "" }).length + 1, 0);
		// 49 checks: about 3,700 characters, and logcat's entry holds 4,068 bytes, with the header's few fields (the token, the build, the error count) that the old sample does not have: 3,750 leaves them 300
		expect(line.length + added).toBeLessThan(3750);
	});
});

describe("reading a mounted node's props", () => {
	const node = (props: Record<string, unknown>) => ({ getProp: (key: string) => props[key], peekProps: () => props });

	test("a style is flattened the way React Native does: arrays and falsy values, the later entry wins", () => {
		expect(flattenStyle([{ a: 1, b: 1 }, false, null, [{ b: 2 }, undefined], { c: 3 }])).toEqual({ a: 1, b: 2, c: 3 });
		expect(flattenStyle(undefined)).toEqual({});
		expect(flattenStyle("width: 1px")).toEqual({});
	});

	test("what the host sends is read from the props it built, and the class alone from the node's own attribute", () => {
		// `sent` is what `mergeHostProps` gives (class-probe.test.ts runs the real one): the check takes its `style` as it is, and does not merge anything itself
		expect(sentStyle({ style: [{ backgroundColor: "#9f9fa9", padding: 4 }, { backgroundColor: "#f97316" }] })).toEqual({ backgroundColor: "#f97316", padding: 4 });
		expect(sentStyle({ style: [{ backgroundColor: "#f97316" }, { backgroundColor: "#9f9fa9" }] })).toEqual({ backgroundColor: "#9f9fa9" });
		expect(sentStyle({})).toEqual({});
		expect(classStyle(node({ nativeClass: { backgroundColor: "#9f9fa9", padding: 4 }, nativeStyle: { backgroundColor: "#f97316" } }))).toEqual({ backgroundColor: "#9f9fa9", padding: 4 });
	});

	test("the four sides of padding, from the shorthand, the pairs or the sides", () => {
		expect(sides({ padding: 16 }, "padding")).toEqual([16, 16, 16, 16]);
		expect(sides({ paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 }, "padding")).toEqual([16, 16, 16, 16]);
		expect(sides({ padding: 4, paddingHorizontal: 8, paddingTop: 1 }, "padding")).toEqual([1, 8, 4, 8]);
		expect(sides({ paddingTop: 16 }, "padding")).toBeNull();
		expect(allSides({ padding: 16, paddingLeft: 15 }, "padding", 16)).toBe(false);
	});

	test("colours as the build writes them", () => {
		expect(parseColor("rgba(0, 166, 244, 0.5)")).toEqual({ r: 0, g: 166, b: 244, a: 0.5 });
		expect(parseColor("rgb(0 166 244 / 50%)")).toEqual({ r: 0, g: 166, b: 244, a: 0.5 });
		expect(parseColor("#00a6f480")).toEqual({ r: 0, g: 166, b: 244, a: 0.502 });
		expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
		expect(parseColor("oklch(68.5% 0.169 237.323)")).toBeNull();
		expect(isColor("rgba(0, 166, 244, 0.5)", { ...sky500, a: 0.5 })).toBe(true);
		expect(isColor("rgba(0, 166, 244, 0.6)", { ...sky500, a: 0.5 })).toBe(false);
		expect(isColor("#00a6f4", { ...sky500, a: 0.5 })).toBe(false);
		expect(isColor(undefined, white)).toBe(false);
	});
});

// The classes the probe's views have, written in full as Tailwind needs them: the test finds each of them in the probe, so the two cannot drift.
const classesOf = {
	padding: "self-start p-4",
	tint: "size-8 bg-sky-500/50",
	responsive: "p-2 md:p-10",
	capped: "p-2 max-md:p-10",
	scheme: "size-8 bg-white dark:bg-zinc-900",
	custom: "qa-card",
	beaten: "qa-card p-6",
	inline: "size-8 bg-zinc-400",
	list: "p-4 p-8",
	label: "text-lg font-semibold",
} as const;

type Rule = { order: number; when?: { scheme?: string; minWidth?: number; maxWidth?: number }; style: Record<string, unknown>; fontRelative?: Record<string, number> };
type Table = { classes: Record<string, Rule[]> };
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

/** The table the build makes from the app's CSS and the probe, in a project of its own (the app's `.expo-svelte/` is not touched) with the repository's Tailwind linked in: `expo-svelte css`, the command Metro runs for the `css` option (run by Bun, which runs the library's TypeScript as the library's own tests do). */
async function builtTable(): Promise<Table> {
	const root = mkdtempSync(join(tmpdir(), "native-qa-classes-"));
	made.push(root);
	mkdirSync(join(root, "src/lib"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	symlinkSync(dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json")), join(root, "node_modules/tailwindcss"));
	copyFileSync(join(platformDir, "src/global.css"), join(root, "src/global.css"));
	copyFileSync(join(platformDir, "src/lib/native/dev/ClassProbe.svelte"), join(root, "src/lib/ClassProbe.svelte"));
	const built = spawnSync(process.execPath, [expoSvelteCli, "css", "src/global.css", "--variant", "qa", "--json"], { cwd: root, encoding: "utf8" });
	if (built.status !== 0) throw new Error(`expo-svelte css failed: ${built.stderr.slice(0, 400)}`);
	const { file } = JSON.parse(built.stdout) as { file: string };
	return ((await import(pathToFileURL(file).href)) as { default: Table }).default;
}

/** The style of a class list under a scheme and a window width: the rules that apply in cascade order, a `null` taking a key away, and the line height made from the font size (`css/runtime.ts`'s `merge` and `finish`). */
function resolve(table: Table, classes: string, { scheme = "light", width = 400 }: { scheme?: "light" | "dark"; width?: number } = {}): Style {
	const rules = classes.split(/\s+/).flatMap((name) => table.classes[name] ?? []).filter((rule) => (rule.when?.scheme === undefined || rule.when.scheme === scheme) && (rule.when?.minWidth === undefined || width >= rule.when.minWidth) && (rule.when?.maxWidth === undefined || width < rule.when.maxWidth));
	const style: Style = {};
	let relative: number | undefined;
	for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
		for (const [key, value] of Object.entries(rule.style)) { if (value === null) delete style[key]; else style[key] = value; }
		if (rule.fontRelative?.lineHeight !== undefined) relative = rule.fontRelative.lineHeight;
	}
	if (relative !== undefined) style.lineHeight = Math.round(relative * (typeof style.fontSize === "number" ? style.fontSize : 14) * 10_000) / 10_000;
	return style;
}

describe("what the check expects is what the build makes of src/global.css", () => {
	test("the probe's views have the classes this test resolves, and every class is written in full where Tailwind reads it", () => {
		for (const classes of Object.values(classesOf)) {
			if (classes === "p-4 p-8") continue; // the state views: `class={["p-4", wide && "p-8"]}` and `class={{ "p-4": true, "p-8": wide }}`
			expect([classes, probe.includes(`class="${classes}"`)]).toEqual([classes, true]);
		}
		expect(probe).toContain('class={["p-4", wide && "p-8"]}');
		expect(probe).toContain('class={{ "p-4": true, "p-8": wide }}');
		expect(source("src/global.css")).toContain('@import "tailwindcss";');
		expect(source("src/global.css")).toMatch(/@layer components \{\s*\.qa-card \{[^}]*@variant dark/s);
	});

	test("every check passes on what the resolver gives, under both schemes, and fails on a wrong reading", async () => {
		const table = await builtTable();
		const light = (name: keyof typeof classesOf) => resolve(table, classesOf[name]);
		const dark = (name: keyof typeof classesOf) => resolve(table, classesOf[name], { scheme: "dark" });

		expect(expectations.padding(light("padding"))).toEqual({ passed: true, detail: "" });
		expect(expectations.padding(resolve(table, "self-start p-2")).passed).toBe(false);
		expect(expectations.layout({ x: 10, y: 20, width: 72, height: 52 }, { x: 26, y: 36, width: 40, height: 20 }).passed).toBe(true);
		expect(expectations.layout({ x: 10, y: 20, width: 40, height: 20 }, { x: 10, y: 20, width: 40, height: 20 }).passed).toBe(false);
		expect(expectations.layout(null, null).passed).toBe(false);

		expect(expectations.tint(light("tint")).passed).toBe(true);
		expect(expectations.tint(resolve(table, "size-8 bg-sky-500")).passed).toBe(false);

		// a phone is under the breakpoint: md: is absent and max-md: applies; a window at or over it is the other way round, and the check follows the window
		const both = (width: number) => [resolve(table, classesOf.responsive, { width }), resolve(table, classesOf.capped, { width })] as const;
		for (const width of [360, 411, 767]) expect(expectations.responsive(...both(width), width).passed).toBe(true);
		for (const width of [mdBreakpoint, 800, 1024]) expect(expectations.responsive(...both(width), width).passed).toBe(true);
		expect(expectations.responsive(...both(mdBreakpoint), 411).passed).toBe(false);
		expect(expectations.responsive(...both(411), mdBreakpoint).passed).toBe(false);
		// a class that applies nowhere (the md: one ignored) or everywhere is not a breakpoint
		expect(expectations.responsive(resolve(table, "p-2 p-10"), resolve(table, "p-2 p-10"), 411).passed).toBe(false);
		expect(expectations.responsive(resolve(table, "p-2"), resolve(table, "p-2"), 411).passed).toBe(false);

		expect(expectations.scheme(light("scheme"), dark("scheme")).passed).toBe(true);
		expect(expectations.scheme(light("scheme"), light("scheme")).passed).toBe(false);
		expect(expectations.scheme(light("scheme"), null).passed).toBe(false);
		expect(expectations.custom(light("custom"), dark("custom")).passed).toBe(true);
		expect(expectations.custom(light("custom"), light("custom")).passed).toBe(false);
		expect(expectations.beaten(light("beaten")).passed).toBe(true);
		expect(expectations.beaten(light("custom")).passed).toBe(false);

		// an inline style goes over the class: what the host sends is the orange, the class alone zinc-400
		const classesAlone = light("inline");
		expect(isColor(classesAlone.backgroundColor, zinc400, 1)).toBe(true);
		expect(expectations.inline(flattenStyle([classesAlone, { backgroundColor: "#f97316" }]), classesAlone).passed).toBe(true);
		expect(expectations.inline(classesAlone, classesAlone).passed).toBe(false);

		const padded = (wide: boolean) => ({ list: resolve(table, wide ? "p-4 p-8" : "p-4"), object: resolve(table, wide ? "p-4 p-8" : "p-4") });
		expect(expectations.state(padded(false), padded(true)).passed).toBe(true);
		expect(expectations.state(padded(false), padded(false)).passed).toBe(false);
		expect(expectations.state(padded(false), null).passed).toBe(false);

		expect(expectations.text(light("label")).passed).toBe(true);
		expect(expectations.text(resolve(table, "text-base font-semibold")).passed).toBe(false);
		expect(zinc900).toBe("#18181b");
	}, 60_000);

	test("the values the checks name are the ones the build wrote: sky-500 at half opacity as rgba, the scheme classes' two backgrounds, the custom class's radius on every corner", async () => {
		const table = await builtTable();
		expect(table.classes["bg-sky-500/50"]?.[0]?.style.backgroundColor).toBe("rgba(0, 166, 244, 0.5)");
		expect(table.classes["md:p-10"]?.[0]?.when).toEqual({ minWidth: mdBreakpoint });
		expect(table.classes["dark:bg-zinc-900"]?.[0]?.when).toEqual({ scheme: "dark" });
		expect(table.classes["qa-card"]?.map((rule) => rule.when ?? null)).toEqual([null, { scheme: "dark" }]);
		expect(resolve(table, "qa-card").borderTopLeftRadius).toBe(10);
		expect(resolve(table, "qa-card", { scheme: "dark" }).backgroundColor).toBe(zinc900);
		expect(resolve(table, "p-4 p-8").paddingTop).toBe(32);
		expect(resolve(table, "text-lg font-semibold")).toMatchObject({ fontSize: 18, fontWeight: "600", lineHeight: 28 });
		// the components layer is below the utilities: `qa-card p-6` is 24, in either order of writing
		expect(resolve(table, "p-6 qa-card").paddingLeft).toBe(24);
	}, 60_000);
});
