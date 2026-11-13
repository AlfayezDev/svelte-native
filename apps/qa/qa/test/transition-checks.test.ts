import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { expectations, times, tolerance, transitionCheckNames, type Settled } from "../../src/lib/native/dev/transition-checks.ts";
import { platformDir } from "../lib/paths.ts";

/**
 * What the transition checks of the native checks lab expect (`src/lib/native/dev/transition-checks.ts`): the expectations are held against readings that are right and readings that are wrong, and the screen is held
 * against the durations they wait for. `transition-probe.test.ts` runs the whole flow against the real host and Reanimated's paths.
 */
const own: Settled = { animations: 0, drawing: 0, restoring: false, animated: false, opacity: undefined, transform: undefined, moved: 0 };
const source = (path: string) => readFileSync(join(platformDir, path), "utf8");

describe("the intro check", () => {
	test("an element that is its own again after the intro passes: opacity 1 or unset, no transform, no animation, no worklet, nothing to write back, the committed box where it is laid out", () => {
		expect(expectations.intro(1, own).passed).toBe(true);
		expect(expectations.intro(1, { ...own, opacity: 1, transform: [] }).passed).toBe(true);
		expect(expectations.intro(1, { ...own, transform: null }).passed).toBe(true);
	});

	test("each thing an intro can leave on its element fails it, and the message says what was read", () => {
		const left: Partial<Settled>[] = [
			{ animations: 1 }, { drawing: 1 }, { restoring: true }, { animated: true }, { opacity: 0 }, { opacity: 0.99 }, { transform: [{ translateY: 20 }] }, { moved: tolerance }, { moved: 12 }, { moved: null },
		];
		for (const change of left) {
			const verdict = expectations.intro(1, { ...own, ...change });
			expect([JSON.stringify(change), verdict.passed]).toEqual([JSON.stringify(change), false]);
			expect(verdict.detail).toContain("introend 1");
		}
		expect(expectations.intro(0, own).passed).toBe(false);
		expect(expectations.intro(2, own).passed).toBe(false);
		expect(expectations.intro(1, null).detail).toContain("not mounted");
	});
});

describe("the outro check", () => {
	test("the node still there at half the duration, `outroend` once, and gone when the duration ended passes", () => {
		expect(expectations.outro(true, 1, times.fly, times.fly).passed).toBe(true);
		expect(expectations.outro(true, 1, times.fly + 40, times.fly).passed).toBe(true);
		expect(expectations.outro(true, 1, times.fly - 100, times.fly).passed).toBe(true);
	});

	test("a node that was gone at half, that left long before its duration, that never left, or that ended twice or not at all fails", () => {
		expect(expectations.outro(false, 1, 40, times.fly).passed).toBe(false);
		expect(expectations.outro(true, 1, times.fly - 101, times.fly).passed).toBe(false);
		expect(expectations.outro(true, 1, times.fly + 1501, times.fly).passed).toBe(false);
		expect(expectations.outro(true, 0, null, times.fly).passed).toBe(false);
		expect(expectations.outro(true, 0, times.fly, times.fly).passed).toBe(false);
		expect(expectations.outro(true, 2, times.fly, times.fly).passed).toBe(false);
		expect(expectations.outro(true, 0, null, times.fly).detail).toContain("never");
	});
});

describe("the flip check", () => {
	const items = (change: Partial<{ animations: number; moved: number | null }> = {}) => [1, 2, 3, 4].map((id) => ({ id, animations: 0, moved: 0, ...change }));
	test("a flip that played, with every item untransformed and in its place and the layout in the new order, passes", () => {
		expect(expectations.flip(true, items(), [2, 4, 1, 3], [2, 4, 1, 3]).passed).toBe(true);
	});

	test("a flip that did not play, an item still animating or off its box (or one that could not be read), or the old order, fails", () => {
		expect(expectations.flip(false, items(), [2, 4, 1, 3], [2, 4, 1, 3]).passed).toBe(false);
		expect(expectations.flip(true, items({ animations: 1 }), [2, 4, 1, 3], [2, 4, 1, 3]).passed).toBe(false);
		expect(expectations.flip(true, items({ moved: 30 }), [2, 4, 1, 3], [2, 4, 1, 3]).passed).toBe(false);
		expect(expectations.flip(true, items({ moved: null }), [2, 4, 1, 3], [2, 4, 1, 3]).passed).toBe(false);
		expect(expectations.flip(true, items(), [2, 4, 1, 3], [1, 2, 3, 4]).passed).toBe(false);
		expect(expectations.flip(true, items().slice(0, 3), [2, 4, 1, 3], [2, 4, 1, 3]).passed).toBe(false);
		expect(expectations.flip(true, items({ moved: 30 }), [2, 4, 1, 3], [2, 4, 1, 3]).detail).toContain("moved 30");
	});
});

describe("the reversal check", () => {
	test("an intro that was running when it was reversed, an outro that ended, the node gone and nothing left to write back passes", () => {
		expect(expectations.reversed(true, 1, true, false).passed).toBe(true);
	});

	test("an intro that had not started or had finished, no `outroend`, a node still there, or a restore left on it fails", () => {
		expect(expectations.reversed(false, 1, true, false).passed).toBe(false);
		expect(expectations.reversed(true, 0, true, false).passed).toBe(false);
		expect(expectations.reversed(true, 1, false, false).passed).toBe(false);
		expect(expectations.reversed(true, 1, true, true).passed).toBe(false);
		expect(expectations.reversed(true, 1, true, true).detail).toContain("restore pending true");
	});
});

describe("the check of the UI thread", () => {
	test("a progress that moved by about the time the JS thread was blocked passes (the UI runtime moves it)", () => {
		expect(expectations.busy(240, 540, 300, times.slide).passed).toBe(true);
		expect(expectations.busy(240, 480, 300, times.slide).passed).toBe(true);
	});

	test("a progress that stood still while JS was blocked, a block that was not 300 ms, a read that failed, or an animation not running fails", () => {
		expect(expectations.busy(240, 240, 300, times.slide).passed).toBe(false);
		expect(expectations.busy(240, 400, 300, times.slide).passed).toBe(false);
		expect(expectations.busy(240, 540, 120, times.slide).passed).toBe(false);
		expect(expectations.busy(null, 540, 300, times.slide).passed).toBe(false);
		expect(expectations.busy(240, null, 300, times.slide).passed).toBe(false);
		expect(expectations.busy(0, 300, 300, times.slide).passed).toBe(false);
		expect(expectations.busy(1000, 1200, 300, times.slide).passed).toBe(false);
		expect(expectations.busy(240, 240, 300, times.slide).detail).toContain("240 -> 240");
	});
});

describe("the screen and the lab", () => {
	test("the screen plays what the checks wait for: the durations come from the checks' own table, on the elements the checks read", () => {
		const screen = source("src/lib/native/dev/TransitionsScreen.svelte");
		expect(screen).toContain('import { times } from "./transition-checks.ts"');
		for (const part of ["in:fade={{ duration: times.fade }}", "out:fly={{ y: 40, duration: times.fly }}", "animate:flip={{ duration: times.flip }}", "transition:slide={{ duration: times.slide }}"]) expect(screen).toContain(part);
		for (const name of ['hold("fader")', 'hold("panel")', "hold(`item-${item}`)"]) expect(screen).toContain(name);
		// HTML elements, no component of the library
		expect(screen).not.toMatch(/from "@alfayez\/svelte-native/);
		expect(screen).toMatch(/<ul class=/);
		expect(screen).toMatch(/<li \{@attach/);
	});

	test("the names are what the lab reports, each once, in the order it runs them", () => {
		const lab = source("src/lib/native/dev/transition-lab.ts");
		expect(lab).toContain("const [intro, outro, flip, reversed, busy] = transitionCheckNames;");
		const order = ["intro", "outro", "flip", "reversed", "busy"].map((name) => lab.indexOf(`outcomes.set(${name},`));
		expect(order.every((at) => at > 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(new Set(transitionCheckNames).size).toBe(transitionCheckNames.length);
	});
});
