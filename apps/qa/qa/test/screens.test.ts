import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
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
	type ScreenCase,
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

	test("the matrix leaves out the states that cannot be reached or masked at the largest text, and says so", () => {
		const all = matrix(cases, variants);
		const left = cases.filter((screen) => !screen.largestText).map((screen) => screen.id);
		expect(left).toEqual(["dev-async-loading", "dev-async-error"]);
		expect(all.length).toBe(cases.length * variants.length - left.length * 4);
		expect(
			all.some((entry) => left.includes(entry.screen.id) && entry.variant.fontScale === 2),
		).toBe(false);
		expect(all.filter((entry) => left.includes(entry.screen.id)).length).toBe(left.length * 4);
		expect(notCoveredStates.length).toBe(left.length);
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

describe("the way a screen is reached decides whether it has a back button", () => {
	// The router makes the launch link the base of the stack (no back arrow): a screen declared with "Navigate up" is one the lab
	// pushes, so the launch link is the screen under it and a step pushes it.
	const wantsBack = cases.filter((screen) => screen.controls.some((control) => localize(control, "ltr") === "Navigate up"));

	test("the cases that declare the back button", () => {
		expect(wantsBack.map((screen) => screen.id)).toEqual([
			"screens-menu",
			"screens-header",
			"screens-translucent",
			"screens-toolbar",
			"screens-toolbar-center",
			"tree-detail",
		]);
	});

	test("each is pushed by a step, except the one a pane's stack gives its back arrow itself", () => {
		for (const screen of wantsBack.filter((entry) => entry.id !== "tree-detail")) {
			expect(screen.steps.some((step) => "tap" in step || "open" in step)).toBe(true);
			expect(screen.deepLink?.endsWith(screen.route.replace("/__dev", ""))).toBe(false);
		}
		const detail = wantsBack.find((entry) => entry.id === "tree-detail");
		expect(detail?.steps).toEqual([]);
		expect(detail?.deepLink).toBe("expo-svelte-qa:///__dev/tree/home/detail/7");
	});

	test("the base is the lab's own screen for the menu and the menu for the screens it pushes, by its button where it has one (the toolbar screens over screen 1)", () => {
		const byId = (id: string) => cases.find((entry) => entry.id === id) as ScreenCase;
		expect(byId("screens-menu").deepLink).toBe("expo-svelte-qa:///__dev");
		for (const id of ["screens-header", "screens-translucent", "screens-toolbar", "screens-toolbar-center"])
			expect(byId(id).deepLink).toBe("expo-svelte-qa:///__dev/screens");
		expect(byId("screens-header").steps.map((step) => JSON.stringify(step))).toContain(JSON.stringify({ tap: { label: "Push eight screens with headers" } }));
		expect(byId("screens-translucent").steps.map((step) => JSON.stringify(step))).toContain(JSON.stringify({ tap: { label: "Translucent header over content" } }));
		expect(byId("screens-toolbar").steps.map((step) => JSON.stringify(step))).toContain(JSON.stringify({ open: "expo-svelte-qa:///__dev/screens?mode=toolbar" }));
		expect(byId("screens-toolbar-center").steps.map((step) => JSON.stringify(step))).toContain(JSON.stringify({ open: "expo-svelte-qa:///__dev/screens?mode=toolbar-center" }));
	});

	// A goto or a link to the page the user is on with another query changes that screen in place (the router's rule since rc.6). Every
	// page of the screens lab is the one page with another `?mode=`: a button of it that pushes must say so, or the screen it opens has no
	// screen under it and no "Navigate up" (#49).
	test("the screens lab's own buttons that open another of its pages ask for a push or a presentation", () => {
		const menu = readFileSync(join(platformDir, "src/routes/__dev/screens/+mobile.svelte"), "utf8");
		const ownPage = [...menu.matchAll(/router\.goto\((["`])\/__dev\/screens\?[^"`]*\1([^)]*)\)/g)];
		expect(ownPage.length).toBeGreaterThanOrEqual(10);
		for (const [call, , options] of ownPage) expect([call, /^, (push|\{ presentation: "\w+" \})$/.test(options ?? "")]).toEqual([call, true]);
		expect(menu).toMatch(/const push = \{ presentation: "push" \}/);
	});

	test("the lab's stress scenarios and the iOS probe that push the page they are on ask for a push", () => {
		const stress = readFileSync(join(platformDir, "src/lib/native/dev/Stress.svelte"), "utf8");
		expect(stress).toContain('router.goto("/__dev/screen?header=none", { presentation: "push" });'); // navigation-8, over its bare base screen
		expect(stress).toContain('router.goto(`/__dev/screens?mode=header&depth=${level}`, { presentation: "push" });'); // header-8
		expect(stress).toContain('router.goto("/__dev/screens?mode=header&depth=2", { presentation: "push" });'); // the soak's header part
		const probe = readFileSync(join(platformDir, "src/lib/native/dev/probe.ts"), "utf8");
		expect(probe).toContain('["pushed screen", `${screens}?mode=header&depth=2`, "push"]'); // dismissal, over the menu
	});

	test("a link opened onto the menu would change it in place, so the toolbar screens open theirs onto the screen the menu's button pushes", () => {
		for (const id of ["screens-toolbar", "screens-toolbar-center"]) {
			const steps = (cases.find((entry) => entry.id === id) as ScreenCase).steps.map((step) => JSON.stringify(step));
			const pushed = steps.indexOf(JSON.stringify({ tap: { label: "Push eight screens with headers" } }));
			const landed = steps.indexOf(JSON.stringify({ wait: { label: "Screen 1, Native header" } }));
			const opened = steps.findIndex((step) => step.startsWith('{"open":'));
			expect([pushed >= 0, pushed < landed, landed < opened]).toEqual([true, true, true]);
		}
	});

	test("a button the case taps is on the lab menu's page", () => {
		const menu = readFileSync(join(platformDir, "src/routes/__dev/screens/+mobile.svelte"), "utf8");
		for (const screen of cases)
			for (const step of screen.steps)
				if ("tap" in step && screen.deepLink?.endsWith("/__dev/screens"))
					expect(menu).toContain(`"${localize(step.tap.label as string, "ltr")}"`);
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
