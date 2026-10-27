import { followsInOrderRect, type A11yFinding, type A11yScreen } from "../a11y.ts";
import type { Direction } from "../device.ts";
import type { Rect } from "../png.ts";
import type { Layout } from "../screens.ts";

/**
 * The accessibility checklist on iOS, run on the elements the app itself reports for its window
 * (`SvelteQAAccessibility.swift`, `lib/native/dev/capture.ts`): the leaves VoiceOver would focus, found by the same rules the system
 * uses (hidden views, `accessibilityElementsHidden`, explicit `accessibilityElements`, containers, `accessibilityViewIsModal`
 * hiding the earlier siblings of a modal view), with their label, value, traits and frame. The dump is what the accessibility
 * services receive, not VoiceOver itself: the run file says so. Same six checks and the same counts as the Android suite
 * (`lib/a11y.ts`), so the report and the gates read both alike:
 *
 * - reachable: the element has a frame inside the screen and says something (a label, a value or a hint);
 * - labeled: it has a label, a value or a hint;
 * - actionable: it is exposed as a control: the button, link, adjustable or search field trait, or a text input. A control the
 *   screen's source declares (by label) whose element has none of these (a pressable VoiceOver reads as plain text) fails here,
 *   and one that is not in the tree at all is unreachable;
 * - order: VoiceOver sorts the elements of a screen by position (rows from the top; within a row from the start edge, the right
 *   edge in right-to-left) except those a container orders itself (`explicit`), which keep the container's order; the sorted list
 *   must run top to bottom and start to end;
 * - title first: the screen's title is a stop with the header trait and no content comes before it;
 * - focus trap: while a sheet or modal is up, the labels of the screen underneath are not in the tree.
 */

export type IosElement = {
	class: string;
	label?: string;
	value?: string;
	hint?: string;
	identifier?: string;
	text?: string;
	traits: string[];
	/** x, y, width, height in points, screen coordinates. */
	frame: [number, number, number, number];
	/** The order of this element was set by its container (`accessibilityElements` or the container protocol), not by position. */
	explicit: boolean;
	group: number;
	parents?: string[];
};

export type IosDump = {
	screen: { width: number; height: number; scale: number };
	rtl: boolean;
	elements: IosElement[];
	modalViews: { class: string; ignoredSiblings: number }[];
	movingViews: { class: string; frame: number[] }[];
};

/** What `uikitState` reports of a view controller (`SvelteQAUIKit.swift`), as far as the checks read it. */
export type UiKitController = {
	class: string;
	shown?: boolean;
	viewFrame?: number[];
	navigation?: {
		barHidden: boolean;
		barFrame: number[];
		items: { title?: string | null; subtitle?: string | null; hidesBackButton?: boolean; hasSearchController?: boolean; searchPlaceholder?: string | null }[];
		topIndex: number;
	};
	tabs?: {
		selectedIndex: number;
		barFrame: number[];
		items: { title?: string | null; badge?: string | null; accessibilityLabel?: string | null; enabled?: boolean }[];
	};
	children?: UiKitController[];
	presented?: UiKitController;
};
export type UiKitState = { screen: { width: number; height: number; scale: number }; safeArea: number[]; rtl: boolean; root: UiKitController };

export type IosA11yInput = {
	dump: IosDump;
	/** The state of the view controllers: UIKit's own chrome (title, back button, search field, tab bar items) is an accessibility element only while a service runs, so it is read from here. */
	state?: UiKitState | null;
	direction: Direction;
	/** The title the screen should lead with (the heading), or null for a screen without one. */
	title: string | null;
	/** Further stops the header reads right after the title by design. */
	lead: string[];
	/** Labels of the controls the screen's source declares. */
	controls: string[];
	/** Controls that may be below the fold: checked when the dump has them, never reported missing. */
	scrolled: string[];
	/** Labels that must not be in the tree: the covered screen's, while a sheet or modal is up. */
	hidden: string[];
	layout: Layout;
};

const interactiveTraits = new Set(["button", "link", "adjustable", "searchField", "keyboardKey"]);
const inputClass = /TextField|TextView|TextInput|SearchBar|Switch/;

const rectOf = (element: IosElement): Rect => ({
	x: element.frame[0],
	y: element.frame[1],
	width: element.frame[2],
	height: element.frame[3],
});

export const isTextInput = (element: IosElement): boolean =>
	inputClass.test(element.class) || element.traits.includes("searchField");

export const isActionable = (element: IosElement): boolean =>
	element.traits.some((trait) => interactiveTraits.has(trait)) || isTextInput(element);

export const isDisabled = (element: IosElement): boolean => element.traits.includes("notEnabled");

/** What VoiceOver speaks for the element, before the traits: label, then value. */
export function spoken(element: IosElement): string {
	return [element.label, element.value].filter((part) => part && part.trim() !== "").join(", ");
}

const hasWords = (element: IosElement): boolean =>
	spoken(element).trim() !== "" || (element.hint ?? "").trim() !== "";

function onScreen(rect: Rect, screen: IosDump["screen"]): boolean {
	return (
		rect.width > 0 &&
		rect.height > 0 &&
		rect.x < screen.width &&
		rect.x + rect.width > 0 &&
		rect.y < screen.height &&
		rect.y + rect.height > 0
	);
}

function describe(element: IosElement): string {
	const klass = element.class.replace(/^_?(UI|RCT)/, "");
	const [x, y, width, height] = element.frame.map(Math.round);
	const label = spoken(element);
	const traits = element.traits.filter((trait) => trait !== "staticText");
	return `${klass}${label ? ` ${JSON.stringify(label)}` : ""}${traits.length ? ` (${traits.join(", ")})` : ""} [${x},${y} ${width}x${height}]`;
}

/** A declared control is this element when its label is the declared one, or starts with it (`Home` for `Home, new items`). */
function matches(element: IosElement, label: string): boolean {
	const said = spoken(element).trim();
	return said === label || said.startsWith(`${label},`);
}

/**
 * The elements in the order VoiceOver walks them. Elements whose container set the order keep it (a group stays together, at
 * the position of its first element); the others are sorted by row: rows from the top, an element joining a row when it
 * overlaps the row's first element by half its height, and within a row from the start edge.
 */
export function voiceOverOrder(elements: IosElement[], direction: Direction): IosElement[] {
	type Unit = { first: IosElement; items: IosElement[] };
	const units: Unit[] = [];
	const groups = new Map<number, Unit>();
	for (const element of elements) {
		if (element.explicit) {
			const existing = groups.get(element.group);
			if (existing) {
				existing.items.push(element);
				continue;
			}
			const unit = { first: element, items: [element] };
			groups.set(element.group, unit);
			units.push(unit);
		} else units.push({ first: element, items: [element] });
	}
	const byTop = [...units].sort((a, b) => a.first.frame[1] - b.first.frame[1] || a.first.frame[0] - b.first.frame[0]);
	const rows: Unit[][] = [];
	for (const unit of byTop) {
		const row = rows[rows.length - 1];
		const head = row?.[0]?.first;
		if (row && head) {
			const a = rectOf(head);
			const b = rectOf(unit.first);
			const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
			if (overlap > 0 && overlap / Math.min(a.height, b.height) >= 0.5) {
				row.push(unit);
				continue;
			}
		}
		rows.push([unit]);
	}
	return rows.flatMap((row) =>
		row
			.sort((a, b) =>
				direction === "ltr" ? a.first.frame[0] - b.first.frame[0] : b.first.frame[0] - a.first.frame[0],
			)
			.flatMap((unit) => unit.items),
	);
}

function eachController(controller: UiKitController, visit: (controller: UiKitController) => void): void {
	visit(controller);
	for (const child of controller.children ?? []) eachController(child, visit);
	if (controller.presented) eachController(controller.presented, visit);
}

const chrome = (label: string, traits: string[], frame: number[], extra: Partial<IosElement> = {}): IosElement => ({
	class: "UIKit chrome",
	label,
	traits,
	frame: [frame[0] ?? 0, frame[1] ?? 0, frame[2] ?? 0, frame[3] ?? 0],
	explicit: false,
	group: 0,
	...extra,
});

/**
 * The elements UIKit's own chrome contributes: the navigation bar's title (a heading), its back button, a search field, and the tab
 * bar's items with their labels. Only what is on screen counts (a hidden tab pane's stack has a bar too), and a presented screen
 * hides the controllers under it. The frames are where UIKit lays them out: title in the middle of the bar, back at its start,
 * the tabs side by side across the tab bar.
 */
export function chromeElements(state: UiKitState): IosElement[] {
	let top = state.root;
	while (top.presented) top = top.presented;
	const elements: IosElement[] = [];
	eachController(top, (controller) => {
		if (controller.shown === false) return;
		const navigation = controller.navigation;
		if (navigation && !navigation.barHidden && (navigation.barFrame[3] ?? 0) > 0) {
			const [x = 0, y = 0, width = 0, height = 0] = navigation.barFrame;
			const item = navigation.items[navigation.topIndex];
			const barTop = y + Math.min(state.safeArea[0] ?? 0, height);
			const barHeight = Math.max(height - (barTop - y), 0);
			if (item?.title) elements.push(chrome(item.title, ["staticText", "header"], [x + width * 0.25, barTop, width * 0.5, Math.min(barHeight, 44)]));
			if (navigation.topIndex > 0 && item?.hidesBackButton !== true) {
				elements.push(chrome("Back", ["button"], [state.rtl ? x + width - 80 : x, barTop, 80, Math.min(barHeight, 44)]));
			}
			if (item?.hasSearchController) elements.push(chrome(item.searchPlaceholder || "Search", ["searchField"], [x + 8, barTop + Math.min(barHeight, 44), width - 16, 36]));
		}
		const tabs = controller.tabs;
		if (tabs && tabs.items.length > 0 && (tabs.barFrame[3] ?? 0) > 0) {
			const [x = 0, y = 0, width = 0, height = 0] = tabs.barFrame;
			const each = width / tabs.items.length;
			tabs.items.forEach((item, index) => {
				const slot = state.rtl ? tabs.items.length - 1 - index : index;
				const label = item.accessibilityLabel || [item.title, item.badge === "" ? "new items" : item.badge].filter(Boolean).join(", ");
				const traits = ["button", ...(index === tabs.selectedIndex ? ["selected"] : []), ...(item.enabled === false ? ["notEnabled"] : [])];
				elements.push(chrome(label, traits, [x + slot * each, y, each, height]));
			});
		}
	});
	return elements;
}

export function analyzeIosScreen(input: IosA11yInput): A11yScreen {
	const { direction, title, lead, controls, scrolled, hidden, layout } = input;
	const dump: IosDump = input.state ? { ...input.dump, elements: [...input.dump.elements, ...chromeElements(input.state)] } : input.dump;
	const findings: A11yFinding[] = [];
	const visible = dump.elements.filter((element) => onScreen(rectOf(element), dump.screen));

	/* Elements: every interactive one, plus each declared control no interactive element carries. */
	type Candidate = { element: IosElement | null; label: string };
	const candidates: Candidate[] = dump.elements
		.filter(isActionable)
		.map((element) => ({ element, label: spoken(element) }));
	const present = scrolled.filter((label) => dump.elements.some((element) => matches(element, label)));
	for (const label of [...controls, ...present]) {
		if (candidates.some(({ element }) => element && isActionable(element) && matches(element, label))) continue;
		candidates.push({ element: dump.elements.find((element) => matches(element, label)) ?? null, label });
	}

	let reachable = 0;
	let labeled = 0;
	let actionable = 0;
	let disabled = 0;
	let clipped = 0;
	let unreachable = 0;
	let unlabeled = 0;
	let notActionable = 0;
	for (const { element, label } of candidates) {
		if (!element) {
			unreachable++;
			findings.push({ kind: "unreachable", element: JSON.stringify(label), detail: "declared by the screen but not in the accessibility tree" });
			continue;
		}
		if (isDisabled(element)) {
			disabled++;
			continue;
		}
		const rect = rectOf(element);
		if (!onScreen(rect, dump.screen) && rect.width > 0 && rect.height > 0) {
			clipped++;
			continue;
		}
		const where = describe(element);
		if (onScreen(rect, dump.screen) && hasWords(element)) reachable++;
		else {
			unreachable++;
			findings.push({
				kind: "unreachable",
				element: where,
				detail: rect.width <= 0 || rect.height <= 0 ? "zero-size frame" : !onScreen(rect, dump.screen) ? "outside the screen" : "says nothing (no label, value or hint)",
			});
		}
		if (hasWords(element)) labeled++;
		else {
			unlabeled++;
			findings.push({ kind: "unlabeled", element: where, detail: "no accessibility label, value or hint" });
		}
		if (isActionable(element)) actionable++;
		else {
			notActionable++;
			findings.push({
				kind: "notActionable",
				element: where,
				detail: "a control of the screen that VoiceOver reads as plain text: no button, link, adjustable or search field trait",
			});
		}
	}

	/* Order and title. */
	const stops = voiceOverOrder(
		visible.filter((element) => hasWords(element) || isActionable(element)),
		direction,
	);
	const titleStop = title === null ? null : (stops.find((stop) => matches(stop, title)) ?? null);
	let titleFirst: boolean | null = null;
	let orderViolations = 0;
	if (title !== null) {
		if (!titleStop) {
			titleFirst = false;
			findings.push({ kind: "title", element: JSON.stringify(title), detail: "the screen's title is not a focus stop in the tree" });
		} else {
			const titleRect = rectOf(titleStop);
			const before = stops.slice(0, stops.indexOf(titleStop));
			const content = before.find((stop) => stop.frame[1] >= titleRect.y + titleRect.height - 4);
			// A title the header's center slot replaces is a control of the slot (Android's contract too), not a heading.
			const heading = titleStop.traits.includes("header") || controls.some((label) => matches(titleStop, label));
			titleFirst = content === undefined && heading;
			if (content) findings.push({ kind: "title", element: describe(titleStop), detail: `content comes before the title: ${describe(content)}` });
			if (!heading) findings.push({ kind: "title", element: describe(titleStop), detail: "the title is not exposed as a heading (no header trait)" });
		}
	}
	for (let index = 0; index + 1 < stops.length; index++) {
		const a = stops[index] as IosElement;
		const b = stops[index + 1] as IosElement;
		if (layout !== "page" && (a === titleStop || lead.some((label) => matches(a, label)))) continue;
		if (followsInOrderRect(rectOf(a), rectOf(b), direction)) continue;
		orderViolations++;
		findings.push({
			kind: "order",
			element: `${describe(a)} then ${describe(b)}`,
			detail: `${direction === "rtl" ? "right to left" : "left to right"}, top to bottom expected`,
		});
	}

	let focusLeaks = 0;
	for (const label of hidden) {
		// The hidden labels are the controls of the screen under the sheet: a heading of the sheet that reads the same is not one of them.
		const leaked = visible.find((element) => isActionable(element) && matches(element, label));
		if (!leaked) continue;
		focusLeaks++;
		findings.push({ kind: "leak", element: describe(leaked), detail: "belongs to the screen under the sheet or modal, which VoiceOver can still reach" });
	}

	return {
		interactive: candidates.length,
		reachable,
		labeled,
		actionable,
		disabled,
		clipped,
		unreachable,
		unlabeled,
		notActionable,
		stops: stops.map((stop) => spoken(stop) || describe(stop)),
		orderViolations,
		titleFirst,
		focusLeaks,
		findings,
	};
}
