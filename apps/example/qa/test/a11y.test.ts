import { describe, expect, test } from "bun:test";
import {
	analyzeScreen,
	focusStops,
	isToolbarNode,
	isActionable,
	isInteractive,
	type A11yInput,
} from "../lib/a11y.ts";
import { cases, localize } from "../lib/screens.ts";
import { parseHierarchy } from "../lib/uia.ts";
import { login, startupLoading } from "./fixture-cases.ts";
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
		const r = analyze(
			[
				button("Zero", [10, 10, 10, 50]),
				button("Gone", [2000, 10, 2100, 50]),
				{
					cls: "androidx.recyclerview.widget.RecyclerView",
					scrollable: true,
					bounds: [0, 0, 1080, 2400],
					children: [button("Clipped", [76, 2281, 1004, 2169])],
				},
				button("Off", [10, 300, 200, 400], { enabled: false }),
			],
			{ scrolled: ["Clipped"] },
		);
		expect([r.interactive, r.unreachable, r.clipped, r.disabled, r.reachable]).toEqual([
			4, 2, 1, 1, 0,
		]);
		expect(r.findings.map((f) => f.detail)).toEqual(["zero-size bounds", "outside the display"]);
	});

	test("a control outside the display is clipped only inside a scroll container, and only when the screen declares it below the fold", () => {
		const scroller = (child: N): N => ({
			cls: "android.widget.ScrollView",
			scrollable: true,
			bounds: [0, 0, 1080, 2400],
			children: [child],
		});
		const below = button("Below", [10, 2500, 400, 2600]);
		const declared = analyze([scroller(below)], { scrolled: ["Below"] });
		expect([declared.clipped, declared.unreachable, declared.findings]).toEqual([1, 0, []]);
		const undeclared = analyze([scroller(below)]);
		expect([undeclared.clipped, undeclared.unreachable]).toEqual([0, 1]);
		expect(undeclared.findings[0]?.detail).toBe("outside the display");
		const fixed = analyze([below], { scrolled: ["Below"] });
		expect([fixed.clipped, fixed.unreachable]).toEqual([0, 1]);
		expect(fixed.findings[0]?.detail).toBe("outside the display");
		const negative = analyze([button("Negative", [76, 2281, 1004, 2169])]);
		expect([negative.clipped, negative.unreachable]).toEqual([0, 1]);
		expect(negative.findings[0]?.detail).toContain("negative extent");
	});

	test("a control with no visible size defers to the clipped rule: clipped inside a scroll container when declared below the fold, unreachable anywhere else", () => {
		const scroller = (child: N): N => ({
			cls: "android.widget.ScrollView",
			bounds: [0, 0, 1080, 2400],
			children: [child],
		});
		const edge = button("Edge", [97, 2337, 983, 2337]);
		const declared = analyze([scroller(edge)], { scrolled: ["Edge"] });
		expect([declared.clipped, declared.unreachable, declared.findings]).toEqual([1, 0, []]);
		const undeclared = analyze([scroller(edge)]);
		expect([undeclared.clipped, undeclared.unreachable, undeclared.findings[0]?.detail]).toEqual([0, 1, "zero-size bounds"]);
		const outside = analyze([edge], { scrolled: ["Edge"] });
		expect([outside.clipped, outside.unreachable, outside.findings[0]?.detail]).toEqual([0, 1, "zero-size bounds"]);
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

	test("a header reads its back button, then the title, then the controls at its end, start to end", () => {
		const header = [
			button("Navigate up", [0, 128, 126, 275]),
			{ desc: "Screen", bounds: [147, 128, 933, 275] },
			button("Search", [954, 128, 1080, 275]),
			{ text: "row", bounds: [76, 351, 1004, 405] },
		] satisfies N[];
		for (const layout of ["header", "page"] as const) {
			const r = analyze(header, { title: "Screen", layout });
			expect([r.orderViolations, r.titleFirst, r.findings]).toEqual([0, true, []]);
		}
		// RTL mirrors it: the back button at the right edge is the start.
		const rtl = [
			button("Navigate up", [954, 128, 1080, 275]),
			{ desc: "Screen", bounds: [147, 128, 933, 275] },
			button("Search", [0, 128, 126, 275]),
			{ text: "row", bounds: [76, 351, 1004, 405] },
		] satisfies N[];
		const mirrored = analyze(rtl, { title: "Screen", layout: "header", direction: "rtl" });
		expect([mirrored.orderViolations, mirrored.titleFirst]).toEqual([0, true]);
	});

	test("the title before the back button was the old order: now an order violation, and an end control before the title fails title first", () => {
		const old = analyze(
			[
				{ desc: "Screen", bounds: [147, 128, 933, 275] },
				button("Navigate up", [0, 128, 126, 275]),
				button("Search", [954, 128, 1080, 275]),
			],
			{ title: "Screen", layout: "header" },
		);
		expect([old.titleFirst, old.orderViolations]).toEqual([true, 1]);
		const end = analyze(
			[
				button("Navigate up", [0, 128, 126, 275]),
				button("Search", [954, 128, 1080, 275]),
				{ desc: "Screen", bounds: [147, 128, 933, 275] },
			],
			{ title: "Screen", layout: "header" },
		);
		expect(end.titleFirst).toBe(false);
		expect(end.findings.find((f) => f.kind === "title")?.detail).toContain("end side");
	});

	test("a large title is the bar's second row: read after the back button and before the end controls, which is the one step that goes up", () => {
		const large = [
			button("Navigate up", [0, 128, 126, 275]),
			{ desc: "Native screens", bounds: [42, 275, 1038, 422] },
			button("Notifications", [954, 128, 1080, 275]),
			{ text: "row", bounds: [42, 464, 1038, 558] },
		] satisfies N[];
		const r = analyze(large, { title: "Native screens", layout: "header" });
		expect([r.titleFirst, r.orderViolations, r.findings]).toEqual([true, 0, []]);
		// A page has no bar over its title: the same step up is a violation there.
		expect(analyze(large, { title: "Native screens", layout: "page" }).orderViolations).toBe(1);
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

	test("the center slot follows the left slot: its first control is the title, the next one follows it", () => {
		const slots = [
			button("Close", [50, 168, 126, 233]),
			{ text: "Segment A", bounds: [160, 178, 332, 225] },
			{ text: "Segment B", bounds: [395, 178, 566, 225] },
			button("Search", [954, 128, 1080, 275]),
		] satisfies N[];
		const r = analyze(slots, { title: "Segment A", layout: "header" });
		expect([r.orderViolations, r.titleFirst]).toEqual([0, true]);
		// The center slot before the left slot, the order before this one, runs against the start edge.
		const centerFirst = [slots[1], slots[2], slots[0], slots[3]] as N[];
		expect(analyze(centerFirst, { title: "Segment A", layout: "header" }).orderViolations).toBe(1);
	});
});

describe("a stop that says nothing itself is judged by what it holds", () => {
	// The QA slots screen (emulator run of 27 Oct): each segment is a `Pressable`, a clickable Button whose label is the Text inside it.
	const segment = (label: string, bounds: N["bounds"]): N => ({
		cls: "android.widget.Button",
		bounds,
		clickable: true,
		focusable: true,
		children: [{ text: label, bounds: [bounds[0] + 40, bounds[1] + 20, bounds[2] - 40, bounds[3] - 20] }],
	});

	test("the center slot's segments are the title and the control after it, and the stops are named by their text", () => {
		const slots = [
			button("Close", [0, 138, 126, 264]),
			segment("Segment A", [129, 155, 364, 250]),
			segment("Segment B", [364, 155, 598, 250]),
			button("Notifications", [954, 138, 1080, 264]),
			{ text: "Row 1", bounds: [76, 351, 1004, 405] },
		] satisfies N[];
		const r = analyze(slots, { title: "Segment A", layout: "header" });
		expect(r.stops.slice(0, 4)).toEqual(["Close", "Segment A", "Segment B", "Notifications"]);
		expect([r.titleFirst, r.orderViolations, r.findings]).toEqual([true, 0, []]);
	});

	test("in right-to-left the first segment is at the end of the row and the order holds the same way", () => {
		const slots = [
			button("Close", [954, 138, 1080, 264]),
			segment("Segment A", [482, 155, 716, 250]),
			segment("Segment B", [248, 155, 482, 250]),
			button("Notifications", [0, 138, 126, 264]),
		] satisfies N[];
		const r = analyze(slots, { title: "Segment A", layout: "header", direction: "rtl" });
		expect([r.titleFirst, r.orderViolations]).toEqual([true, 0]);
	});

	test("a group whose text is not the title does not stand in for it, and a control inside a group is not part of its label", () => {
		const r = analyze([segment("Other", [129, 155, 364, 250])], { title: "Segment A", layout: "header" });
		expect(r.titleFirst).toBe(false);
		const group: N = {
			cls: "android.widget.Button",
			bounds: [0, 100, 600, 300],
			clickable: true,
			focusable: true,
			children: [{ text: "Title", bounds: [10, 110, 200, 160] }, button("Inner", [300, 110, 500, 290])],
		};
		expect(analyze([group], { title: "Title", layout: "header" }).titleFirst).toBe(true);
		expect(analyze([group], { title: "Title, Inner", layout: "header" }).titleFirst).toBe(false);
	});
});

describe("an overlay header read after the content", () => {
	// The QA translucent and large-title screens before EngineScreen.addChildrenForAccessibility: the rows, then the bar.
	const rows: N[] = [
		{ text: "Row 1", bounds: [76, 351, 1004, 405] },
		{ text: "Row 2", bounds: [76, 430, 1004, 484] },
	];
	const bar: N[] = [
		button("Navigate up", [0, 128, 126, 275]),
		{ desc: "Translucent, Content runs under the bar", bounds: [147, 128, 933, 275] },
	];

	test("is a title finding and an order finding; the header first has neither", () => {
		const after = analyze([...rows, ...bar], { title: "Translucent, Content runs under the bar", layout: "header" });
		expect([after.titleFirst, after.orderViolations]).toEqual([false, 1]);
		expect(after.findings.map((f) => f.kind)).toEqual(["title", "order"]);
		const first = analyze([...bar, ...rows], { title: "Translucent, Content runs under the bar", layout: "header" });
		expect([first.titleFirst, first.orderViolations, first.findings]).toEqual([true, 0, []]);
	});

	test("a large title that is not in the tree is a title finding; as a heading in the second row it leads", () => {
		const title = "Native screens";
		const none = analyze([button("Navigate up", [0, 128, 126, 275]), ...rows], { title, layout: "header" });
		expect(none.findings.map((f) => f.kind)).toEqual(["title"]);
		const large = analyze(
			[{ desc: title, bounds: [42, 275, 1038, 422] }, button("Navigate up", [0, 128, 126, 275]), button("Notifications", [954, 128, 1080, 275]), ...rows],
			{ title, layout: "header" },
		);
		expect([large.titleFirst, large.orderViolations, large.findings]).toEqual([true, 0, []]);
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

describe("the tree a screen reader walks is the only tree the checks read", () => {
	const covered = [button("Push", [0, 0, 100, 100]), button("Other", [0, 200, 100, 300])];
	const sheet = [button("Close", [0, 1500, 100, 1600])];
	// The full dump of a sheet over a screen: the screen under it (no-hide-descendants for a service) and the sheet's scrim, a
	// clickable, focusable view with no label that is not important for accessibility; the compressed dump has neither.
	const scrim: N = { cls: "android.view.View", clickable: true, focusable: true, bounds: [0, 0, 1080, 2400] };
	const base = {
		direction: "ltr" as const,
		display,
		title: null,
		controls: [],
		scrolled: [],
		hidden: ["Push", "Other"],
		layout: "sheet" as const,
	};

	test("the compressed dump has no leak where the full dump, read as the tree, has two", () => {
		const walked = analyzeScreen({ ...base, tree: tree(...sheet) });
		expect([walked.focusLeaks, walked.findings]).toEqual([0, []]);
		const full = analyzeScreen({ ...base, tree: tree(scrim, ...covered, ...sheet) });
		expect(full.focusLeaks).toBe(2);
	});

	test("the scrim and the covered screen's controls are findings only in the tree a service does not walk", () => {
		const titled = { text: "Sheet", bounds: [42, 1400, 600, 1460] as N["bounds"] };
		const fields = { ...base, title: "Sheet", hidden: [] };
		const walked = analyzeScreen({ ...fields, tree: tree(titled, ...sheet) });
		expect([walked.unlabeled, walked.titleFirst, walked.orderViolations]).toEqual([0, true, 0]);
		const full = analyzeScreen({
			...fields,
			tree: tree(scrim, button("Push", [42, 1766, 1038, 1902]), titled, ...sheet),
		});
		expect(full.findings.map((f) => f.kind)).toEqual(["unlabeled", "title", "order"]);
		expect(full.findings[0]?.element).toBe("View [0,0 1080x2400]");
	});

	test("a label the walked tree still lists is a leak", () => {
		const r = analyzeScreen({ ...base, tree: tree(covered[0] as N, ...sheet) });
		expect(r.focusLeaks).toBe(1);
		expect(r.findings[0]?.element).toContain("Push");
	});

	test("a sheet titled like the button that opened it does not leak its own title, but a button with that label does", () => {
		const titled = { cls: "android.view.View", desc: "Form sheet", bounds: [147, 255, 1038, 402] as N["bounds"] };
		const named = { ...base, title: "Form sheet", hidden: ["Form sheet"] };
		expect(analyzeScreen({ ...named, tree: tree(titled, ...sheet) }).focusLeaks).toBe(0);
		expect(
			analyzeScreen({ ...named, tree: tree(titled, button("Form sheet", [42, 1430, 1038, 1566]), ...sheet) }).focusLeaks,
		).toBe(1);
	});
});

describe("frozen dumps of the QA app (the checklist's findings in them, not the engine's state today)", () => {
	// The lab's cases, and two fixtures (`fixture-cases.ts`): the sign-in and startup screens of the product the dumps were taken in.
	function screen(file: string, id: string, direction: "ltr" | "rtl" = "ltr") {
		const c = [...cases, login, startupLoading].find((entry) => entry.id === id);
		if (!c) throw new Error(`no case ${id}`);
		return analyzeScreen({
			tree: parseHierarchy(sample(file)),
			direction,
			display,
			title: c.title === null ? null : localize(c.title, direction),
			controls: c.controls.map((label) => localize(label, direction)),
			scrolled: c.scrolled.map((label) => localize(label, direction)),
			hidden: c.hidden.map((label) => localize(label, direction)),
			layout: c.layout,
		});
	}

	test("the draft input on the bottom edge of the rows page has no visible height: clipped when the screen declares it below the fold, unreachable when it does not", () => {
		const rows = cases.find((entry) => entry.id === "dev-rows");
		if (!rows) throw new Error("no case dev-rows");
		expect(rows.scrolled).toContain("Row A");
		const r = screen("uia-dev-rows.xml", "dev-rows");
		expect([r.interactive, r.reachable, r.clipped, r.unreachable, r.findings]).toEqual([12, 11, 1, 0, []]);
		const undeclared = analyzeScreen({
			tree: parseHierarchy(sample("uia-dev-rows.xml")),
			direction: "ltr",
			display,
			title: null,
			controls: [],
			scrolled: [],
			hidden: [],
			layout: "header",
		});
		expect([undeclared.clipped, undeclared.unreachable]).toEqual([0, 1]);
		expect(undeclared.findings[0]?.detail).toBe("zero-size bounds");
	});

	test("sheet and modal over the menu (a TalkBack session on the emulator, 27 Oct): the full dump reads as findings no service meets, the compressed dump as none", () => {
		const expectedOnFull: Record<string, string[]> = {
			"screens-sheet": [
				'unlabeled: View [0,0 1080x2400] | no text, content description or hint, and no labeled descendant',
				'title: TextView "Two detents" [42,1564 996x71] | content comes before the title in the tree: Button "Bottom tabs, a stack in each" [42,1766 996x136]',
				'order: TextView "Row 3" [76,2275 928x54] then Button "Notifications" [954,138 126x126] | left to right, top to bottom expected',
			],
			"screens-modal": [
				'order: TextView "Screen 1 · row 14" [76,2281 928x54] then TextView "Each page below is a real screen: the engine draws its header, sheet and tab bar." [42,464 996x94] | left to right, top to bottom expected',
				'order: TextView "Row 3" [76,2275 928x54] then Button "Notifications" [954,138 126x126] | left to right, top to bottom expected',
			],
		};
		for (const id of ["screens-sheet", "screens-modal"]) {
			const c = cases.find((entry) => entry.id === id);
			if (!c) throw new Error(`no case ${id}`);
			const input = {
				direction: "ltr" as const,
				display,
				title: c.title === null ? null : localize(c.title, "ltr"),
				controls: c.controls.map((label) => localize(label, "ltr")),
				scrolled: c.scrolled.map((label) => localize(label, "ltr")),
				hidden: c.hidden.map((label) => localize(label, "ltr")),
				layout: c.layout,
			};
			const full = analyzeScreen({ ...input, tree: parseHierarchy(sample(`uia-${id}-full.xml`)) });
			const walked = analyzeScreen({ ...input, tree: parseHierarchy(sample(`uia-${id}-important.xml`)) });
			const detail = (f: { kind: string; element: string; detail: string }) => `${f.kind}: ${f.element} | ${f.detail}`;
			expect(full.findings.filter((f) => f.kind !== "leak").map(detail)).toEqual(expectedOnFull[id] as string[]);
			expect(full.focusLeaks).toBe(c.hidden.length);
			expect(walked.findings).toEqual([]);
			expect([walked.unlabeled, walked.orderViolations, walked.focusLeaks]).toEqual([0, 0, 0]);
			expect(walked.titleFirst).toBe(true);
		}
	});

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

	test("inline header in the order before back-first: the title leads, and the back button after it is the one order violation", () => {
		const r = screen("uia-screens-header.xml", "screens-header");
		expect(r.titleFirst).toBe(true);
		expect(r.orderViolations).toBe(1);
		expect(r.findings.find((f) => f.kind === "order")?.element).toBe(
			'View "Screen 1, Native header" [147,128 786x147] then Button "Navigate up" [0,128 126x147]',
		);
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
		expect(r.stops).toEqual(["Example", "Loading…"]);
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

describe("the toolbar band", () => {
	const row = (label: string, y: number): N => ({ text: label, bounds: [76, y, 1004, y + 54] });
	const item = (label: string, bounds: [number, number, number, number], extra: Partial<N> = {}): N => ({
		cls: "android.widget.Button",
		desc: label,
		bounds,
		clickable: true,
		focusable: true,
		...extra,
	});
	/** `node` has no resource id; the engine's toolbar puts `svelte-toolbar:<key>` on its controls. */
	const marked = (xml: string, labels: string[]) =>
		labels.reduce((out, label) => out.replace(new RegExp(`resource-id="" (class="[^"]*" package="p" content-desc="${label}")`), `resource-id="svelte-toolbar:${label.toLowerCase()}" $1`), xml);
	const analyzeMarked = (nodes: N[], labels: string[], fields: Partial<A11yInput> = {}) => {
		const xml = marked(
			`<?xml version='1.0' ?><hierarchy rotation="0">${node({ cls: "android.widget.FrameLayout", bounds: [0, 0, 1080, 2400], children: nodes })}</hierarchy>`,
			labels,
		);
		return analyzeScreen({ tree: parseHierarchy(xml), direction: "ltr", display, title: null, controls: [], scrolled: [], hidden: [], layout: "page", ...fields });
	};

	test("the band is the nodes with the toolbar's resource id, or inside one", () => {
		const t = parseHierarchy(
			marked(
				`<hierarchy rotation="0">${node({ bounds: [0, 0, 1080, 2400], children: [item("Reply", [10, 2195, 136, 2321]), item("Plain", [146, 2195, 272, 2321])] })}</hierarchy>`,
				["Reply"],
			),
		);
		expect(t.nodes.filter(isToolbarNode).map((n) => n.contentDesc)).toEqual(["Reply"]);
		const slot = parseHierarchy(
			`<hierarchy rotation="0"><node index="0" text="" resource-id="svelte-toolbar" class="android.view.ViewGroup" package="p" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][10,10]"><node index="0" text="List" resource-id="" class="android.widget.TextView" package="p" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][10,10]"/></node></hierarchy>`,
		);
		expect(slot.nodes.every(isToolbarNode)).toBe(true);
		for (const id of ["svelte-toolbarX", "my-svelte-toolbar", ""]) expect(isToolbarNode({ ...t.nodes[1]!, resourceId: id, parent: null })).toBe(false);
	});

	test("the last row under the translucent toolbar is content: no order finding when the band comes after it", () => {
		const nodes = [row("Row 6", 1900), row("Row 7", 2200), item("Reply", [10, 2195, 136, 2321]), item("Delete", [944, 2195, 1070, 2321])];
		const banded = analyzeMarked(nodes, ["Reply", "Delete"]);
		expect(banded.orderViolations).toBe(0);
		// Without the marker the frames overlap and the row's x decides: the finding the band rule removes.
		expect(analyze(nodes).orderViolations).toBe(1);
	});

	test("a toolbar control read before a content row is an order violation", () => {
		const result = analyzeMarked([item("Reply", [10, 2195, 136, 2321]), row("Row 6", 1900)], ["Reply"]);
		expect(result.findings.filter((f) => f.kind === "order").map((f) => f.element)).toEqual([
			'Button "Reply" [10,2195 126x126] then TextView "Row 6" [76,1900 928x54]',
		]);
	});

	test("inside the band the controls run from the start edge to the end, mirrored in right-to-left", () => {
		const ltr = [row("Row 7", 2200), item("Reply", [10, 2195, 136, 2321]), item("Delete", [944, 2195, 1070, 2321])];
		expect(analyzeMarked(ltr, ["Reply", "Delete"]).orderViolations).toBe(0);
		expect(analyzeMarked([row("Row 7", 2200), item("Delete", [944, 2195, 1070, 2321]), item("Reply", [10, 2195, 136, 2321])], ["Reply", "Delete"]).orderViolations).toBe(1);
		const rtl = [row("Row 7", 2200), item("Reply", [944, 2195, 1070, 2321]), item("Delete", [10, 2195, 136, 2321])];
		expect(analyzeMarked(rtl, ["Reply", "Delete"], { direction: "rtl" }).orderViolations).toBe(0);
	});

	test("the engine's toolbar screen (a compressed dump, written by hand): the band is read last and the screen has no order finding", () => {
		const c = cases.find((entry) => entry.id === "screens-toolbar");
		if (!c) throw new Error("no case screens-toolbar");
		const input = {
			tree: parseHierarchy(sample("uia-screens-toolbar.xml")),
			direction: "ltr" as const,
			display,
			title: c.title === null ? null : localize(c.title, "ltr"),
			controls: c.controls.map((label) => localize(label, "ltr")),
			scrolled: [],
			hidden: [],
			layout: c.layout,
		};
		const r = analyzeScreen(input);
		expect(r.stops.slice(-5)).toEqual(["Row 7", "Reply", "Archive", "Flag", "Delete"]);
		expect([r.orderViolations, r.titleFirst, r.unreachable]).toEqual([0, true, 0]);
		const plain = analyzeScreen({ ...input, tree: parseHierarchy(sample("uia-screens-toolbar.xml").replace(/svelte-toolbar:\w+/g, "")) });
		expect(plain.findings.filter((f) => f.kind === "order").map((f) => f.element)).toEqual([
			'TextView "Row 7" [76,2200 928x54] then Button "Reply" [10,2195 126x126]',
		]);
	});
});

describe("touch targets", () => {
	// 420 dpi: 2.625 px per dp, so 48 dp is 126 px.
	const dense = { ...display, densityDpi: 420 };

	test("an enabled control under 48 dp in either direction is counted, with its size in dp", () => {
		const r = analyze(
			[
				button("Big", [100, 400, 700, 540]),
				button("Short", [100, 600, 700, 700]),
				button("Narrow", [100, 800, 200, 940]),
				button("Off", [100, 1000, 700, 1100], { enabled: false }),
				button("Edge", [100, 0, 700, 60]),
			],
			{ display: dense },
		);
		expect(r.smallTargets).toBe(2);
		expect(r.findings.filter((finding) => finding.kind === "target").map((finding) => finding.element)).toEqual([
			'Button "Short" [100,600 600x100]',
			'Button "Narrow" [100,800 100x140]',
		]);
		expect(r.findings.find((finding) => finding.kind === "target")?.detail).toBe("229 x 38 dp, under the 48 dp touch target");
	});

	test("without a density nothing is measured, and a result from before the measurement has no count", () => {
		expect(analyze([button("Short", [100, 600, 700, 700])]).smallTargets).toBeUndefined();
	});
});

describe("a control below the fold of a scroll view", () => {
	const dense = { ...display, densityDpi: 420 };
	// The button's visible slice ends where the scroll view does, under the bottom of the display.
	const page = (label: string, bounds: N["bounds"]): N[] => [
		{ cls: "android.widget.ScrollView", scrollable: true, bounds: [0, 300, 1080, 2400], children: [button(label, bounds)] },
	];

	test("a button that names its row is the control the screen declares below the fold", () => {
		const r = analyze(page("Delete workspace, Acme", [105, 2383, 975, 2337]), { display: dense, scrolled: ["Delete workspace"] });
		expect([r.clipped, r.unreachable]).toEqual([1, 0]);
		const undeclared = analyze(page("Delete workspace, Acme", [105, 2383, 975, 2337]), { display: dense });
		expect([undeclared.clipped, undeclared.unreachable]).toEqual([0, 1]);
	});

	test("the slice of a control a scroll view cuts is not a small touch target, the same control whole is", () => {
		expect(analyze(page("Sign out", [63, 2360, 1017, 2400]), { display: dense, scrolled: ["Sign out"] }).smallTargets).toBe(0);
		const whole: N = { cls: "android.widget.ScrollView", scrollable: true, bounds: [0, 300, 1080, 2400], children: [button("Sign out", [63, 1000, 1017, 1040])] };
		expect(analyze([whole], { display: dense }).smallTargets).toBe(1);
	});
});
