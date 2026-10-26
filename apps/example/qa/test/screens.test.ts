import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
	cases,
	coveredRouteDirectories,
	layoutVariants,
	localize,
	matrix,
	notCovered,
	notCoveredStates,
	quickVariants,
	referenceName,
	selectorFor,
	variants,
} from "../lib/screens.ts";
import { platformDir } from "../lib/paths.ts";

function mobilePages(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...mobilePages(path));
		else if (entry.name === "+mobile.svelte") found.push(dir);
	}
	return found;
}

describe("the screen matrix", () => {
	test("every screen is in a state the plan names and has a unique id", () => {
		expect(new Set(cases.map((screen) => screen.id)).size).toBe(cases.length);
		expect(cases.map((screen) => screen.state)).toContain("loading");
		expect(cases.map((screen) => screen.state)).toContain("error");
		for (const screen of cases) expect(["ready", "loading", "error"]).toContain(screen.state);
	});

	test("the parity variants are every combination of theme, direction and text size", () => {
		expect(variants.length).toBe(8);
		expect(new Set(variants.map((variant) => variant.id)).size).toBe(8);
		expect(variants.filter((variant) => variant.direction === "rtl").length).toBe(4);
		expect(variants.filter((variant) => variant.theme === "dark").length).toBe(4);
		expect(variants.filter((variant) => variant.fontScale === 2).length).toBe(4);
		for (const variant of [...quickVariants, ...layoutVariants])
			expect(
				variants.some(
					(candidate) =>
						candidate.direction === variant.direction && candidate.fontScale === variant.fontScale,
				),
			).toBe(true);
	});

	test("the matrix leaves out the two states that cannot be reached at the largest text, and says so", () => {
		const all = matrix(cases, variants);
		expect(all.length).toBe(cases.length * variants.length - 2 * 4);
		const left = cases.filter((screen) => !screen.largestText).map((screen) => screen.id);
		expect(left).toEqual(["dev-async-loading", "dev-async-error"]);
		expect(
			all.some((entry) => left.includes(entry.screen.id) && entry.variant.fontScale === 2),
		).toBe(false);
		expect(all.filter((entry) => left.includes(entry.screen.id)).length).toBe(8);
		expect(notCoveredStates.length).toBe(2);
		for (const entry of notCoveredStates) expect(entry.reason.includes("scroll")).toBe(true);
		expect(matrix(cases, [variants[0] as (typeof variants)[number]]).length).toBe(cases.length);
	});

	test("references are named screen--variant", () => {
		const screen = cases[0];
		const variant = variants[0];
		if (!screen || !variant) throw new Error("empty matrix");
		expect(referenceName(screen, variant)).toBe(`${screen.id}--${variant.id}`);
		expect(variants.map((entry) => entry.id)).toContain("dark-rtl-large");
	});

	test("text that differs by language is chosen by direction", () => {
		expect(localize("Same", "rtl")).toBe("Same");
		expect(localize({ en: "Retry", ar: "إعادة المحاولة" }, "rtl")).toBe("إعادة المحاولة");
		expect(selectorFor({ label: { en: "a", ar: "b" }, className: "x" }, "ltr")).toEqual({
			label: "a",
			className: "x",
		});
		expect(selectorFor({ className: "x" }, "ltr")).toEqual({ className: "x" });
	});

	test("a sheet or modal declares the screen it covers, which must be hidden from accessibility", () => {
		for (const screen of cases.filter(
			(entry) => entry.layout === "sheet" || entry.layout === "modal",
		))
			expect(screen.hidden.length > 0).toBe(true);
	});
});

describe("route accounting", () => {
	const root = join(platformDir, "src/routes");
	const pages = mobilePages(root).map((dir) => relative(root, dir));
	const accounted = new Set([
		...coveredRouteDirectories,
		...notCovered.map((entry) => entry.route.replace(/^\//, "")),
	]);

	test("every mobile page is either reached by a case or listed with the reason it is not", () => {
		expect(pages.filter((page) => !accounted.has(page))).toEqual([]);
	});

	test("no entry names a page that does not exist", () => {
		expect([...accounted].filter((entry) => !pages.includes(entry))).toEqual([]);
	});

	test("not-covered routes give a reason", () => {
		for (const entry of notCovered) expect(entry.reason.length > 20).toBe(true);
	});
});
