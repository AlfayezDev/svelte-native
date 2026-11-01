import type { Direction } from "./device.ts";
import type { Rect } from "./png.ts";
import type { Layout } from "./screens.ts";
import { bottom, descendants, right, spokenLabel, type UiNode, type UiTree } from "./uia.ts";

/**
 * The accessibility checklist, run on the tree an accessibility service walks: `uiautomator dump --compressed`, the dump
 * without the views that are not important for accessibility and without everything under a `no-hide-descendants` view
 * (the screens under a sheet or modal, the sheet's scrim). It carries the node info the engine's `A11y.kt`, `EngineText`,
 * `EngineHeader` and `EngineTabs` publish. TalkBack is on the emulator, but its swipes do not reach an injected gesture
 * reliably enough to drive a suite; a pass with it (and with a probe service logging its events, SPEC "Android wave 4")
 * confirmed that this tree is what it reads. The plain dump lists the views a service never visits (uiautomator asks for
 * them), so no check reads it: judged on it, the scrim of a sheet is an unlabeled stop and the screen under the sheet
 * breaks the order and the title. Six checks, counted per element or per screen:
 *
 * - reachable: the element is in the tree, has non-zero bounds inside the display, is enabled, and a service can put focus
 *   on it (it is focusable or actionable or says something). A control the screen's source declares that the tree does not
 *   contain at all is unreachable.
 * - labeled: it has text, a content description or a hint of its own, or a descendant that does.
 * - actionable: it advertises an action (clickable, long-clickable, checkable, or a text field).
 * - order: the focus stops, in tree order, run top to bottom and, within a row, from the start edge to the end (left to
 *   right, right to left in RTL). A header reads back button, left slot, title (or center slot), right slot, search: that is
 *   start to end, so it needs no exemption; its large title, the bar's second row, is the one step that goes up.
 * - toolbar band: a toolbar at the bottom of the screen is its own group, read after the content as the header is read first
 *   (inside it from the start edge to the end). Content never joins a toolbar's row, however far the two frames overlap: the
 *   last visible row of a list can sit under a translucent toolbar. The engine marks the toolbar's controls with a resource id
 *   (`isToolbarNode`); a stop of the band read before a stop of the content is an order violation.
 * - title first: the screen's title is a stop (a stop with no label of its own is the label its content carries: a `Pressable`
 *   around a `Text`), and it is the first stop after the bar's back button and left slot: whatever comes before it sits above
 *   its row or at its start side, and no content does. `judgeReadingOrder` is that rule and the order rule for both platforms.
 * - focus trap: while a sheet or modal is up, nothing of the screen underneath is in the tree (a service must not be able to
 *   reach it).
 *
 * And one measurement that no gate judges (`smallTargets`, a finding of kind `target`): an enabled control that is fully on screen and
 * smaller than 48 dp in either direction (`minimumTargetDp`), when the display's density is known. It is reported per screen and
 * summed in `a11y.smallTargets`, so a product screen's small controls show up in the run files and the report.
 */

export type A11yKind = "unreachable" | "unlabeled" | "notActionable" | "order" | "title" | "leak" | "target";

/** The smallest touch target Android's accessibility guidance asks for, in dp, in each dimension. */
export const minimumTargetDp = 48;

export type A11yFinding = {
	kind: A11yKind;
	/** The node, as `Button "Search" [954,128 126x147]`, or the declared control that is missing. */
	element: string;
	detail: string;
};

export type A11yScreen = {
	/** Interactive nodes in the tree plus declared controls the tree does not expose. */
	interactive: number;
	reachable: number;
	labeled: number;
	actionable: number;
	/** Interactive and disabled: not counted against any check (a disabled control is deliberately unavailable). */
	disabled: number;
	/** Interactive, outside the display, scrolled out of its container (uiautomator reports a negative extent) or with no visible size (its bounds are clipped to nothing), inside a scroll container, and declared below the fold by the screen (`scrolled`): not checked. Any other element outside the display is unreachable. */
	clipped: number;
	unreachable: number;
	unlabeled: number;
	notActionable: number;
	/** Enabled controls fully on screen smaller than `minimumTargetDp` in either direction (not judged by a gate). Absent where the density is unknown (the iPhone). */
	smallTargets?: number;
	/** Focus stops in tree order, as labels, the order a linear screen reader walk visits them. */
	stops: string[];
	orderViolations: number;
	titleFirst: boolean | null;
	/** Labels of the screen underneath that a sheet or modal leaves in the tree. */
	focusLeaks: number;
	findings: A11yFinding[];
	/** iOS: the bars modelled from UIKit's state, which no accessibility client reported and the counts above leave out. */
	chromeModelled?: number;
};

/** The share of a screen's interactive elements that are reachable, for the line printed per screen. */
export function reachPct(screen: { interactive: number; reachable: number }): string {
	return screen.interactive === 0 ? "-" : `${((screen.reachable / screen.interactive) * 100).toFixed(0)} %`;
}

export type A11yInput = {
	/** What a service walks: the dump taken with `--compressed` (see the top of this file). */
	tree: UiTree;
	direction: Direction;
	/** `densityDpi` turns pixels into dp for the touch-target size; without it that measurement is not made. */
	display: { width: number; height: number; densityDpi?: number };
	/** The localized title the screen should lead with (after the bar's back button and left slot), or null for a screen without one. */
	title: string | null;
	/** The localized labels of the controls the screen's source declares. */
	controls: string[];
	/** Controls that may be below the fold at the largest text: evaluated when the tree has them, not reported missing when it does not. */
	scrolled: string[];
	/** Labels that must not be in the tree: the covered screen's, while a sheet or modal is up. */
	hidden: string[];
	layout: Layout;
};

const interactiveClasses = new Set([
	"android.widget.Button",
	"android.widget.ImageButton",
	"android.widget.CheckBox",
	"android.widget.RadioButton",
	"android.widget.Switch",
	"android.widget.ToggleButton",
	"android.widget.EditText",
	"android.widget.Spinner",
	"android.widget.SeekBar",
]);

const tolerance = 4;

function isTextField(node: UiNode): boolean {
	return node.className === "android.widget.EditText";
}

export function isActionable(node: UiNode): boolean {
	return node.clickable || node.longClickable || node.checkable || isTextField(node);
}

export function isInteractive(node: UiNode): boolean {
	return isActionable(node) || interactiveClasses.has(node.className);
}

function intersects(rect: Rect, display: { width: number; height: number }): boolean {
	return rect.x < display.width && right(rect) > 0 && rect.y < display.height && bottom(rect) > 0;
}

/** A node outside the display, or with the negative width or height uiautomator reports for one scrolled out of its container. */
function isOffScreen(node: UiNode, display: { width: number; height: number }): boolean {
	return node.bounds.width < 0 || node.bounds.height < 0 || (node.bounds.width > 0 && node.bounds.height > 0 && !intersects(node.bounds, display));
}

/** A node with no width or height: uiautomator reports one this way when the visible part of a view at the edge of its scroll container is empty. */
function hasNoVisibleSize(node: UiNode): boolean {
	return node.bounds.width === 0 || node.bounds.height === 0;
}

function describe(node: UiNode): string {
	const klass = node.className.replace(/^android\.(widget|view)\./, "");
	const label = spokenLabel(node);
	const { x, y, width, height } = node.bounds;
	return `${klass}${label ? ` ${JSON.stringify(label)}` : ""} [${x},${y} ${width}x${height}]`;
}

/** Whether the node, or something under it, says something to a user. */
function hasLabel(node: UiNode): boolean {
	if (spokenLabel(node).trim()) return true;
	return descendants(node).some((child) => spokenLabel(child).trim() !== "");
}

function sameLabel(node: UiNode, label: string): boolean {
	return node.text.trim() === label || node.contentDesc.trim() === label;
}

/**
 * What a service speaks for a group that says nothing itself: the labels of what it holds, in tree order, leaving out the
 * controls inside it (stops of their own). A `Pressable` around a `Text` is a clickable view with no text and a child with
 * "Segment A"; TalkBack reads it as "Segment A, button", so that is the label the checks match against.
 */
function heldLabel(node: UiNode): string {
	const labels: string[] = [];
	const walk = (current: UiNode): void => {
		for (const child of current.children) {
			if (isInteractive(child)) continue;
			const label = spokenLabel(child).trim();
			if (label) labels.push(label);
			else walk(child);
		}
	};
	walk(node);
	return labels.join(", ");
}

/** A stop is the label if it says so itself, or, saying nothing itself, if what it holds does ([heldLabel]). */
function stopSays(stop: UiNode, label: string): boolean {
	return sameLabel(stop, label) || (spokenLabel(stop).trim() === "" && heldLabel(stop) === label);
}

const scrollContainer = /ScrollView|RecyclerView|ListView|ViewPager/;

function isScrollContainer(node: UiNode): boolean {
	return node.scrollable || scrollContainer.test(node.className);
}

function inScrollContainer(node: UiNode): boolean {
	for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) if (isScrollContainer(ancestor)) return true;
	return false;
}

/**
 * The nodes a linear screen reader walk stops on, in tree order: every visible node that is actionable, or says something
 * itself, or is a focusable group with something to say below it. A scroll view is never a stop. The subtree of a stop is
 * folded into it (a service reads a button's label once), unless something interactive sits inside it: then the walk goes on
 * into the subtree, because those controls are stops of their own.
 */
export function focusStops(tree: UiTree): UiNode[] {
	const stops: UiNode[] = [];
	const visit = (node: UiNode): void => {
		const visible = node.bounds.width > 0 && node.bounds.height > 0;
		const scrolls = isScrollContainer(node);
		const stop =
			visible &&
			(isActionable(node) ||
				(!scrolls && (spokenLabel(node).trim() !== "" || (node.focusable && hasLabel(node)))));
		if (stop) {
			stops.push(node);
			if (!descendants(node).some((child) => isInteractive(child))) return;
		}
		for (const child of node.children) visit(child);
	};
	if (tree.root) visit(tree.root);
	return stops;
}

const centerX = (rect: Rect) => rect.x + rect.width / 2;
const centerY = (rect: Rect) => rect.y + rect.height / 2;

function containsCenter(outer: Rect, inner: Rect): boolean {
	const x = centerX(inner);
	const y = centerY(inner);
	return x >= outer.x && x <= right(outer) && y >= outer.y && y <= bottom(outer);
}

function overlapRatio(a: Rect, b: Rect): number {
	const width = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
	const height = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
	if (width <= 0 || height <= 0) return 0;
	return (width * height) / Math.min(a.width * a.height, b.width * b.height);
}

function verticalOverlap(a: Rect, b: Rect): number {
	const overlap = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
	return overlap <= 0 ? 0 : overlap / Math.min(a.height, b.height);
}

/**
 * Whether stop `b` may follow stop `a` in reading order. Stacked stops (one inside or over the other) are left alone,
 * stops in one row run from the start edge to the end, and otherwise the next stop is not above the previous one.
 */
export function followsInOrderRect(a: Rect, b: Rect, direction: Direction): boolean {
	if (overlapRatio(a, b) > 0.5) return true;
	if (verticalOverlap(a, b) >= 0.5) {
		return direction === "ltr"
			? centerX(b) >= centerX(a) - tolerance
			: centerX(b) <= centerX(a) + tolerance;
	}
	return centerY(b) >= centerY(a) - tolerance;
}

/** The resource id the engine's toolbar puts on its controls (`svelte-toolbar`, or `svelte-toolbar:<key>`): the one thing the dump carries of the band, its view classes being `android.widget.Button` and `android.view.ViewGroup`. */
const toolbarResource = /^svelte-toolbar(?:[:./-].*)?$/;

/** Whether the node, or a node holding it, is part of the engine's toolbar band (a control of its items or its center slot). */
export function isToolbarNode(node: UiNode): boolean {
	for (let current: UiNode | null = node; current; current = current.parent) if (toolbarResource.test(current.resourceId)) return true;
	return false;
}

export type ReadingOrder = {
	/**
	 * The first stop before the title that is not a start control of the bar, or null: `content` when it starts at or below the
	 * title's bottom edge, otherwise it is beside or above the title but after it in reading order (an end control).
	 */
	before: { index: number; content: boolean } | null;
	/** The indices `i` where stop `i + 1` does not follow stop `i`. */
	violations: number[];
};

/**
 * The reading-order rules, one definition for both platforms (`analyzeScreen` here and `analyzeIosScreen` for the iPhone), on the
 * stops' rectangles in the order a service reads them, and the index of the title's stop (null: no title to judge).
 *
 * - Title first: the title is the first stop after the bar's back button and left slot. Whatever comes before it sits above its row
 *   or at its start side (where those controls are, mirrored in right-to-left), and none of it is content.
 * - Toolbar band: `band[i]` says stop `i` belongs to the bottom toolbar. The band is a group of its own: the step from content into
 *   the band is never judged by position (the band is read after the content, even when a content row's frame overlaps it), the
 *   steps inside the band are judged like any row, and a step from the band back to content is a violation.
 * - Order: each stop follows the one before it, top to bottom and, in a row, start to end. A header's large title is the bar's
 *   second row and is read before the end controls of the first, so the step from the title up to a stop above it is not a
 *   violation (header layouts only; a page's title has no bar over it).
 */
export function judgeReadingOrder(stops: Rect[], titleAt: number | null, direction: Direction, layout: Layout, band: boolean[] = []): ReadingOrder {
	let before: ReadingOrder["before"] = null;
	const title = titleAt === null ? undefined : stops[titleAt];
	if (title && titleAt !== null) {
		for (let index = 0; index < titleAt; index++) {
			const stop = stops[index] as Rect;
			const content = stop.y >= bottom(title) - tolerance;
			if (content || !followsInOrderRect(stop, title, direction)) {
				before = { index, content };
				break;
			}
		}
	}
	const violations: number[] = [];
	for (let index = 0; index + 1 < stops.length; index++) {
		const a = stops[index] as Rect;
		const b = stops[index + 1] as Rect;
		const inBand = band[index] === true;
		if (inBand !== (band[index + 1] === true)) {
			if (inBand) violations.push(index);
			continue;
		}
		if (followsInOrderRect(a, b, direction)) continue;
		if (layout !== "page" && index === titleAt && verticalOverlap(a, b) < 0.5 && centerY(b) < centerY(a)) continue;
		violations.push(index);
	}
	return { before, violations };
}

type Element = { node: UiNode | null; label: string };

export function analyzeScreen(input: A11yInput): A11yScreen {
	const { tree, direction, display, title, controls, scrolled, hidden, layout } = input;
	const findings: A11yFinding[] = [];

	/* Elements: every interactive node, plus each declared control, matched to a node (an interactive one if there is one). */
	const elements: Element[] = tree.nodes
		.filter(isInteractive)
		.map((node) => ({ node, label: spokenLabel(node) }));
	const present = scrolled.filter((label) => tree.nodes.some((node) => sameLabel(node, label)));
	for (const label of [...controls, ...present]) {
		const plain = tree.nodes.find(
			(node) => sameLabel(node, label) && (node.bounds.width !== 0 || node.bounds.height !== 0),
		);
		// A declared control is accounted for by an interactive node that carries its label, or that visibly contains the
		// node that does (a button whose text sits beside it in the tree is still that control, with a defect of its own).
		const covered = elements.some(
			({ node }) =>
				node !== null &&
				(sameLabel(node, label) ||
					descendants(node).some((child) => sameLabel(child, label)) ||
					(plain !== undefined && containsCenter(node.bounds, plain.bounds))),
		);
		if (covered) continue;
		elements.push({ node: plain ?? null, label });
	}

	let reachable = 0;
	let labeled = 0;
	let actionable = 0;
	let disabled = 0;
	let clipped = 0;
	let unreachable = 0;
	let unlabeled = 0;
	let notActionable = 0;
	let smallTargets = display.densityDpi === undefined ? undefined : 0;
	for (const element of elements) {
		const { node } = element;
		if (!node) {
			unreachable++;
			findings.push({
				kind: "unreachable",
				element: JSON.stringify(element.label),
				detail: "declared by the screen but not in the accessibility tree",
			});
			continue;
		}
		if (!node.enabled) {
			disabled++;
			continue;
		}
		// Off the screen, or with no visible size (uiautomator clips the bounds to the visible area, so a view on the edge of its scroll view has none), is clipped only where the screen says a scroll container holds the control below the fold; anywhere else it is out of reach.
		if (
			(isOffScreen(node, display) || hasNoVisibleSize(node)) &&
			inScrollContainer(node) &&
			scrolled.some((label) => sameLabel(node, label))
		) {
			clipped++;
			continue;
		}
		const where = describe(node);
		const sees =
			node.bounds.width > 0 &&
			node.bounds.height > 0 &&
			intersects(node.bounds, display) &&
			(node.focusable || isActionable(node) || spokenLabel(node).trim() !== "");
		if (sees) {
			reachable++;
			const scale = (display.densityDpi ?? 160) / 160;
			const edge = node.bounds.y <= 0 || bottom(node.bounds) >= display.height || node.bounds.x <= 0 || right(node.bounds) >= display.width;
			if (smallTargets !== undefined && !edge && Math.min(node.bounds.width, node.bounds.height) / scale < minimumTargetDp - 0.5) {
				smallTargets++;
				findings.push({
					kind: "target",
					element: where,
					detail: `${(node.bounds.width / scale).toFixed(0)} x ${(node.bounds.height / scale).toFixed(0)} dp, under the ${minimumTargetDp} dp touch target`,
				});
			}
		} else {
			unreachable++;
			findings.push({
				kind: "unreachable",
				element: where,
				detail:
					node.bounds.width < 0 || node.bounds.height < 0
						? "negative extent (scrolled out of its container) and not declared below the fold"
						: node.bounds.width === 0 || node.bounds.height === 0
							? "zero-size bounds"
							: !intersects(node.bounds, display)
								? "outside the display"
								: "a service cannot focus it (not focusable, not actionable, no label)",
			});
		}
		if (hasLabel(node)) {
			labeled++;
		} else {
			unlabeled++;
			findings.push({
				kind: "unlabeled",
				element: where,
				detail: "no text, content description or hint, and no labeled descendant",
			});
		}
		if (isActionable(node)) {
			actionable++;
		} else {
			notActionable++;
			findings.push({
				kind: "notActionable",
				element: where,
				detail:
					"exposed as a control (class or declared) but advertises no click, long-click or check action",
			});
		}
	}

	/* Order and title. */
	const stops = focusStops(tree);
	const titleStop = title === null ? null : (stops.find((stop) => stopSays(stop, title)) ?? null);
	let titleFirst: boolean | null = null;
	let orderViolations = 0;
	const judged = judgeReadingOrder(
		stops.map((stop) => stop.bounds),
		titleStop ? stops.indexOf(titleStop) : null,
		direction,
		layout,
		stops.map(isToolbarNode),
	);
	if (title !== null) {
		if (!titleStop) {
			titleFirst = false;
			findings.push({
				kind: "title",
				element: JSON.stringify(title),
				detail: "the screen's title is not a focus stop in the tree",
			});
		} else {
			const offender = judged.before;
			titleFirst = offender === null;
			if (offender)
				findings.push({
					kind: "title",
					element: describe(titleStop),
					detail: `${offender.content ? "content" : "a control at the end side of the title"} comes before the title in the tree: ${describe(stops[offender.index] as UiNode)}`,
				});
		}
	}
	for (const index of judged.violations) {
		orderViolations++;
		findings.push({
			kind: "order",
			element: `${describe(stops[index] as UiNode)} then ${describe(stops[index + 1] as UiNode)}`,
			detail: `${direction === "rtl" ? "right to left" : "left to right"}, top to bottom expected`,
		});
	}

	let focusLeaks = 0;
	for (const label of hidden) {
		// A sheet is titled like the button that opened it ("Form sheet"): its own title is not the screen underneath.
		const leaked = tree.nodes.find(
			(node) =>
				node.bounds.width > 0 &&
				node.bounds.height > 0 &&
				sameLabel(node, label) &&
				!(title !== null && label === title && !isActionable(node)),
		);
		if (!leaked) continue;
		focusLeaks++;
		findings.push({
			kind: "leak",
			element: describe(leaked),
			detail: "belongs to the screen under the sheet or modal, which a service can still reach",
		});
	}

	return {
		interactive: elements.length,
		reachable,
		labeled,
		actionable,
		disabled,
		clipped,
		unreachable,
		unlabeled,
		notActionable,
		...(smallTargets === undefined ? {} : { smallTargets }),
		stops: stops.map((stop) => spokenLabel(stop) || heldLabel(stop) || describe(stop)),
		orderViolations,
		titleFirst,
		focusLeaks,
		findings,
	};
}
