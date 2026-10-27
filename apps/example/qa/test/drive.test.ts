import { describe, expect, test } from "bun:test";
import { dumpWithOwnControls, findNode, matches, maskRects } from "../lib/drive.ts";
import { cases, ownLabels } from "../lib/screens.ts";
import { parseHierarchy, type UiTree } from "../lib/uia.ts";
import { sample } from "./sample.ts";

describe("selectors and masks", () => {
	const tree = parseHierarchy(sample("uia-startup-loading.xml"));

	test("a node answers to its text or content description, and to its class", () => {
		const bar = tree.nodes.find((node) => node.className === "android.widget.ProgressBar");
		if (!bar) throw new Error("no progress bar in the sample");
		expect(matches(bar, { label: "Loading…" })).toBe(true);
		expect(matches(bar, { className: "android.widget.ProgressBar" })).toBe(true);
		expect(matches(bar, { className: "android.widget.Button" })).toBe(false);
		expect(matches(bar, { label: "Rasheed" })).toBe(false);
		expect(findNode(tree, { label: "Rasheed" }, "ltr")?.className).toBe("android.widget.TextView");
		expect(findNode(tree, { label: "nothing" }, "ltr")).toBeNull();
	});

	test("the startup spinner's bounds are the case's mask", () => {
		const startup = cases.find((entry) => entry.id === "startup-loading");
		if (!startup) throw new Error("no startup-loading case");
		expect(maskRects(tree, startup, "ltr")).toEqual([{ x: 63, y: 360, width: 53, height: 54 }]);
	});

	test("a mask that matches nothing is an error, not an unmasked reference", () => {
		const startup = cases.find((entry) => entry.id === "startup-loading");
		if (!startup) throw new Error("no startup-loading case");
		const empty = parseHierarchy(sample("uia-screens-header.xml"));
		expect(() => maskRects(empty, startup, "ltr")).toThrow("matches no node");
	});

	test("a node that is only on screen at some text sizes is masked when it is there and ignored when it is not", () => {
		const animation = cases.find((entry) => entry.id === "dev-animation");
		if (!animation) throw new Error("no dev-animation case");
		expect(maskRects(tree, animation, "ltr")).toEqual([]);
		const shown = parseHierarchy(
			`<?xml version='1.0' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.view.ViewGroup" package="p" content-desc="Reanimated test square" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[105,1526][242,1663]" /></hierarchy>`,
		);
		expect(maskRects(shown, animation, "ltr")).toEqual([
			{ x: 105, y: 1526, width: 137, height: 137 },
		]);
	});
});

describe("the dump a service walks, taken until it holds the screen's own controls", () => {
	const sheet = parseHierarchy(sample("uia-screens-sheet-important.xml"));
	const modal = parseHierarchy(sample("uia-screens-modal-important.xml"));
	const empty = parseHierarchy(sample("uia-screens-header.xml").replace(/<node [^>]*\/>/g, ""));
	const sequence = (...trees: UiTree[]) => {
		let calls = 0;
		return { dump: async () => trees[Math.min(calls++, trees.length - 1)] as UiTree, calls: () => calls };
	};

	test("the labels that say the screen itself is up: its declared controls, or its title when it declares none", () => {
		const find = (id: string) => cases.find((entry) => entry.id === id);
		const formSheet = find("screens-form-sheet");
		const twoDetents = find("screens-sheet");
		if (!formSheet || !twoDetents) throw new Error("no sheet cases");
		expect(ownLabels(formSheet, "ltr")).toEqual(["Close", "Name", "Save"]);
		expect(ownLabels(twoDetents, "ltr")).toEqual(["Two detents"]);
		expect(ownLabels(twoDetents, "rtl")).toEqual(["Two detents"]);
	});

	test("a dump that already holds them is the one used", async () => {
		const source = sequence(sheet);
		expect(await dumpWithOwnControls(source.dump, ["Two detents"], 3, 0)).toBe(sheet);
		expect(source.calls()).toBe(1);
	});

	test("a half-built dump is taken again until the controls are there", async () => {
		const source = sequence(empty, modal);
		expect(await dumpWithOwnControls(source.dump, ["Notifications"], 3, 0)).toBe(modal);
		expect(source.calls()).toBe(2);
	});

	test("three dumps without them end in an error naming what is missing, which the suite records for the screen", async () => {
		const source = sequence(empty);
		await expect(dumpWithOwnControls(source.dump, ["Notifications", "Two detents"], 3, 0)).rejects.toThrow(
			'the important-views dump lacks "Notifications", "Two detents" of the screen itself after 3 dumps',
		);
		expect(source.calls()).toBe(3);
	});

	test("a control that is in the dump with no size is not on screen", async () => {
		const unsized = parseHierarchy(
			`<?xml version='1.0' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.Button" package="p" content-desc="Save" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][0,0]" /></hierarchy>`,
		);
		await expect(dumpWithOwnControls(sequence(unsized).dump, ["Save"], 1, 0)).rejects.toThrow("lacks");
	});
});
