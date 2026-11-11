import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { platformDir } from "../lib/paths.ts";

/**
 * The built-in blur's checks (`svelteblur` in `src/lib/native/dev/foreign-libraries-checks.ts`) against a model of what a capture of its section shows. The checks read pixels, which only a device has; here
 * the capture is computed from the section's props (a Gaussian blur of a radius that grows with `intensity`, a tint over it, a chip of its own colour on top), for the platforms the blur has (Android 12 and up,
 * iOS) and the one that draws a tint only (Android below 12), and for four ways of being broken. What this holds is that the checks pass on a view that does what the library says and fail on one that does
 * not, that each reads the thing its name says, and that the settle loop copes with a native view that shows a prop one capture late.
 */
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

type Pixel = number;
type Look = { colors: Pixel[]; width: number; height: number; format: string; uri: string };
type Recorded = { name: string; passed: boolean; detail: string };
type Lab = { svelteBlurIntensity: number; svelteBlurTint: "light" | "dark"; svelteBlurStripe: string };

async function load() {
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
// The model: a 300 x 96 dp box, five stripes, the blur's box inset 24 dp at the sides and 14 at the top and bottom, and a 56 x 26 dp chip in the middle.

const W = 300;
const H = 96;
const stripeColours = (first: string): number[][] => [first, "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6"].map((hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)));
const phi = (x: number): number => {
	const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
	const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
	return 0.5 * (1 + Math.sign(x) * (1 - poly * Math.exp(-(x * x) / 2)));
};
const pixel = ([r, g, b]: number[]): Pixel => ((255 << 24) | (Math.round(r ?? 0) << 16) | (Math.round(g ?? 0) << 8) | Math.round(b ?? 0)) >>> 0;
const chip = { x: 122, y: 35, width: 56, height: 26 };

/** What the view does: how far it blurs (σ in dp, per intensity), how strong the tint is, and whether it behaves. */
type Model = {
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
};
/** Android 12 and up: a blur of up to 25 dp and a tint of 0.12 to 0.45 over it (`BlurRules`). */
const android: Model = { sigma: (i) => (i * 25) / 100, overlay: (i, tint, blurred) => (i <= 0 ? 0 : blurred ? 0.12 + 0.33 * (i / 100) : 0.3 + 0.45 * (i / 100)), childrenOnTop: true, lag: 1, live: true, wash: (tint) => (tint === "dark" ? 0 : 255) };
/** iOS: a system material, a blur of about 20 dp at full strength, and a heavy white (or black) wash over it; what the intensity scrubs is the effect. */
const ios: Model = { sigma: (i) => (i * 20) / 100, overlay: (i, tint) => (i <= 0 ? 0 : (tint === "light" ? 0.6 : 0.65) * Math.min(1, 0.3 + i / 100)), childrenOnTop: true, lag: 0, live: true, wash: (tint) => (tint === "dark" ? 0 : 255) };

/** The capture of the section's box at a point (dp): the stripes, the blur and tint inside the blur's box, the chip over it. */
function capture(model: Model, state: Lab & { blurs: boolean }, x: number, y: number): Pixel {
  const colours = stripeColours(state.svelteBlurStripe);
  const stripe = (at: number) => colours[Math.min(4, Math.max(0, Math.floor(at / (W / 5))))] ?? [0, 0, 0];
  const insideBlur = x >= 24 && x <= W - 24 && y >= 14 && y <= H - 14;
  const onChip = x >= chip.x && x <= chip.x + chip.width && y >= chip.y && y <= chip.y + chip.height;
  if (!insideBlur) return pixel(stripe(x));
  const intensity = state.svelteBlurIntensity;
  let base = stripe(x);
  if (state.blurs && intensity > 0) {
    const sigma = Math.max(0.01, model.sigma(intensity));
    const weights = [0, 1, 2, 3, 4].map((index) => phi(((index + 1) * (W / 5) - x) / sigma) - phi((index * (W / 5) - x) / sigma));
    base = [0, 1, 2].map((channel) => weights.reduce((sum, weight, index) => sum + weight * (colours[index]?.[channel] ?? 0), 0) / weights.reduce((sum, weight) => sum + weight, 0));
  }
  const alpha = model.overlay(intensity, state.svelteBlurTint, state.blurs);
  const wash = model.wash(state.svelteBlurTint);
  const tinted = base.map((value) => value * (1 - alpha) + wash * alpha);
  if (onChip) return pixel(model.childrenOnTop ? [25, 27, 30] : [25, 27, 30].map((value) => value * (1 - alpha) + wash * alpha));
  return pixel(tinted);
}

/**
 * The clock the checks wait on: `pause` moves it and `Date.now` reads it, so a wait that runs out (a view that never shows what is asked) takes no real time. The settle loops (`untilTaken`) read
 * `Date.now`, which a test sets for its length.
 */
let clock = 0;
const realNow = Date.now;
beforeEach(() => { clock = 0; Date.now = () => clock; });
afterEach(() => { Date.now = realNow; });

/** A device the checks run on: the lab object they set props on, a capture that shows the props [lag] captures late, and the rest of what `mounts` and the pixel helpers read. */
function device(model: Model, { blurs = true, frozen = false }: { blurs?: boolean; frozen?: boolean } = {}) {
	const lab: Lab = { svelteBlurIntensity: 70, svelteBlurTint: "light", svelteBlurStripe: "#e5484d" };
	const shown: Lab[] = [];
	const recorded: Recorded[] = [];
	/** What each capture shows: the props as they were [lag] captures ago, and for a view that is not live the colour the first stripe had when it was first drawn. */
	const state = (): Lab => {
		shown.push({ ...lab, svelteBlurStripe: model.live ? lab.svelteBlurStripe : (shown[0]?.svelteBlurStripe ?? lab.svelteBlurStripe) });
		return shown[Math.max(0, shown.length - 1 - model.lag)] as Lab;
	};
	const c = {
		kind: "svelteblur", where: "inline", source: "libraries", android: true, canInspect: true, canLook: true, canTap: false, canBlur: blurs, driven: false, lab,
		handles: () => ({ extras: { chip: { tag: 2, measureInWindow: () => {} } } }),
		host: () => ({ tag: 1, measureInWindow: () => {} }),
		box: () => ({ tag: 3, measureInWindow: () => {} }),
		check: (name: string, passed: boolean, detail = "") => { recorded.push({ name, passed, detail }); },
		skip: (name: string, why: string) => { recorded.push({ name: `skipped ${name}`, passed: false, detail: why }); },
		until: async (test: () => boolean) => test(),
		pause: async (milliseconds: number) => { clock += milliseconds; },
		inspect: () => ({ owner: "engine", class: "expo.modules.svelteengine.views.EngineView", width: W * 3, height: H * 3, x: 0, y: 0, attached: true, shown: true, visibility: 0, alpha: 1, density: 3, text: "", views: [`SvelteBlurView ${W * 3}x${H * 3} clip=children`], surfaces: [], parent: "", clip: "children" }),
		rect: async () => ({ x: 0, y: 0, width: W, height: H }),
		point: async (_host: unknown, fx: number, fy: number) => [(chip.x + chip.width * fx) / W, (chip.y + chip.height * fy) / H],
		look: async (points: readonly (readonly [number, number])[]): Promise<Look | null> => {
			if (frozen) return null;
			const seen = state();
			return { colors: points.map(([fx, fy]) => capture(model, { ...seen, blurs }, fx * W, fy * H)), width: W * 3, height: H * 3, format: "image/png", uri: "file:///capture.png" };
		},
	};
	return { c, recorded, lab };
}

/** The pixel checks' names, in order (`ctx.check` of the lab puts the place in front of each; the fake does not). */
const bare = [
	"the stripe edge outside the blur is sharp (red next to yellow, as drawn)",
	"intensity 0 draws nothing over the stripes: the edge under the view is as sharp as outside it",
	"intensity 100: the stripe edge under the blur is a gradual transition (below Android 12 nothing is blurred: the line stays, under a light tint)",
	"prop update: intensity 100 pulls the two sides of the edge together, intensity 1 leaves them apart",
	"prop update: the dark tint is darker than the light tint over the same stripe",
	"the blur follows what is behind it: a new colour of the stripe shows through",
	"the children are on top of the blur: the label chip keeps its own colour",
] as const;
const outcome = (recorded: Recorded[], name: string) => recorded.find((entry) => entry.name === name);
const failures = (recorded: Recorded[]) => recorded.filter((entry) => !entry.passed).map((entry) => entry.name);

describe("the built-in BlurView's checks, against a model of the capture", () => {
	test("on Android 12 and up, and on iOS, a view that blurs, tints, follows and keeps its children on top passes all ten checks", async () => {
		const run = await load();
		for (const model of [android, ios]) {
			const { c, recorded } = device(model);
			await run(c);
			expect(failures(recorded)).toEqual([]);
			// the three of `mounts`, then the seven pixel checks, each by the name the harness reads
			expect(recorded).toHaveLength(10);
			expect(recorded.slice(3).map((entry) => entry.name)).toEqual(bare);
		}
	});

	test("a view that shows its props one or two captures late is waited for, not failed", async () => {
		const run = await load();
		for (const lag of [1, 2]) {
			const { c, recorded } = device({ ...android, lag });
			await run(c);
			expect(failures(recorded)).toEqual([]);
		}
	});

	test("below Android 12, where only a tint is drawn: the edge stays hard under the tint and the same checks pass", async () => {
		const run = await load();
		const { c, recorded } = device(android, { blurs: false });
		c.canBlur = false;
		await run(c);
		expect(failures(recorded)).toEqual([]);
	});

	test("a platform that must blur (Android 12 and up, iOS) and shows only a tint fails the gradual-edge check: the fallback does not hide a blur that never draws", async () => {
		const run = await load();
		const { c, recorded } = device(android, { blurs: false });
		c.canBlur = true;
		await run(c);
		expect(failures(recorded)).toEqual([bare[2]]);
		expect(outcome(recorded, bare[2])?.detail).toContain("blur:");
	});

	test("an intensity 0 that still draws a tint fails the check that says it draws nothing", async () => {
		const run = await load();
		const { c, recorded } = device({ ...android, overlay: (i, tint, blurred) => android.overlay(Math.max(i, 20), tint, blurred) });
		await run(c);
		expect(failures(recorded)).toContain(bare[1]);
	});

	test("a tint that ignores the prop fails the tint check, and a view that does not follow what is behind it fails only that one", async () => {
		const run = await load();
		const ignoresTint = device({ ...android, wash: () => 255 });
		await run(ignoresTint.c);
		expect(failures(ignoresTint.recorded)).toEqual([bare[4]]);

		const frozen = device({ ...android, live: false });
		await run(frozen.c);
		expect(failures(frozen.recorded)).toEqual([bare[5]]);
	});

	test("children drawn under the tint fail the check that they are on top, and only it", async () => {
		const run = await load();
		const { c, recorded } = device({ ...android, childrenOnTop: false });
		await run(c);
		expect(failures(recorded)).toEqual([bare[6]]);
		expect(outcome(recorded, bare[6])?.detail).toContain("a light tint over it would lift");
	});

	test("a capture that fails is a failure with its reason, for every pixel check", async () => {
		const run = await load();
		const { c, recorded } = device(android, { frozen: true });
		await run(c);
		expect(failures(recorded)).toEqual(bare);
	});
});
