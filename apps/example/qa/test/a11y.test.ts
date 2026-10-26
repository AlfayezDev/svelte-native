import { describe, expect, test } from "bun:test";
import {
	analyzeScreen,
	focusStops,
	isActionable,
	isInteractive,
	type A11yInput,
} from "../lib/a11y.ts";
import { cases, localize } from "../lib/screens.ts";
import { parseHierarchy } from "../lib/uia.ts";
import { sample } from "./sample.ts";

type N = {
	cls?: string;
	text?: string;
	desc?: string;
	bounds: [number, number, number, number];
	clickable?: boolean;
	focusable?: boolean;
	enabled?: boolean;
	scrollable?: boolean;
	children?: N[];
};

function node(n: N): string {
	const [l, t, r, b] = n.bounds;
	return `<node index="0" text="${n.text ?? ""}" resource-id="" class="${n.cls ?? "android.widget.TextView"}" package="p" content-desc="${n.desc ?? ""}" checkable="false" checked="false" clickable="${n.clickable ?? false}" enabled="${n.enabled ?? true}" focusable="${n.focusable ?? false}" focused="false" scrollable="${n.scrollable ?? false}" long-clickable="false" password="false" selected="false" bounds="[${l},${t}][${r},${b}]">${(n.children ?? []).map(node).join("")}</node>`;
}

function tree(...nodes: N[]) {
	return parseHierarchy(
		`<?xml version='1.0' ?><hierarchy rotation="0">${node({ cls: "android.widget.FrameLayout", bounds: [0, 0, 1080, 2400], children: nodes })}</hierarchy>`,
	);
}

const display = { width: 1080, height: 2400 };

function analyze(nodes: N[], fields: Partial<A11yInput> = {}) {
	return analyzeScreen({
		tree: tree(...nodes),
		direction: "ltr",
		display,
		title: null,
		lead: [],
		controls: [],
		scrolled: [],
		hidden: [],
		layout: "page",
		...fields,
	});
}

const button = (label: string, bounds: N["bounds"], extra: Partial<N> = {}): N => ({
	cls: "android.widget.Button",
	desc: label,
	bounds,
	clickable: true,
	focusable: true,
	...extra,
});

describe("what counts as interactive", () => {
	test("by class or by action", () => {
		const t = tree(
			{ cls: "android.widget.Button", bounds: [0, 0, 10, 10] },
			{ cls: "android.widget.TextView", clickable: true, bounds: [0, 0, 10, 10] },
			{ bounds: [0, 0, 10, 10] },
			{ cls: "android.widget.EditText", bounds: [0, 0, 10, 10] },
		);
		const flags = t.nodes.slice(1).map((n) => [isInteractive(n), isActionable(n)]);
		expect(flags).toEqual([
			[true, false],
			[true, true],
			[false, false],
			[true, true],
		]);
	});
});

describe("reachable, labeled, actionable", () => {
	test("a labeled, clickable button passes all three", () => {
		const r = analyze([button("Save", [100, 200, 500, 300])]);
		expect([r.interactive, r.reachable, r.labeled, r.actionable]).toEqual([1, 1, 1, 1]);
		expect(r.findings).toEqual([]);
	});

	test("a button class that advertises no click is not actionable but is reachable by its label", () => {
		const r = analyze([
			button("Save", [100, 200, 500, 300], { clickable: false, focusable: false }),
		]);
		expect([r.reachable, r.labeled, r.actionable, r.notActionable]).toEqual([1, 1, 0, 1]);
		expect(r.findings.map((f) => f.kind)).toEqual(["notActionable"]);
	});

	test("a button with no text, description or labeled descendant is unlabeled and cannot be focused", () => {
		const r = analyze([{ cls: "android.widget.Button", bounds: [0, 0, 100, 100] }]);
		expect([r.unreachable, r.unlabeled, r.notActionable]).toEqual([1, 1, 1]);
	});

	test("a label on a descendant counts", () => {
		const r = analyze([
			button("", [0, 0, 400, 100], { children: [{ text: "Save", bounds: [10, 10, 90, 60] }] }),
		]);
		expect(r.unlabeled).toBe(0);
	});

	test("zero-size and off-screen interactive nodes are unreachable; a clipped one is skipped; a disabled one is exempt", () => {
		const r = analyze([
			button("Zero", [10, 10, 10, 50]),
			button("Gone", [2000, 10, 2100, 50]),
			button("Clipped", [76, 2281, 1004, 2169]),
			button("Off", [10, 300, 200, 400], { enabled: false }),
		]);
		expect([r.interactive, r.unreachable, r.clipped, r.disabled, r.reachable]).toEqual([
			4, 2, 1, 1, 0,
		]);
		expect(r.findings.map((f) => f.detail)).toEqual(["zero-size bounds", "outside the display"]);
	});

	test("a control the screen declares but the tree lacks is unreachable", () => {
		const r = analyze([button("Save", [0, 0, 100, 100])], { controls: ["Save", "Notifications"] });
		expect([r.interactive, r.unreachable]).toEqual([2, 1]);
		expect(r.findings[0]).toEqual({
			kind: "unreachable",
			element: '"Notifications"',
			detail: "declared by the screen but not in the accessibility tree",
		});
	});

	test("a control below the fold at the largest text is checked when the tree has it and never reported missing", () => {
		const absent = analyze([button("Save", [0, 0, 100, 100])], { scrolled: ["Reset"] });
		expect([absent.interactive, absent.unreachable]).toEqual([1, 0]);
		const present = analyze(
			[button("Save", [0, 0, 100, 100]), { text: "Reset", bounds: [0, 200, 100, 300] }],
			{ scrolled: ["Reset"] },
		);
		expect([present.interactive, present.notActionable]).toEqual([2, 1]);
	});

	test("a declared control that is only plain text is not actionable; one inside an unlabeled button is that button's defect", () => {
		const plain = analyze([{ text: "Back", bounds: [0, 0, 100, 50] }], { controls: ["Back"] });
		expect([plain.interactive, plain.notActionable]).toEqual([1, 1]);
		const inside = analyze(
			[
				{ cls: "android.widget.Button", bounds: [0, 0, 300, 100] },
				{ text: "Segment", bounds: [20, 20, 200, 80] },
			],
			{ controls: ["Segment"] },
		);
		expect(inside.interactive).toBe(1);
	});
});

describe("focus stops and order", () => {
	test("a stop folds its subtree unless something interactive is inside", () => {
		const t = tree(
			button("Group", [0, 0, 500, 200], { children: [{ text: "inner", bounds: [0, 0, 50, 50] }] }),
			{
				focusable: true,
				bounds: [0, 300, 900, 900],
				children: [{ text: "a", bounds: [0, 300, 50, 350] }, button("b", [0, 400, 500, 500])],
			},
		);
		// "Group" folds its inner text; the focusable container has an interactive child, so its subtree stays walkable.
		expect(focusStops(t).map((n) => n.text || n.contentDesc || n.className)).toEqual([
			"Group",
			"android.widget.TextView",
			"a",
			"b",
		]);
	});

	test("a scroll view is not a stop even when it is focusable", () => {
		const t = tree({
			cls: "android.widget.ScrollView",
			focusable: true,
			bounds: [0, 0, 1080, 2400],
			children: [{ text: "row", bounds: [0, 0, 100, 50] }],
		});
		expect(focusStops(t).map((n) => n.text)).toEqual(["row"]);
	});

	test("top to bottom, left to right", () => {
		const ok = analyze([
			{ text: "a", bounds: [0, 100, 300, 150] },
			{ text: "b", bounds: [400, 100, 700, 150] },
			{ text: "c", bounds: [0, 300, 300, 350] },
		]);
		expect(ok.orderViolations).toBe(0);
		const upside = analyze([
			{ text: "c", bounds: [0, 300, 300, 350] },
			{ text: "a", bounds: [0, 100, 300, 150] },
		]);
		expect(upside.orderViolations).toBe(1);
		const swapped = analyze([
			{ text: "b", bounds: [400, 100, 700, 150] },
			{ text: "a", bounds: [0, 100, 300, 150] },
		]);
		expect(swapped.orderViolations).toBe(1);
	});

	test("in right-to-left the start of a row is its right edge", () => {
		const rowRtl = [
			{ text: "b", bounds: [700, 100, 1000, 150] },
			{ text: "a", bounds: [100, 100, 400, 150] },
		] satisfies N[];
		expect(analyze(rowRtl, { direction: "rtl" }).orderViolations).toBe(0);
		expect(analyze(rowRtl, { direction: "ltr" }).orderViolations).toBe(1);
	});

	test("stacked stops (one inside the other) are not compared", () => {
		const r = analyze([
			button("Go", [100, 400, 900, 500]),
			{ text: "Go", bounds: [300, 420, 700, 480] },
			{ text: "after", bounds: [0, 600, 200, 650] },
		]);
		expect(r.orderViolations).toBe(0);
	});

	test("a header leads with its title, then the controls at its start side, by design", () => {
		const header = [
			{ desc: "Screen", bounds: [147, 128, 933, 275] },
			button("Navigate up", [0, 128, 126, 275]),
			button("Search", [954, 128, 1080, 275]),
			{ text: "row", bounds: [76, 351, 1004, 405] },
		] satisfies N[];
		const r = analyze(header, { title: "Screen", layout: "header" });
		expect([r.orderViolations, r.titleFirst]).toEqual([0, true]);
		// A page has no such exemption: the same order is a violation there.
		expect(analyze(header, { title: "Screen", layout: "page" }).orderViolations).toBe(1);
	});

	test("content before the title, or no title at all, fails title first", () => {
		const before = analyze(
			[
				{ text: "content", bounds: [0, 600, 500, 650] },
				{ text: "Title", bounds: [0, 100, 500, 200] },
			],
			{ title: "Title" },
		);
		expect(before.titleFirst).toBe(false);
		const missing = analyze([{ text: "content", bounds: [0, 600, 500, 650] }], { title: "Title" });
		expect(missing.titleFirst).toBe(false);
		expect(missing.findings[0]?.kind).toBe("title");
		const back = analyze(
			[button("Back", [0, 50, 200, 100]), { text: "Title", bounds: [0, 150, 500, 250] }],
			{ title: "Title" },
		);
		expect(back.titleFirst).toBe(true);
		expect(analyze([{ text: "x", bounds: [0, 0, 5, 5] }]).titleFirst).toBeNull();
	});

	test("the center slot's lead stops are exempt from the start-side rule", () => {
		const slots = [
			{ text: "Segment A", bounds: [160, 178, 332, 225] },
			{ text: "Segment B", bounds: [395, 178, 566, 225] },
			{ text: "×", bounds: [50, 168, 76, 233] },
			button("Search", [954, 128, 1080, 275]),
		] satisfies N[];
		expect(
			analyze(slots, { title: "Segment A", lead: ["Segment B"], layout: "header" }).orderViolations,
		).toBe(0);
		expect(analyze(slots, { title: "Segment A", lead: [], layout: "header" }).orderViolations).toBe(
			1,
		);
	});
});

describe("focus trap", () => {
	test("labels of the covered screen left in the tree are leaks", () => {
		const r = analyze([button("Push", [0, 0, 100, 100]), button("Close", [0, 200, 100, 300])], {
			hidden: ["Push", "Other"],
		});
		expect(r.focusLeaks).toBe(1);
		expect(r.findings.map((f) => f.kind)).toEqual(["leak"]);
	});
});

describe("frozen dumps of the QA app (the checklist's findings in them, not the engine's state today)", () => {
	function screen(file: string, id: string, direction: "ltr" | "rtl" = "ltr") {
		const c = cases.find((entry) => entry.id === id);
		if (!c) throw new Error(`no case ${id}`);
		return analyzeScreen({
			tree: parseHierarchy(sample(file)),
			direction,
			display,
			title: c.title === null ? null : localize(c.title, direction),
			lead: c.lead.map((label) => localize(label, direction)),
			controls: c.controls.map((label) => localize(label, direction)),
			scrolled: c.scrolled.map((label) => localize(label, direction)),
			hidden: c.hidden.map((label) => localize(label, direction)),
			layout: c.layout,
		});
	}

	test("large-title header: the title is not exposed and the header comes after the content", () => {
		const r = screen("uia-screens-menu.xml", "screens-menu");
		expect(r.titleFirst).toBe(false);
		expect(r.orderViolations).toBe(1);
		expect(r.interactive).toBe(10);
		expect(r.notActionable).toBe(8);
		expect(
			r.findings.some((f) => f.kind === "unreachable" && f.element === '"Notifications"'),
		).toBe(true);
	});

	test("inline header: title first, back button a clickable stop, slot content missing", () => {
		const r = screen("uia-screens-header.xml", "screens-header");
		expect(r.titleFirst).toBe(true);
		expect(r.orderViolations).toBe(0);
		expect(r.stops.slice(0, 2)).toEqual(["Screen 1, Native header", "Navigate up"]);
		expect([r.interactive, r.actionable, r.unreachable]).toEqual([2, 1, 1]);
	});

	test("tab bar items are clickable and labeled with position and badge", () => {
		const r = screen("uia-screens-tabs.xml", "screens-tabs");
		expect(r.titleFirst).toBe(true);
		expect(r.stops).toContain("Inbox, 99+");
		expect(r.stops).toContain("Home, new items");
		expect(r.unreachable).toBe(0);
	});

	test("the Arabic login: right-to-left order holds and the title leads", () => {
		const r = screen("uia-login-ar.xml", "login", "rtl");
		expect(r.titleFirst).toBe(true);
		expect(r.orderViolations).toBe(0);
		expect(r.stops[0]).toBe("ما بريدك الإلكتروني؟");
		expect(r.unreachable).toBe(0);
	});

	test("a spinner screen has a title and a labeled progress bar", () => {
		const r = screen("uia-startup-loading.xml", "startup-loading");
		expect(r.stops).toEqual(["Rasheed", "Loading…"]);
		expect(r.titleFirst).toBe(true);
	});

	test("the same screen at the largest text keeps the same findings", () => {
		const normal = screen("uia-screens-menu.xml", "screens-menu");
		const large = screen("uia-menu-large-text.xml", "screens-menu");
		expect([large.interactive, large.notActionable, large.titleFirst]).toEqual([
			normal.interactive,
			normal.notActionable,
			normal.titleFirst,
		]);
	});
});
