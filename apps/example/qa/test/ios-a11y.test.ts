import { describe, expect, test } from "bun:test";
import { judgeReadingOrder } from "../lib/a11y.ts";
import { cases } from "../lib/screens.ts";
import { iosControl, iosTitle } from "../lib/iphone/screens.ts";
import { sample } from "./sample.ts";
import { analyzeIosScreen, chromeElements, isActionable, spoken, voiceOverOrder, type IosDump, type IosElement, type IosA11yInput, type UiKitState } from "../lib/iphone/a11y.ts";

const screen = { width: 375, height: 667, scale: 2 };

function element(fields: Partial<IosElement> & { frame: [number, number, number, number] }): IosElement {
	return { class: "RCTParagraphComponentView", traits: ["staticText"], explicit: false, group: 0, ...fields };
}
const button = (label: string, frame: [number, number, number, number], fields: Partial<IosElement> = {}) =>
	element({ class: "RCTViewComponentView", label, traits: ["button"], frame, ...fields });
const text = (label: string, frame: [number, number, number, number], fields: Partial<IosElement> = {}) =>
	element({ label, frame, ...fields });

function dump(elements: IosElement[], rtl = false): IosDump {
	return { screen, rtl, elements, modalViews: [], movingViews: [] };
}

function analyze(elements: IosElement[], fields: Partial<IosA11yInput> = {}) {
	return analyzeIosScreen({ dump: dump(elements, fields.direction === "rtl"), direction: "ltr", title: null, controls: [], scrolled: [], hidden: [], layout: "page", ...fields });
}

describe("iOS accessibility checks", () => {
	test("a button with a label and the trait passes every check", () => {
		const result = analyze([button("Run all checks", [16, 100, 343, 48])], { controls: ["Run all checks"] });
		expect(result.interactive).toBe(1);
		expect([result.reachable, result.labeled, result.actionable]).toEqual([1, 1, 1]);
		expect([result.unreachable, result.unlabeled, result.notActionable, result.orderViolations]).toEqual([0, 0, 0, 0]);
	});

	test("a declared control that VoiceOver reads as plain text is not actionable; one that is missing is unreachable", () => {
		const result = analyze([text("Save", [16, 100, 100, 44])], { controls: ["Save", "Cancel"] });
		expect(result.notActionable).toBe(1);
		expect(result.unreachable).toBe(1);
		expect(result.findings.map((finding) => finding.kind).sort()).toEqual(["notActionable", "unreachable"]);
	});

	test("an element with no label, value or hint is unlabeled and unreachable", () => {
		const result = analyze([button("", [16, 100, 44, 44], { label: undefined })]);
		expect(result.unlabeled).toBe(1);
		expect(result.unreachable).toBe(1);
	});

	test("a disabled control is counted but not checked; one outside the screen that nothing scrolls is unreachable", () => {
		const result = analyze([button("Save", [16, 100, 100, 44], { traits: ["button", "notEnabled"] }), button("Below", [16, 900, 100, 44])]);
		expect(result.disabled).toBe(1);
		expect(result.clipped).toBe(0);
		expect(result.unreachable).toBe(1);
		expect(result.findings).toEqual([expect.objectContaining({ kind: "unreachable", detail: "outside the screen" })]);
	});

	describe("a control outside the screen", () => {
		const inScrollView = ["RCTViewComponentView", "RCTEnhancedScrollView", "RCTScrollViewComponentView", "RCTRootComponentView"];
		const below = (label = "Push screen 2", fields: Partial<IosElement> = {}) => button(label, [24, 900, 327, 52], { parents: inScrollView, ...fields });

		test("is clipped, and not checked, when it sits in a scroll view and the screen declares it below the fold", () => {
			const result = analyze([below()], { scrolled: ["Push screen 2"] });
			expect([result.interactive, result.clipped, result.unreachable, result.reachable]).toEqual([1, 1, 0, 0]);
			expect(result.findings).toEqual([]);
		});

		test("is unreachable when the screen does not declare it, though a scroll view holds it", () => {
			const result = analyze([below("Push screen 3")], { scrolled: ["Push screen 2"] });
			expect([result.clipped, result.unreachable]).toEqual([0, 1]);
			expect(result.findings[0]?.detail).toBe("outside the screen");
		});

		test("is unreachable when it is declared but no scroll view holds it: a footer the layout pushed off the display", () => {
			const footer = button("Push screen 2", [24, 900, 327, 52], { parents: ["RCTViewComponentView", "RCTRootComponentView"] });
			const result = analyze([footer], { scrolled: ["Push screen 2"] });
			expect([result.clipped, result.unreachable]).toEqual([0, 1]);
			expect(result.findings[0]?.detail).toBe("outside the screen");
		});

		test("a text field is in a scroll view by its ancestors, like any element (the dump lists them for UIKit's fields too), and out of reach without them", () => {
			const field = (fields: Partial<IosElement> = {}) => element({ class: "RCTUITextField", label: "Draft a", traits: [], frame: [38, 874, 299, 50], ...fields });
			const rows = [below("Reverse rows", { frame: [24, 700, 327, 52] }), below("Tap a", { frame: [24, 1100, 327, 52] })];
			const within = analyze([...rows, field({ parents: inScrollView })], { scrolled: ["Draft a", "Reverse rows", "Tap a"] });
			expect([within.clipped, within.unreachable]).toEqual([3, 0]);
			const beyond = analyze([...rows, field()], { scrolled: ["Draft a", "Reverse rows", "Tap a"] });
			expect([beyond.clipped, beyond.unreachable]).toEqual([2, 1]);
		});
	});

	test("a text field is actionable by its class", () => {
		const field = element({ class: "RCTUITextField", label: "Name", traits: [], frame: [16, 100, 343, 52] });
		expect(isActionable(field)).toBe(true);
		expect(analyze([field]).actionable).toBe(1);
	});

	test("label and value are spoken together", () => {
		expect(spoken(element({ label: "Volume", value: "50 %", frame: [0, 0, 1, 1] }))).toBe("Volume, 50 %");
	});
});

describe("VoiceOver order", () => {
	test("positions decide: rows from the top, the start edge first (the right edge in right-to-left)", () => {
		const a = text("a", [200, 100, 50, 20]);
		const b = text("b", [16, 100, 50, 20]);
		const c = text("c", [16, 300, 50, 20]);
		const d = text("d", [16, 200, 50, 20]);
		expect(voiceOverOrder([c, a, d, b], "ltr").map((entry) => entry.label)).toEqual(["b", "a", "d", "c"]);
		expect(voiceOverOrder([c, a, d, b], "rtl").map((entry) => entry.label)).toEqual(["a", "b", "d", "c"]);
	});

	test("what a container orders itself keeps its order, as a group at the position of its first element", () => {
		const first = text("first", [16, 500, 50, 20], { explicit: true, group: 1 });
		const second = text("second", [16, 100, 50, 20], { explicit: true, group: 1 });
		const loose = text("loose", [16, 300, 50, 20]);
		expect(voiceOverOrder([second, first, loose], "ltr").map((entry) => entry.label)).toEqual(["second", "first", "loose"]);
	});

	test("an explicit order that runs against the layout is an order violation", () => {
		const lower = text("lower", [16, 400, 100, 20], { explicit: true, group: 1 });
		const upper = text("upper", [16, 100, 100, 20], { explicit: true, group: 1 });
		const result = analyze([lower, upper]);
		expect(result.orderViolations).toBe(1);
	});
});

describe("title and focus trap", () => {
	const header = [
		button("Back", [8, 20, 60, 44]),
		text("Screen 1", [130, 20, 115, 44], { traits: ["header"] }),
		button("Notifications", [300, 20, 60, 44]),
		text("Row", [16, 120, 343, 44]),
	];

	test("the title is first when it is a heading and nothing below the header comes before it", () => {
		const result = analyze(header, { title: "Screen 1", layout: "header" });
		expect(result.titleFirst).toBe(true);
		expect(result.orderViolations).toBe(0);
	});

	test("a title that is not exposed as a heading is not first, whatever its position", () => {
		const plain = header.map((entry) => (entry.label === "Screen 1" ? { ...entry, traits: ["staticText"] } : entry));
		const result = analyze(plain, { title: "Screen 1", layout: "header" });
		expect(result.titleFirst).toBe(false);
		expect(result.findings.some((finding) => finding.kind === "title" && finding.detail.includes("heading"))).toBe(true);
	});

	test("content a container lists before the title puts the title second", () => {
		const content = text("Row", [16, 300, 343, 44], { explicit: true, group: 1 });
		const title = text("Screen 1", [130, 20, 115, 44], { traits: ["header"], explicit: true, group: 1 });
		const result = analyze([content, title], { title: "Screen 1", layout: "header" });
		expect(result.titleFirst).toBe(false);
		expect(result.findings.some((finding) => finding.kind === "title" && finding.detail.includes("comes before"))).toBe(true);
	});

	test("a missing title is a finding", () => {
		const result = analyze([text("Something else", [16, 100, 100, 20])], { title: "Screen 1" });
		expect(result.titleFirst).toBe(false);
	});

	test("labels of the covered screen still in the dump are focus leaks", () => {
		const result = analyze([text("Two detents", [16, 300, 343, 30], { traits: ["header"] }), button("Header slots and search", [16, 100, 343, 48])], { hidden: ["Header slots and search", "Modal"], layout: "sheet", title: "Two detents" });
		expect(result.focusLeaks).toBe(1);
		const clean = analyze([text("Two detents", [16, 300, 343, 30], { traits: ["header"] })], { hidden: ["Header slots and search"], layout: "sheet", title: "Two detents" });
		expect(clean.focusLeaks).toBe(0);
	});

	test("a heading of the sheet that reads like a control under it is not a leak", () => {
		const result = analyze([text("Form sheet", [16, 100, 343, 30], { traits: ["header"] }), text("Name", [16, 140, 343, 30])], { hidden: ["Form sheet"], layout: "sheet", title: "Form sheet" });
		expect(result.focusLeaks).toBe(0);
	});

	test("a title the center slot replaces is one of the slot's controls and needs no heading trait", () => {
		const result = analyze([button("Segment A", [130, 20, 60, 44]), text("Row", [16, 120, 343, 44])], { title: "Segment A", layout: "header", controls: ["Segment A"] });
		expect(result.titleFirst).toBe(true);
	});

	test("a header reads the back button, then the title, then the end controls: start to end, mirrored in right-to-left (the Android suite's rule)", () => {
		const bar = [
			button("Back", [0, 20, 80, 44]),
			text("Screen 1", [130, 20, 115, 44], { traits: ["header"] }),
			button("Notifications", [295, 20, 80, 44]),
			text("Row", [16, 120, 343, 44]),
		];
		for (const layout of ["header", "page"] as const) {
			const result = analyze(bar, { title: "Screen 1", layout });
			expect([result.titleFirst, result.orderViolations, result.findings]).toEqual([true, 0, []]);
		}
		const mirrored = analyze(
			[button("Back", [295, 20, 80, 44]), text("Screen 1", [130, 20, 115, 44], { traits: ["header"] }), button("Notifications", [0, 20, 80, 44]), text("Row", [16, 120, 343, 44])],
			{ title: "Screen 1", layout: "header", direction: "rtl" },
		);
		expect([mirrored.titleFirst, mirrored.orderViolations]).toEqual([true, 0]);
	});

	test("an end control before the title fails title first; the title before the back button is an order violation", () => {
		// A container orders these (`explicit`), so the walk keeps the order given here.
		const container = { explicit: true, group: 1 };
		const heading = (frame: [number, number, number, number]) => text("Screen 1", frame, { traits: ["header"], ...container });
		const end = analyze(
			[button("Back", [0, 20, 80, 44], container), button("Notifications", [295, 20, 80, 44], container), heading([130, 20, 115, 44])],
			{ title: "Screen 1", layout: "header" },
		);
		expect(end.titleFirst).toBe(false);
		expect(end.findings.find((finding) => finding.kind === "title")?.detail).toContain("end side");
		const old = analyze([heading([130, 20, 115, 44]), button("Back", [0, 20, 80, 44], container)], { title: "Screen 1", layout: "header" });
		expect([old.titleFirst, old.orderViolations]).toEqual([true, 1]);
	});

	test("a large title is the bar's second row: after the back button, before the end controls, and that step up is no violation in a header", () => {
		const container = { explicit: true, group: 1 };
		const large = [
			button("Back", [0, 20, 80, 44], container),
			text("Native screens", [16, 64, 343, 52], { traits: ["header"], ...container }),
			button("Notifications", [295, 20, 80, 44], container),
			text("Row", [16, 130, 343, 44], container),
		];
		const header = analyze(large, { title: "Native screens", layout: "header" });
		expect([header.titleFirst, header.orderViolations, header.findings]).toEqual([true, 0, []]);
		expect(analyze(large, { title: "Native screens", layout: "page" }).orderViolations).toBe(1);
	});

	test("a center slot after the left slot: its first control is the title and the next one follows it", () => {
		const result = analyze(
			[button("Close", [8, 20, 60, 44]), button("Segment A", [130, 20, 60, 44]), button("Segment B", [200, 20, 60, 44])],
			{ title: "Segment A", layout: "header", controls: ["Close", "Segment A", "Segment B"] },
		);
		expect([result.titleFirst, result.orderViolations]).toEqual([true, 0]);
	});
});

describe("UIKit's own chrome", () => {
	const state = (root: UiKitState["root"], rtl = false): UiKitState => ({ screen, safeArea: [20, 0, 0, 0], rtl, root });
	const stack = (items: object[], extra: object = {}) => ({
		class: "SvelteNavigationController",
		shown: true,
		navigation: { barHidden: false, barFrame: [0, 0, 375, 108], topIndex: items.length - 1, items },
		...extra,
	});

	test("the bar contributes a heading for the title and a back button when there is a screen to go back to", () => {
		const elements = chromeElements(state({ class: "Root", children: [stack([{ title: "Root" }, { title: "Screen 1", hidesBackButton: false }])] }));
		expect(elements.map((entry) => [entry.label, entry.traits.join("+")])).toEqual([["Screen 1", "staticText+header"], ["Back", "button"]]);
		const first = chromeElements(state({ class: "Root", children: [stack([{ title: "Root" }])] }));
		expect(first.map((entry) => entry.label)).toEqual(["Root"]);
		const hidden = chromeElements(state({ class: "Root", children: [stack([{ title: "A" }, { title: "B", hidesBackButton: true }])] }));
		expect(hidden.map((entry) => entry.label)).toEqual(["B"]);
	});

	test("a hidden bar and a hidden tab pane contribute nothing", () => {
		expect(chromeElements(state({ class: "Root", children: [{ ...stack([{ title: "A" }]), navigation: { barHidden: true, barFrame: [0, 0, 375, 0], topIndex: 0, items: [{ title: "A" }] } }] }))).toEqual([]);
		expect(chromeElements(state({ class: "Root", children: [stack([{ title: "Pane" }], { shown: false })] }))).toEqual([]);
	});

	test("every stack on screen is walked, and the ones under a presented screen are marked covered", () => {
		const under = chromeElements(state({ class: "Root", children: [stack([{ title: "Under" }])], presented: { class: "Sheet", shown: true, children: [stack([{ title: "Over" }])] } }));
		expect(under.map((entry) => [entry.label, entry.covered, entry.synthesized])).toEqual([["Under", true, true], ["Over", false, true]]);
	});

	test("tab items carry their own label or the title and badge, the selected one is selected, and the order mirrors in right-to-left", () => {
		const tabs = { class: "Tabs", shown: true, tabs: { selectedIndex: 1, barFrame: [0, 600, 375, 67], items: [{ title: "Home", badge: "" }, { title: "Inbox", badge: "99+", accessibilityLabel: "Inbox, 99+" }, { title: "Me" }] } };
		const ltr = chromeElements(state({ class: "Root", children: [tabs] }));
		expect(ltr.map((entry) => entry.label)).toEqual(["Home, new items", "Inbox, 99+", "Me"]);
		expect(ltr[1]?.traits).toEqual(["button", "selected"]);
		expect(ltr.map((entry) => Math.round(entry.frame[0]))).toEqual([0, 125, 250]);
		const rtl = chromeElements(state({ class: "Root", children: [tabs] }, true));
		expect(rtl.map((entry) => Math.round(entry.frame[0]))).toEqual([250, 125, 0]);
	});

	test("a screen's title and its tab bar are found through the chrome, not the dump", () => {
		const dumpOnly = analyze([text("Row", [16, 120, 343, 44])], { title: "Screen 1", layout: "header" });
		expect(dumpOnly.titleFirst).toBe(false);
		const merged = analyzeIosScreen({
			dump: dump([text("Row", [16, 120, 343, 44])]),
			state: state({ class: "Root", children: [stack([{ title: "Root" }, { title: "Screen 1" }])] }),
			direction: "ltr",
			title: "Screen 1",
			controls: ["Back"],
			scrolled: [],
			hidden: [],
			layout: "header",
		});
		expect(merged.titleFirst).toBe(true);
		expect(merged.unreachable).toBe(0);
	});

	test("modelled chrome is in the order model but not in the counts: a label the harness wrote proves nothing", () => {
		const input = {
			dump: dump([text("Row", [16, 120, 343, 44])]),
			state: state({ class: "Root", children: [stack([{ title: "Root" }, { title: "Screen 1" }])] }),
			direction: "ltr" as const,
			title: "Screen 1",
			controls: ["Back"],
			scrolled: [],
			hidden: [],
			layout: "header" as const,
		};
		const merged = analyzeIosScreen(input);
		// the title and the back button are modelled; neither is an interactive, labeled or actionable element of the screen
		expect([merged.interactive, merged.reachable, merged.labeled, merged.actionable, merged.chromeModelled]).toEqual([0, 0, 0, 0, 2]);
		expect(merged.stops.slice(0, 2).sort()).toEqual(["Back", "Screen 1"]);
		expect(merged.titleFirst).toBe(true);
	});

	test("a declared control the model does not have is still unreachable, and counts", () => {
		const merged = analyzeIosScreen({
			dump: dump([text("Row", [16, 120, 343, 44])]),
			state: state({ class: "Root", children: [stack([{ title: "Screen 1", hidesBackButton: true }, { title: "Screen 2", hidesBackButton: true }])] }),
			direction: "ltr",
			title: "Screen 2",
			controls: ["Back"],
			scrolled: [],
			hidden: [],
			layout: "header",
		});
		expect([merged.interactive, merged.unreachable, merged.chromeModelled]).toEqual([1, 1, 1]);
	});

	test("the bars under a sheet are a focus leak when the dump shows no modal view hiding them, and not when it does", () => {
		const tabs = { class: "Tabs", shown: true, tabs: { selectedIndex: 0, barFrame: [0, 600, 375, 67], items: [{ title: "Home" }, { title: "Me" }] } };
		const covered = state({ class: "Root", children: [tabs], presented: { class: "Sheet", shown: true } });
		const input = { dump: dump([text("Two detents", [16, 300, 343, 30], { traits: ["header"] })]), state: covered, direction: "ltr" as const, title: "Two detents", controls: [], scrolled: [], hidden: ["Home"], layout: "sheet" as const };
		expect(analyzeIosScreen(input).focusLeaks).toBe(1);
		const hiding = { ...input, dump: { ...input.dump, modalViews: [{ class: "UITransitionView", ignoredSiblings: 2 }] } };
		expect(analyzeIosScreen(hiding).focusLeaks).toBe(0);
	});
});

describe("the toolbar band", () => {
	const toolbarParents = ["_UIFloatingBarContainerView", "UILayoutContainerView", "SvelteStackView"];
	const toolbarButton = (label: string, frame: [number, number, number, number]) =>
		element({ class: "SvelteToolbarButton", label, traits: ["button"], frame, parents: toolbarParents });
	// The last row of a list under a translucent toolbar: its frame overlaps the items' by 11 of the row's 18 points.
	const row = text("Row 9", [29, 589, 317, 18]);

	test("a content row that overlaps the toolbar's frame is read before the band, in no row with it", () => {
		const items = [toolbarButton("Reply", [33, 596, 44, 38]), toolbarButton("Archive", [91, 596, 44, 38])];
		const result = analyze([...items, row], { direction: "ltr" });
		expect(result.stops.map((stop) => stop.split(" ")[0])).toEqual(["Row", "Reply", "Archive"]);
		expect(result.orderViolations).toBe(0);
	});

	test("the band reads from the start edge to the end, mirrored in right-to-left, and content stays first", () => {
		const items = [toolbarButton("Reply", [33, 596, 44, 38]), toolbarButton("Delete", [298, 596, 44, 38])];
		expect(voiceOverOrder([...items, row], "ltr").map((entry) => entry.label)).toEqual(["Row 9", "Reply", "Delete"]);
		expect(voiceOverOrder([...items, row], "rtl").map((entry) => entry.label)).toEqual(["Row 9", "Delete", "Reply"]);
		expect(analyze([...items, row], { direction: "rtl" }).orderViolations).toBe(0);
	});

	test("the toolbar's center slot is the band too: anything under a SvelteToolbarCenterView", () => {
		const center = button("List", [140, 597, 46, 36], { parents: ["RCTViewComponentView", "SvelteToolbarCenterView", "SvelteBarContainer"] });
		expect(voiceOverOrder([center, row], "ltr").map((entry) => entry.label)).toEqual(["Row 9", "List"]);
	});

	test("the check and the sort agree: a toolbar stop read before a content stop is an order violation, content before the toolbar never is", () => {
		const content = { x: 29, y: 589, width: 317, height: 18 };
		const item = { x: 33, y: 596, width: 44, height: 38 };
		expect(judgeReadingOrder([content, item], null, "ltr", "header", [false, true]).violations).toEqual([]);
		expect(judgeReadingOrder([item, content], null, "ltr", "header", [true, false]).violations).toEqual([0]);
		// Without the band, the two frames form one row and the content stop (to the right of the item's center) is read after it.
		expect(judgeReadingOrder([content, item], null, "ltr", "header").violations).toEqual([0]);
	});

	describe("the lab's toolbar screens, frozen from the iPhone run of 27 October (the run reported 4 order findings)", () => {
		for (const id of ["screens-toolbar", "screens-toolbar-center"]) {
			for (const direction of ["ltr", "rtl"] as const) {
				const run = (identified: boolean) => {
					const c = cases.find((entry) => entry.id === id);
					if (!c) throw new Error(`no case ${id}`);
					const dumped = JSON.parse(sample(`ios-${id}-${direction}.a11y.json`)) as IosDump;
					// Unidentified: the toolbar's own views stripped of their names, as an app that did not say so.
					const elements = identified
						? dumped.elements
						: dumped.elements.map((entry) => (entry.class.includes("Toolbar") || entry.parents?.some((name) => name.includes("SvelteToolbar")) ? { ...entry, class: "RCTViewComponentView", parents: ["RCTView"] } : entry));
					return analyzeIosScreen({
						dump: { ...dumped, elements },
						state: JSON.parse(sample(`ios-${id}-${direction}.uikit.json`)) as UiKitState,
						direction,
						title: iosTitle(c, direction),
						controls: c.controls.map((label) => iosControl(label, direction)),
						scrolled: [],
						hidden: [],
						layout: c.layout,
					});
				};

				test(`${id} ${direction}: one order finding without the band, none with it, and the toolbar is read last`, () => {
					const before = run(false);
					expect(before.findings.filter((finding) => finding.kind === "order")).toHaveLength(1);
					expect(before.findings.find((finding) => finding.kind === "order")?.element).toContain('"Row 9"');
					const after = run(true);
					expect(after.findings.filter((finding) => finding.kind === "order")).toEqual([]);
					expect(after.orderViolations).toBe(0);
					expect(after.titleFirst).toBe(true);
					const labels = after.stops;
					const items = id === "screens-toolbar" ? ["Reply", "Archive", "Flag", "Delete"] : ["Attach", "List", "Grid", "Send"];
					// The same logical order in both directions: the dump mirrors the frames, so right-to-left runs from the right edge.
					expect(labels.slice(-4).map((label) => label.split(" ")[0])).toEqual(items);
				});
			}
		}
	});
});
