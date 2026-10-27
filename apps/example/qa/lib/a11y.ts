import type { Direction } from "./device.ts";
import type { Rect } from "./png.ts";
import type { Layout } from "./screens.ts";
import { bottom, descendants, right, spokenLabel, type UiNode, type UiTree } from "./uia.ts";

/**
 * The accessibility checklist, run on the tree `uiautomator dump` returns for a screen. TalkBack is not installed on the
 * emulator, so this tree (the node info the engine's `A11y.kt`, `EngineText`, `EngineHeader` and `EngineTabs` publish, which is
 * what any accessibility service receives) is the oracle. Six checks, counted per element or per screen:
 *
 * - reachable: the element is in the tree, has non-zero bounds inside the display, is enabled, and a service can put focus
 *   on it (it is focusable or actionable or says something). A control the screen's source declares that the tree does not
 *   contain at all is unreachable.
 * - labeled: it has text, a content description or a hint of its own, or a descendant that does.
 * - actionable: it advertises an action (clickable, long-clickable, checkable, or a text field).
 * - order: the focus stops, in tree order, run top to bottom and, within a row, from the start edge to the end (left to
 *   right, right to left in RTL).
 * - title first: the screen's title is a stop, and no content stop comes before it.
 * - focus trap: while a sheet or modal is up, nothing of the screen underneath is in the tree (a service must not be able to
 *   reach it).
 */

export type A11yKind = "unreachable" | "unlabeled" | "notActionable" | "order" | "title" | "leak";

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
	/** Interactive but scrolled partly out of its container (uiautomator reports a negative extent): not checked. */
	clipped: number;
	unreachable: number;
	unlabeled: number;
	notActionable: number;
	/** Focus stops in tree order, as labels, the order a linear screen reader walk visits them. */
	stops: string[];
	orderViolations: number;
	titleFirst: boolean | null;
	/** Labels of the screen underneath that a sheet or modal leaves in the tree. */
	focusLeaks: number;
	findings: A11yFinding[];
};

export type A11yInput = {
	tree: UiTree;
	direction: Direction;
	display: { width: number; height: number };
	/** The localized title the screen should lead with, or null for a screen without one. */
	title: string | null;
	/** Further stops the header reads right after the title by design (a center slot's controls) before the controls at its start side. */
	lead: string[];
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

/** A node that reports a negative width or height: uiautomator's way of saying it is scrolled out of its container. */
function isClipped(node: UiNode): boolean {
	return node.bounds.width < 0 || node.bounds.height < 0;
}

function intersects(rect: Rect, display: { width: number; height: number }): boolean {
	return rect.x < display.width && right(rect) > 0 && rect.y < display.height && bottom(rect) > 0;
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

const scrollContainer = /ScrollView|RecyclerView|ListView|ViewPager/;

function isScrollContainer(node: UiNode): boolean {
	return node.scrollable || scrollContainer.test(node.className);
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

function followsInOrder(a: UiNode, b: UiNode, direction: Direction): boolean {
	return followsInOrderRect(a.bounds, b.bounds, direction);
}

type Element = { node: UiNode | null; label: string };

export function analyzeScreen(input: A11yInput): A11yScreen {
	const { tree, direction, display, title, lead, controls, scrolled, hidden, layout } = input;
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
		if (isClipped(node)) {
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
		} else {
			unreachable++;
			findings.push({
				kind: "unreachable",
				element: where,
				detail:
					node.bounds.width <= 0 || node.bounds.height <= 0
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
	const titleStop = title === null ? null : (stops.find((stop) => sameLabel(stop, title)) ?? null);
	let titleFirst: boolean | null = null;
	let orderViolations = 0;
	if (title !== null) {
		if (!titleStop) {
			titleFirst = false;
			findings.push({
				kind: "title",
				element: JSON.stringify(title),
				detail: "the screen's title is not a focus stop in the tree",
			});
		} else {
			const before = stops.slice(0, stops.indexOf(titleStop));
			const content = before.find((stop) => stop.bounds.y >= bottom(titleStop.bounds) - tolerance);
			titleFirst = content === undefined;
			if (content)
				findings.push({
					kind: "title",
					element: describe(titleStop),
					detail: `content comes before the title in the tree: ${describe(content)}`,
				});
		}
	}
	for (let index = 0; index + 1 < stops.length; index++) {
		const a = stops[index] as UiNode;
		const b = stops[index + 1] as UiNode;
		// The header leads with its title and then runs back, left slot, right slot, search: by design the title is read
		// before the controls that sit at its start side.
		if (layout !== "page" && (a === titleStop || lead.some((label) => sameLabel(a, label))))
			continue;
		if (followsInOrder(a, b, direction)) continue;
		orderViolations++;
		findings.push({
			kind: "order",
			element: `${describe(a)} then ${describe(b)}`,
			detail: `${direction === "rtl" ? "right to left" : "left to right"}, top to bottom expected`,
		});
	}

	let focusLeaks = 0;
	for (const label of hidden) {
		const leaked = tree.nodes.find(
			(node) => node.bounds.width > 0 && node.bounds.height > 0 && sameLabel(node, label),
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
		stops: stops.map((stop) => spokenLabel(stop) || describe(stop)),
		orderViolations,
		titleFirst,
		focusLeaks,
		findings,
	};
}
