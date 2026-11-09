import { describe, expect, test } from "bun:test";
import { percentile, summarize } from "../parse/stats.ts";

describe("percentile", () => {
	test("nearest rank over ten samples", () => {
		const values = [500, 100, 300, 200, 400, 900, 800, 700, 600, 1000];
		expect(percentile(values, 90)).toBe(900);
		expect(percentile(values, 50)).toBe(500);
		expect(percentile(values, 100)).toBe(1000);
	});
	test("thirty samples: p90 is the 27th smallest", () => {
		const values = Array.from({ length: 30 }, (_, index) => (index + 1) * 10);
		expect(percentile(values, 90)).toBe(270);
	});
	test("one sample is every percentile; none is null", () => {
		expect(percentile([42], 90)).toBe(42);
		expect(percentile([], 90)).toBeNull();
	});
	test("does not reorder its input", () => {
		const values = [3, 1, 2];
		percentile(values, 90);
		expect(values).toEqual([3, 1, 2]);
	});
});

describe("summarize", () => {
	test("min, p50, p90, max and count", () => {
		expect(summarize([700, 720, 760, 650])).toEqual({
			samples: 4,
			min: 650,
			p50: 700,
			p90: 760,
			max: 760,
		});
	});
	test("empty input has null statistics", () => {
		expect(summarize([])).toEqual({ samples: 0, min: null, p50: null, p90: null, max: null });
	});
});
