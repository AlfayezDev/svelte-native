import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { betweenMargin, brightness, edgeGradual, edgeRatio, gradualBound, lightTint, ratioBetween, readEdge } from "../../src/lib/native/dev/foreign-pixels.ts";
import { platformDir } from "../lib/paths.ts";

/**
 * The built-in blur's checks (`svelteblur` in `src/lib/native/dev/foreign-libraries-checks.ts`) against a model of what a capture of its section shows. The checks read pixels, which only a device has; here
 * the capture is computed from the section's props: a Gaussian blur whose standard deviation follows `intensity` (25 dp at 100 on Android, `BlurRules.kt`), a tint over it, the stripes and the band behind
 * it, a chip of its own colour on top, for the platforms the blur has (Android 12 and up, iOS) and the one that draws a tint only (Android below 12). What this holds is that the checks pass on a view that does what
 * the library says and fail on each of the ways it can not, that each reads the thing its name says, and that the settle loops cope with a native view that shows a prop late, a capture that fails, and a tint that comes on slowly.
 * A change to a check's own source (a floor lowered, a wait taken out) is a variant too: it must pass what the real one fails.
 */
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

type Pixel = number;
type Look = { colors: Pixel[]; width: number; height: number; format: string; uri: string };
type Recorded = { name: string; passed: boolean; detail: string };
type Lab = { svelteBlurIntensity: number; svelteBlurTint: "light" | "dark"; svelteBlurStripe: string };
type Mutation = { from: string; to: string };

/** The checks' own source, bundled with the platform stubbed; [mutations] change it as it is read (the text must be there, so a change that no longer applies fails the test). */
async function load(mutations: readonly Mutation[] = []) {
	const dir = join(platformDir, "src/lib/native/dev");
	const bundle = await build({
		stdin: { contents: `export { libraryChecks } from ${JSON.stringify(join(dir, "foreign-libraries-checks.ts"))};`, resolveDir: platformDir },
		bundle: true, format: "esm", platform: "neutral", write: false, conditions: ["browser"],
		plugins: [{
			name: "foreign-blur",
			setup(builder) {
				// The library's foreign entry and the lab's reactive state need React Native and Expo: the checks of the blur call none of them.
				builder.onResolve({ filter: /^@rasheed\/svelte-native\/foreign$/ }, () => ({ path: "foreign", namespace: "stub" }));
				builder.onResolve({ filter: /foreign\.svelte\.ts$/ }, () => ({ path: "lab", namespace: "stub" }));
				builder.onLoad({ filter: /^foreign$/, namespace: "stub" }, () => ({ contents: "export const dismissDatePicker = () => {}; export const openDatePicker = () => {}; export const captureRef = () => {}; export const releaseCapture = () => {};", loader: "js" }));
				builder.onLoad({ filter: /^lab$/, namespace: "stub" }, () => ({ contents: "export const libraryLab = {};", loader: "js" }));
				builder.onLoad({ filter: /foreign-libraries-checks\.ts$/ }, () => {
					let contents = readFileSync(join(dir, "foreign-libraries-checks.ts"), "utf8");
					for (const mutation of mutations) {
						if (!contents.includes(mutation.from)) throw new Error(`the mutation no longer applies: ${mutation.from}`);
						contents = contents.replace(mutation.from, mutation.to);
					}
					return { contents, loader: "ts" };
				});
			},
		}],
	});
	const directory = mkdtempSync(join(tmpdir(), "native-qa-blur-"));
	made.push(directory);
	const file = join(directory, "checks.mjs");
	writeFileSync(file, bundle.outputFiles[0]?.contents ?? "");
	return ((await import(pathToFileURL(file).href)) as { libraryChecks: { svelteblur(c: unknown): Promise<void> } }).libraryChecks.svelteblur;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The model: a box [width] dp wide and 96 high, five stripes, a near-black band from 30 % to 42 % of the height, the blur's box inset 24 dp at the sides and 14 at the top and bottom, and a 56 x 26 dp chip in the middle.

const H = 96;
const bandTop = 0.3 * H;
const bandBottom = 0.42 * H;
const bandColour = [16, 18, 20];
const stripeColours = (first: string): number[][] => [first, "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6"].map((hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)));
const phi = (x: number): number => {
	const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
	const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
	return 0.5 * (1 + Math.sign(x) * (1 - poly * Math.exp(-(x * x) / 2)));
};
const pixel = ([r, g, b]: number[]): Pixel => ((255 << 24) | (Math.round(r ?? 0) << 16) | (Math.round(g ?? 0) << 8) | Math.round(b ?? 0)) >>> 0;
const chip = { width: 56, y: 35, height: 26 };

/** What the view does. */
type Model = {
	/** The blur's standard deviation in dp at an intensity. */
	sigma(intensity: number): number;
	overlay(intensity: number, tint: "light" | "dark", blurred: boolean): number;
	/** The chip is drawn over the tint (the library's draw order) or under it. */
	childrenOnTop: boolean;
	/** What the view shows lags the props by this many captures (the engine and the render thread take a frame or two). */
	lag: number;
	/** Whether the picture behind the view is updated when what is behind it changes. */
	live: boolean;
	/** The colour the tint washes with (255 white, 0 black) for a tint prop; a view that ignores the prop washes white. */
	wash(tint: "light" | "dark"): number;
	/** How far down (dp) the picture behind the view is from where the box is. */
	offsetY: number;
	/** Captures a change takes to come on: the tint's strength grows over that many captures after the change. */
	ramp: number;
	/** The first captures after a change fail (null), as many as this. */
	failAfterChange: number;
	/** The first capture after a change is the software one (the GPU frame timed out): a tint over the content, no blur. */
	softwareFirst: boolean;
};
const normal = { childrenOnTop: true, live: true, wash: (tint: "light" | "dark") => (tint === "dark" ? 0 : 255), offsetY: 0, ramp: 0, failAfterChange: 0, softwareFirst: false };
/** Android 12 and up: a blur of up to 25 dp and a tint of 0.12 to 0.45 over it (`BlurRules`); the tint alone, 0.30 to 0.75. */
const android: Model = { ...normal, sigma: (i) => (i * 25) / 100, overlay: (i, _tint, blurred) => (i <= 0 ? 0 : blurred ? 0.12 + 0.33 * (i / 100) : 0.3 + 0.45 * (i / 100)), lag: 1 };
/**
 * iOS (a `UIVisualEffectView` with a `UIBlurEffect`), as the first iPhone run measured it (iPhone SE 3, iOS 26.6, a box of 309 dp): a blur that saturates (the ratio of the inner pair to the outer one is 0.20 to
 * 0.22 at intensity 100, 0.24 to 0.26 at 50 and 1 at 1: a sigma of 20 dp at 100 and about 12 at 50), a light material that greys the stripe (the yellow's 472 becomes 446 to 450, the red and the blue about 450
 * to 465) and a dark one that takes it to 161 to 165. What the intensity scrubs is the effect.
 */
const ios: Model = {
	...normal,
	sigma: (i) => (i <= 1 ? 0.2 : 20 * (i / 100) ** 0.74),
	overlay: (i, tint) => (i <= 0 ? 0 : (tint === "light" ? 0.5 : 0.62) * Math.min(1, 0.3 + i / 100)),
	wash: (tint) => (tint === "dark" ? 0 : 152),
	lag: 0,
};

type Shown = Lab & { blurs: boolean; strength: number };

/** The capture of the section's box at a point (dp): the stripes and the band, the blur and tint inside the blur's box, the chip over it. */
function capture(model: Model, width: number, state: Shown, x: number, y: number): Pixel {
	const colours = stripeColours(state.svelteBlurStripe);
	const stripe = (at: number) => colours[Math.min(4, Math.max(0, Math.floor(at / (width / 5))))] ?? [0, 0, 0];
	const content = (at: number, down: number) => (down >= bandTop && down <= bandBottom ? bandColour : stripe(at));
	const insideBlur = x >= 24 && x <= width - 24 && y >= 14 && y <= H - 14;
	const chipX = width / 2 - chip.width / 2;
	const onChip = x >= chipX && x <= chipX + chip.width && y >= chip.y && y <= chip.y + chip.height;
	if (!insideBlur) return pixel(content(x, y));
	const intensity = state.svelteBlurIntensity;
	let base = content(x, y);
	if (state.blurs && intensity > 0) {
		// the picture behind the view: smeared by the blur, and [offsetY] lower than the box
		const sigma = Math.max(0.01, model.sigma(intensity));
		const weights = [0, 1, 2, 3, 4].map((index) => phi(((index + 1) * (width / 5) - x) / sigma) - phi((index * (width / 5) - x) / sigma));
		const sum = weights.reduce((total, weight) => total + weight, 0);
		const across = [0, 1, 2].map((channel) => weights.reduce((total, weight, index) => total + weight * (colours[index]?.[channel] ?? 0), 0) / sum);
		const at = y + model.offsetY;
		const covered = Math.min(1, Math.max(0, phi((bandBottom - at) / sigma) - phi((bandTop - at) / sigma)));
		base = across.map((value, channel) => value * (1 - covered) + (bandColour[channel] ?? 0) * covered);
	}
	const alpha = model.overlay(intensity, state.svelteBlurTint, state.blurs) * state.strength;
	const wash = model.wash(state.svelteBlurTint);
	const tinted = base.map((value) => value * (1 - alpha) + wash * alpha);
	if (onChip) return pixel(model.childrenOnTop ? [25, 27, 30] : [25, 27, 30].map((value) => value * (1 - alpha) + wash * alpha));
	return pixel(tinted);
}

/**
 * The clock the checks wait on: `pause` moves it and `Date.now` reads it, so a wait that runs out (a view that never shows what is asked) takes no real time. The settle loops (`untilTaken`) read `Date.now`,
 * which a test sets for its length.
 */
let clock = 0;
const realNow = Date.now;
beforeEach(() => { clock = 0; Date.now = () => clock; });
afterEach(() => { Date.now = realNow; });

type Options = { blurs?: boolean; canBlur?: boolean; frozen?: boolean; width?: number; where?: "inline" | "row" | "sheet"; android?: boolean };

/** A device the checks run on: the lab object they set props on, a capture that shows the props [lag] captures late, and the rest of what `mounts` and the pixel helpers read. */
function device(model: Model, { blurs = true, canBlur = blurs, frozen = false, width = 360, where = "inline", android: onAndroid = true }: Options = {}) {
	const lab: Lab = { svelteBlurIntensity: 70, svelteBlurTint: "light", svelteBlurStripe: "#e5484d" };
	const shown: Lab[] = [];
	const recorded: Recorded[] = [];
	let last = JSON.stringify(lab);
	let sinceChange = 100;
	/** What each capture shows: the props as they were [lag] captures ago, and for a view that is not live the colour the first stripe had when it was first drawn. */
	const state = (): Shown => {
		const now = JSON.stringify(lab);
		if (now !== last) { last = now; sinceChange = 0; } else sinceChange++;
		shown.push({ ...lab, svelteBlurStripe: model.live ? lab.svelteBlurStripe : (shown[0]?.svelteBlurStripe ?? lab.svelteBlurStripe) });
		const seen = shown[Math.max(0, shown.length - 1 - model.lag)] as Lab;
		return { ...seen, blurs: blurs && !(model.softwareFirst && sinceChange === 0), strength: Math.min(1, (sinceChange + 1) / (model.ramp + 1)) };
	};
	const c = {
		kind: "svelteblur", where, source: "libraries", android: onAndroid, canInspect: true, canLook: true, canTap: false, canBlur, driven: false, lab,
		handles: () => ({ extras: { chip: { tag: 2, measureInWindow: () => {} } } }),
		host: () => ({ tag: 1, measureInWindow: () => {} }),
		box: () => ({ tag: 3, measureInWindow: () => {} }),
		check: (name: string, passed: boolean, detail = "") => { recorded.push({ name, passed, detail }); },
		skip: (name: string, why: string) => { recorded.push({ name: `skipped ${name}`, passed: false, detail: why }); },
		until: async (test: () => boolean) => test(),
		pause: async (milliseconds: number) => { clock += milliseconds; },
		inspect: () => ({ owner: "engine", class: "expo.modules.svelteengine.views.EngineView", width: width * 3, height: H * 3, x: 0, y: 0, attached: true, shown: true, visibility: 0, alpha: 1, density: 3, text: "", views: [`SvelteBlurView ${width * 3}x${H * 3} clip=children`], surfaces: [], parent: "", clip: "children" }),
		rect: async () => ({ x: 0, y: 0, width, height: H }),
		point: async (_host: unknown, fx: number, fy: number) => [(width / 2 - chip.width / 2 + chip.width * fx) / width, (chip.y + chip.height * fy) / H],
		look: async (points: readonly (readonly [number, number])[]): Promise<Look | null> => {
			if (frozen) return null;
			const seen = state();
			if (sinceChange < model.failAfterChange) return null;
			return { colors: points.map(([fx, fy]) => capture(model, width, seen, fx * width, fy * H)), width: width * 3, height: H * 3, format: "image/png", uri: "file:///capture.png" };
		},
	};
	return { c, recorded, lab };
}

/** The pixel checks' names, in order (`ctx.check` of the lab puts the place in front of each; the fake does not). */
const bare = [
	"the stripe edge outside the blur is sharp (red next to yellow, as drawn)",
	"intensity 0 draws nothing over the stripes: the edge under the view is as sharp as outside it",
	"intensity 100: the stripe edge under the blur is a gradual transition (below Android 12 nothing is blurred: the line stays, under a light tint)",
	"prop update: intensity 100 pulls the two sides of the edge together, intensity 1 leaves them apart (the ratio of the inner pair to the outer one, which a tint does not move)",
	"prop update: intensity 50 is between the two: more blur than 1, less than 100 (the ratio, or the contrast on a view that only tints)",
	"the picture behind the view is where the box is: the band across the stripes shows at the same height under the view as beside it",
	"prop update: the dark tint is darker than the light tint over the same stripe",
	"the blur follows what is behind it: a new colour of the stripe shows through",
	"the children are on top of the blur: the label chip keeps its own colour",
] as const;
const outcome = (recorded: Recorded[], name: string) => recorded.find((entry) => entry.name === name);
const failures = (recorded: Recorded[]) => recorded.filter((entry) => !entry.passed).map((entry) => entry.name);
const ratios = (detail: string) => [...detail.matchAll(/ratio ([\d.]+)/g)].map((match) => Number(match[1]));

describe("the built-in BlurView's checks, against a model of the capture", () => {
	test("on Android 12 and up, and on iOS, a view that blurs, tints, follows and keeps its children on top passes all nine pixel checks, in boxes of 330 to 400 dp", async () => {
		const run = await load();
		for (const [model, onAndroid] of [[android, true], [ios, false]] as const) {
			// the iPhone SE's box is 309 dp (293 in the sheet), narrower than the Android boxes of the first runs
			for (const width of onAndroid ? [330, 360, 400] : [293, 309, 330, 360, 400]) {
				const { c, recorded } = device(model, { width, android: onAndroid });
				await run(c);
				expect([width, failures(recorded)]).toEqual([width, []]);
				// the three of `mounts`, then the nine pixel checks, each by the name the harness reads
				expect(recorded).toHaveLength(12);
				expect(recorded.slice(3).map((entry) => entry.name)).toEqual(bare);
			}
		}
	});

	test("the ratios it reads are the ones the blur's constants give: 0.20 at intensity 100, 0.28 at 50 and 1 at 1 on Android (a box of 360 dp)", async () => {
		const run = await load();
		const { c, recorded } = device(android);
		await run(c);
		const [full] = ratios(outcome(recorded, bare[2])?.detail ?? "");
		const half = ratios(outcome(recorded, bare[4])?.detail ?? "")[1];
		const weak = ratios(outcome(recorded, bare[3])?.detail ?? "")[0];
		expect(full).toBeGreaterThan(0.17);
		expect(full).toBeLessThan(0.24);
		expect(half).toBeGreaterThan(0.25);
		expect(half).toBeLessThan(0.32);
		expect(weak).toBeGreaterThan(0.9);
	});

	test("a view that shows its props one or two captures late is waited for, not failed", async () => {
		const run = await load();
		for (const lag of [1, 2]) {
			const { c, recorded } = device({ ...android, lag });
			await run(c);
			expect(failures(recorded)).toEqual([]);
		}
	});

	test("below Android 12, where only a tint is drawn: the edge stays hard under the tint, the contrast falls with the intensity and the other checks pass", async () => {
		const run = await load();
		const { c, recorded } = device(android, { blurs: false });
		await run(c);
		expect(failures(recorded)).toEqual([]);
		expect(outcome(recorded, bare[2])?.detail).toContain("tint only");
	});

	test("a platform that must blur (Android 12 and up, iOS) and shows only a tint fails the three checks that tell a blur from a tint: the fallback does not hide a blur that never draws", async () => {
		const run = await load();
		const { c, recorded } = device(android, { blurs: false, canBlur: true });
		await run(c);
		// the ratio is 1 at every intensity: not gradual at 100, not smaller at 100 than at 1, not between
		expect(failures(recorded)).toEqual([bare[2], bare[3], bare[4]]);
		expect(outcome(recorded, bare[2])?.detail).toContain("blur, the inner pair at most 0.35");
	});

	test("the pull-together check compares the ratio, not the contrast: a tint that grows with the intensity does not pass it (the contrast alone falls from about 100 to 36)", async () => {
		const run = await load();
		const { c, recorded } = device(android, { blurs: false, canBlur: true });
		await run(c);
		const detail = outcome(recorded, bare[3])?.detail ?? "";
		expect(outcome(recorded, bare[3])?.passed).toBe(false);
		const [weak, full] = ratios(detail);
		expect(weak).toBeGreaterThan(0.95);
		expect(full).toBeGreaterThan(0.95);
		// the comparison it replaces, `near` alone, passes on the same capture
		const near = [...detail.matchAll(/near (\d+)/g)].map((match) => Number(match[1]));
		expect((near[1] ?? 999) < (near[0] ?? 0) * 0.6).toBe(true);
	});

	test("a blur a third of the strength it should have (8 dp at intensity 100) fails the bound of each platform: Android's 0.35, and the iPhone's 0.30 (the first iPhone run read 0.20 to 0.22)", async () => {
		const run = await load();
		const weakBlur: Model = { ...android, sigma: (i) => (i * 8.3) / 100 };
		const onAndroid = device(weakBlur);
		await run(onAndroid.c);
		expect(failures(onAndroid.recorded)).toEqual([bare[2]]);
		const [ratio] = ratios(outcome(onAndroid.recorded, bare[2])?.detail ?? "");
		expect(ratio).toBeGreaterThan(0.35);
		expect(ratio).toBeLessThan(0.5);
		const onIos = device({ ...ios, sigma: (i) => (i * 8.3) / 100 }, { android: false, width: 309 });
		await run(onIos.c);
		expect(failures(onIos.recorded)).toContain(bare[2]);
		const [iosRatio] = ratios(outcome(onIos.recorded, bare[2])?.detail ?? "");
		expect(iosRatio).toBeGreaterThan(0.3);
		expect(iosRatio).toBeLessThan(0.5);
		// ...and an iOS blur that is hardly one fails it by more
		const hardly = device({ ...ios, sigma: (i) => (i * 3) / 100 }, { android: false, width: 309 });
		await run(hardly.c);
		expect(failures(hardly.recorded)).toContain(bare[2]);
	});

	test("a blur that does not follow the intensity (the same radius at 50 as at 100) fails the intensity-50 check and nothing else", async () => {
		const run = await load();
		const binary: Model = { ...android, sigma: (i) => (i >= 10 ? 25 : 0.2) };
		const { c, recorded } = device(binary);
		await run(c);
		expect(failures(recorded)).toEqual([bare[4]]);
		// the ratios at 100 and 50 are the same, so there is nothing between them
		const [full, half] = ratios(outcome(recorded, bare[4])?.detail ?? "");
		expect(Math.abs((half ?? 0) - (full ?? 9))).toBeLessThan(0.03);
	});

	test("an intensity 0 that still draws a tint fails the check that says it draws nothing", async () => {
		const run = await load();
		const { c, recorded } = device({ ...android, overlay: (i, tint, blurred) => android.overlay(Math.max(i, 20), tint, blurred) });
		await run(c);
		expect(failures(recorded)).toContain(bare[1]);
	});

	test("a picture that sits 6 dp or more away from the box fails the band check and only it, lower or higher; the picture at the box passes", async () => {
		const run = await load();
		for (const offsetY of [-14, -6, 6, 14]) {
			const { c, recorded } = device({ ...android, offsetY });
			await run(c);
			expect([offsetY, failures(recorded)]).toEqual([offsetY, [bare[5]]]);
		}
		// 3 dp is under what the band's rows can tell (6 dp from the edge), and the picture at the box (0) is what the real view gives
		for (const offsetY of [-3, 0, 3]) {
			const { c, recorded } = device({ ...android, offsetY });
			await run(c);
			expect([offsetY, failures(recorded)]).toEqual([offsetY, []]);
		}
		const onIos = device({ ...ios, offsetY: 10 }, { android: false });
		await run(onIos.c);
		expect(failures(onIos.recorded)).toEqual([bare[5]]);
	});

	test("a tint that ignores the prop fails the tint check, and a view that does not follow what is behind it fails only that one", async () => {
		const run = await load();
		const ignoresTint = device({ ...android, wash: () => 255 });
		await run(ignoresTint.c);
		expect(failures(ignoresTint.recorded)).toEqual([bare[6]]);

		const frozen = device({ ...android, live: false });
		await run(frozen.c);
		expect(failures(frozen.recorded)).toEqual([bare[7]]);
	});

	test("a light tint that lifts the stripe only to about 470 (under the floor of 520, over the old one of 450) fails the tint check, and the old floor passes it", async () => {
		const real = await load();
		const lowered = await load([
			{ from: "steady(sum, (look) => sum(look) > tints.yellow)", to: "steady(sum, (look) => sum(look) > 450)" },
			{ from: "lightness !== null && lightness > tints.yellow &&", to: "lightness !== null && lightness > 450 &&" },
		]);
		// the dark tint is strong and the light one faint: the difference is far over 150, and the light reading is over 450 and under 520
		const faint: Model = { ...android, overlay: (i, tint, blurred) => (i >= 100 ? (tint === "light" ? 0.08 : 0.6) : android.overlay(i, tint, blurred)) };
		const strict = device(faint);
		await real(strict.c);
		expect(failures(strict.recorded)).toEqual([bare[6]]);
		const loose = device(faint);
		await lowered(loose.c);
		expect(failures(loose.recorded)).toEqual([]);
		const lightness = Number(/\((\d+), over \d+\)/.exec(outcome(strict.recorded, bare[6])?.detail ?? "")?.[1]);
		expect(lightness).toBeGreaterThan(450);
		expect(lightness).toBeLessThan(520);
	});

	test("a tint that comes on over a few captures is read when it has settled, and not before (the reading without the wait is a partial one)", async () => {
		const real = await load();
		const unsettled = await load([{ from: "steady(sum, (look) => sum(look) > tints.yellow)", to: "((look: Look) => sum(look) > tints.yellow)" }]);
		const slow: Model = { ...android, ramp: 5 };
		const lightnessOf = (detail: string) => Number(/\((\d+), over \d+\)/.exec(detail)?.[1]);
		const settled = device(slow);
		await real(settled.c);
		expect(failures(settled.recorded)).toEqual([]);
		// a yellow under a 0.45 white tint is about 590, and the settled reading is that
		const final = lightnessOf(outcome(settled.recorded, bare[6])?.detail ?? "");
		expect(final).toBeGreaterThan(570);
		const early = device(slow);
		await unsettled(early.c);
		expect(lightnessOf(outcome(early.recorded, bare[6])?.detail ?? "")).toBeLessThan(final - 10);
	});

	test("children drawn under the tint fail the check that they are on top, and only it", async () => {
		const run = await load();
		const { c, recorded } = device({ ...android, childrenOnTop: false });
		await run(c);
		expect(failures(recorded)).toEqual([bare[8]]);
		expect(outcome(recorded, bare[8])?.detail).toContain("a light tint over it would lift");
	});

	test("a capture that fails is a failure with its reason, for every pixel check, after the whole wait: 14 s of a place's clock for each reading (24 s in a row)", async () => {
		const run = await load();
		const { c, recorded } = device(android, { frozen: true });
		await run(c);
		expect(failures(recorded)).toEqual(bare);
		// the readings of the first eight checks, and the chip's, wait 14 s each, and the changes of props between them 400 ms
		expect(clock).toBeGreaterThanOrEqual(9 * 14000);
		clock = 0;
		const row = device(android, { frozen: true, where: "row" });
		await run(row.c);
		expect(clock).toBeGreaterThanOrEqual(9 * 24000);
	});

	test("captures that fail after each change (the GPU frame timed out, 3 s) are taken again, and the readings come out right", async () => {
		const run = await load();
		const { c, recorded } = device({ ...android, failAfterChange: 3 });
		await run(c);
		expect(failures(recorded)).toEqual([]);
	});

	test("the first capture after a change that is the software one (a tint over the content, no blur) is read past: the blur is judged on the captures that follow", async () => {
		const run = await load();
		const { c, recorded } = device({ ...android, softwareFirst: true, lag: 0 });
		await run(c);
		expect(failures(recorded)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// iOS, calibrated from the first iPhone run (iPhone SE 3, iOS 26.6, svelteblur: 39 checks, the three places)

describe("the built-in BlurView's checks on iOS, with the bounds the first iPhone run gave", () => {
	/** What the run read in each place (`qa/runs/foreign-E74A5608-...-20261111T211549Z.json`): the edge pairs at 100, 50 and 1, the yellow's sum under the light and the dark tint, and the red and the blue stripe under the light one. */
	const run = {
		inline: { full: [13, 60], half: [32, 123], weak: [145, 145], light: 447, dark: 164, red: [254, 108, 84], blue: [33, 177, 255] },
		row: { full: [12, 61], half: [32, 124], weak: [145, 145], light: 450, dark: 165, red: [255, 109, 84], blue: [33, 178, 254] },
		sheet: { full: [11, 54], half: [29, 119], weak: [144, 144], light: 446, dark: 161, red: [254, 111, 82], blue: [38, 177, 250] },
	} as const;
	const ratioOf = (pair: readonly number[]) => edgeRatio({ near: pair[0] ?? 0, far: pair[1] ?? 0 }) ?? Number.NaN;
	const sumOf = (rgb: readonly number[]) => (rgb[0] ?? 0) + (rgb[1] ?? 0) + (rgb[2] ?? 0);

	test("every reading of the run is inside the iOS bounds, with room: the ratio at 100 under 0.30 (the largest was 0.22), the ratio at 50 above it by 0.02 and below the one at 1 by 0.5, the light tint over 400 and 200 above the dark one", () => {
		for (const [place, reading] of Object.entries(run)) {
			const full = ratioOf(reading.full);
			const half = ratioOf(reading.half);
			const weak = ratioOf(reading.weak);
			expect([place, edgeGradual(readEdge([0, 0, 0, 0]), 1), edgeGradual({ near: reading.full[0] ?? 0, far: reading.full[1] ?? 0 }, gradualBound.ios)]).toEqual([place, false, true]);
			expect([place, ratioBetween(full, half, weak, betweenMargin.ios)]).toEqual([place, true]);
			expect([place, reading.light > lightTint.ios.yellow, reading.light - reading.dark >= lightTint.ios.gap]).toEqual([place, true, true]);
			expect([place, sumOf(reading.red) > lightTint.ios.stripe, sumOf(reading.blue) > lightTint.ios.stripe]).toEqual([place, true, true]);
			// the room: the bounds are tight enough to mean something (not the 0.5 and the 0.005 of before the run) and loose enough for the next phone's pixels
			expect(gradualBound.ios).toBeGreaterThan(full * 1.25);
			expect(gradualBound.ios).toBeLessThan(full * 1.7);
			expect(half - full).toBeGreaterThanOrEqual(betweenMargin.ios.lower * 1.9);
			expect(weak - half).toBeGreaterThanOrEqual(betweenMargin.ios.upper * 1.4);
			expect(reading.light).toBeGreaterThan(lightTint.ios.yellow * 1.1);
			expect(reading.light - reading.dark).toBeGreaterThanOrEqual(lightTint.ios.gap * 1.4);
		}
	});

	test("the numbers that were wrong for iOS were Android's: the light tint over the yellow read 446 to 450 on the phone, under the Android floor of 520 (it is under the bare yellow's 472: the material greys), and the red read 446 to 448 under the Android floor of 450", () => {
		for (const reading of Object.values(run)) {
			expect(reading.light).toBeLessThan(lightTint.android.yellow);
			expect(sumOf(reading.red)).toBeLessThan(lightTint.android.stripe + 5);
		}
		expect(Math.max(...Object.values(run).map((reading) => sumOf(reading.red)))).toBeLessThan(lightTint.android.stripe + 1);
		expect(brightness(0xfff5d90a)).toBe(472);
		// Android's own readings (the Samsung A16: 600 to 604 and 515 to 529, a gap of 345) are still over its floors
		expect(601).toBeGreaterThan(lightTint.android.yellow);
		expect(515).toBeGreaterThan(lightTint.android.stripe);
		expect(601 - 256).toBeGreaterThan(lightTint.android.gap);
	});

	test("each way the iOS view can be broken is outside those bounds: a tint only or no view (a ratio of 1), a blur of 8 dp (0.35), a tint the view ignores or no view at all (the same 472 under both), a swapped tint (the light one under the floor)", () => {
		const full = ratioOf(run.inline.full);
		expect(edgeGradual({ near: 145, far: 145 }, gradualBound.ios)).toBe(false);
		expect(edgeGradual({ near: 51, far: 145 }, gradualBound.ios)).toBe(false);
		expect(ratioBetween(full, 1, 1, betweenMargin.ios)).toBe(false);
		expect(ratioBetween(full, full, 1, betweenMargin.ios)).toBe(false);
		expect(472 > lightTint.ios.yellow && 472 - 472 >= lightTint.ios.gap).toBe(false);
		expect(164 > lightTint.ios.yellow).toBe(false);
		expect(446 - 164 >= lightTint.ios.gap && 446 - 164 < lightTint.ios.gap * 2).toBe(true);
	});

	test("the checks' model of the phone gives the run's readings and passes all nine checks in each of the phone's boxes, and each broken view fails the checks that are for it", async () => {
		const checks = await load();
		const phone = device(ios, { width: 309, android: false });
		await checks(phone.c);
		expect(failures(phone.recorded)).toEqual([]);
		const [full] = ratios(outcome(phone.recorded, bare[2])?.detail ?? "");
		const [, half] = ratios(outcome(phone.recorded, bare[4])?.detail ?? "");
		expect(full).toBeGreaterThan(0.17);
		expect(full).toBeLessThan(0.25);
		expect(half).toBeGreaterThan(0.22);
		expect(half).toBeLessThan(0.3);
		const lightness = Number(/\((\d+), over \d+\)/.exec(outcome(phone.recorded, bare[6])?.detail ?? "")?.[1]);
		expect(lightness).toBeGreaterThan(430);
		expect(lightness).toBeLessThan(470);

		// a tint and no blur (the view draws, the effect does not): the three checks that tell a blur from a tint fail, and the others pass
		const tintOnly = device(ios, { width: 309, android: false, blurs: false, canBlur: true });
		await checks(tintOnly.c);
		expect(failures(tintOnly.recorded)).toEqual([bare[2], bare[3], bare[4]]);
		expect(outcome(tintOnly.recorded, bare[2])?.detail).toContain("blur, the inner pair at most 0.3");

		// no view: a capture that shows nothing of it fails every pixel check
		const none = device(ios, { width: 309, android: false, frozen: true });
		await checks(none.c);
		expect(failures(none.recorded)).toEqual(bare);

		// a picture that does not follow what is behind it fails that check and only it
		const stuck = device({ ...ios, live: false }, { width: 309, android: false });
		await checks(stuck.c);
		expect(failures(stuck.recorded)).toEqual([bare[7]]);

		// a tint the view ignores (both read the same) fails the tint check and only it
		const ignores = device({ ...ios, overlay: (i) => ios.overlay(i, "light", false), wash: () => 152 }, { width: 309, android: false });
		await checks(ignores.c);
		expect(failures(ignores.recorded)).toEqual([bare[6]]);

		// a blur that does not follow the intensity fails the between check and only it
		const binary = device({ ...ios, sigma: (i) => (i >= 10 ? 20 : 0.2) }, { width: 309, android: false });
		await checks(binary.c);
		expect(failures(binary.recorded)).toEqual([bare[4]]);
	});

	test("with Android's floors (520 for the yellow, 450 for the stripes) the phone's readings fail the tint and the follow checks: this is what the first iPhone run saw", async () => {
		const android = await load([
			{ from: "const tints = c.android ? lightTint.android : lightTint.ios;", to: "const tints = lightTint.android;" },
		]);
		const phone = device(ios, { width: 309, android: false });
		await android(phone.c);
		expect(failures(phone.recorded)).toEqual([bare[6], bare[7]]);
		expect(outcome(phone.recorded, bare[6])?.detail).toMatch(/over 520/);
	});
});
