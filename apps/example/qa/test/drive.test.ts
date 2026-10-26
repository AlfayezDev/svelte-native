import { describe, expect, test } from "bun:test";
import { findNode, matches, maskRects } from "../lib/drive.ts";
import { cases } from "../lib/screens.ts";
import { parseHierarchy } from "../lib/uia.ts";
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
