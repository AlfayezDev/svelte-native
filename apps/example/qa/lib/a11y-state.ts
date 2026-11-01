import type { A11yFinding } from "./a11y.ts";
import type { Direction } from "./device.ts";
import { localize, type Localized } from "./screens.ts";
import { spokenLabel, type UiNode, type UiTree } from "./uia.ts";

/**
 * What the accessibility suite checks of a control's state, value, hint and actions: the props the Android engine publishes to a service
 * (`A11y.kt`, SPEC.md "Accessibility props"), compared with what React Native's views publish for the same props. Two readers, because
 * no one of them sees it all:
 *
 * - **The uiautomator dump** (`--compressed`, the tree a service walks) carries per node: class, text, content description, resource id,
 *   `checkable`, `checked`, `clickable`, `long-clickable`, `enabled`, `focusable`, `selected`, `scrollable`, `hint` (the node's hint text) and
 *   its bounds. So it shows a role (the class), a checkbox's or radio's checked state, a selected tab, a disabled button, the label with the
 *   "busy", "mixed" and value text React Native appends, the click and long-click flags, and whether a `no-hide-descendants` view and what
 *   is under it are gone from the tree. It cannot show: the range (min, max, current), the tooltip text (React Native's hint), the
 *   role description, heading, the list of actions with their ids and labels (it has only the click and long-click flags), the expand and
 *   collapse actions, the live region, and `importantForAccessibility` of a view that is in the tree.
 * - **The app's own node info** (`SvelteEngine.accessibilityNodes()`, logged by the accessibility lab with `?probe=`): the `AccessibilityNodeInfo`
 *   of each lab control as its delegate fills it, which is what a service receives, with the fields above. It reads the lab's controls only, and
 *   it is the app's word for what it publishes, not a service's: it does not show how TalkBack speaks it (which stays a manual check,
 *   A11Y-MANUAL.md), or whether a service is told when a value changes while it has focus.
 */

/** What the dump must show of one node, found by its resource id (the `testID`). A key left out is not judged. */
export type NodeExpectation = {
	id: string;
	/** The node is not in the tree a service walks (a view hidden from it); with `label`, no node says that either. */
	absent?: boolean;
	label?: string;
	className?: string;
	/** The label a service speaks for the node: its content description, else its text, exactly. The words React Native appends ("mixed", "busy") are its own strings, in the app's language. */
	says?: Localized;
	checkable?: boolean;
	checked?: boolean;
	selected?: boolean;
	enabled?: boolean;
	clickable?: boolean;
	longClickable?: boolean;
	focusable?: boolean;
	/** The `hint` attribute, which is the node's hint text: React Native writes none (its hint is the tooltip text). */
	hint?: string;
};

/** The node info the app logs for one `testID` node (`A11yDump.kt`). */
export type NodeInfo = {
	id: string;
	class: string;
	text: string;
	desc: string;
	tooltip: string;
	stateDescription: string;
	hintText: string;
	roleDescription: string;
	heading: boolean;
	checkable: boolean;
	checked: boolean;
	selected: boolean;
	enabled: boolean;
	clickable: boolean;
	longClickable: boolean;
	focusable: boolean;
	/** `ACCESSIBILITY_LIVE_REGION_*`: 0 none, 1 polite, 2 assertive. */
	liveRegion: number;
	/** `View.IMPORTANT_FOR_ACCESSIBILITY_*`: 0 auto, 1 yes, 2 no, 4 no-hide-descendants. */
	important: number;
	range?: { min: number; max: number; current: number };
	actions: { id: number; label: string }[];
};

/** An action a node must offer: by the JavaScript name for the standard ones (ids below), by its label for the custom ones. */
export type ActionExpectation = { name: string; label: string };

export type InfoExpectation = {
	id: string;
	className?: string;
	desc?: Localized;
	text?: string;
	/** The tooltip text: where React Native puts `accessibilityHint`. */
	tooltip?: string;
	/** Always judged as empty unless given: React Native writes no state description and no hint text. */
	stateDescription?: string;
	hintText?: string;
	/** React Native's string for the role, in the app's language ("Tab", "Radio Group"). */
	roleDescription?: Localized;
	heading?: boolean;
	checkable?: boolean;
	checked?: boolean;
	selected?: boolean;
	enabled?: boolean;
	clickable?: boolean;
	liveRegion?: number;
	important?: number;
	/** The range, or null for none. */
	range?: { min: number; max: number; current: number } | null;
	/** Actions the node must offer (and, of the standard ones named here, only these). */
	actions?: ActionExpectation[];
	/** Standard action names the node must not offer. */
	without?: string[];
};

/** `AccessibilityNodeInfo.ACTION_*` for the names React Native's `actionIdMap` knows; any other name is a custom action (ids from `customActionStart`). */
export const standardActions: Record<string, number> = {
	activate: 0x10,
	longpress: 0x20,
	increment: 0x1000,
	decrement: 0x2000,
	expand: 0x40000,
	collapse: 0x80000,
};
export const customActionStart = 0x3f000000;

/** Whether the node offers an action the dump has no flag for: a custom one, or the scroll actions `increment` and `decrement` stand for. */
export function offersActions(info: NodeInfo): boolean {
	return info.actions.some((action) => action.id >= customActionStart || action.id === standardActions.increment || action.id === standardActions.decrement);
}

function describe(node: UiNode): string {
	const { x, y, width, height } = node.bounds;
	return `${node.className.replace(/^android\.(widget|view)\./, "")} ${JSON.stringify(spokenLabel(node))} [${x},${y} ${width}x${height}]`;
}

function fail(element: string, detail: string): A11yFinding {
	return { kind: "state", element, detail };
}

/**
 * Judges the dump against the expectations. At the normal text size (`fontScale` up to 1) every expected node must be in the tree; at a larger
 * one a node that is not there is below the fold of the page and is not judged, while one that is there is judged all the same.
 */
export function judgeNodes(tree: UiTree, expectations: readonly NodeExpectation[], fontScale: number, direction: Direction = "ltr"): A11yFinding[] {
	const findings: A11yFinding[] = [];
	for (const wanted of expectations) {
		const node = tree.nodes.find((candidate) => candidate.resourceId === wanted.id);
		if (wanted.absent) {
			if (node) findings.push(fail(describe(node), `${wanted.id} must not be in the tree a service walks (hidden from it)`));
			const same = wanted.label === undefined ? undefined : tree.nodes.find((candidate) => spokenLabel(candidate).trim() === wanted.label || candidate.text.trim() === wanted.label);
			if (same) findings.push(fail(describe(same), `${JSON.stringify(wanted.label)} must not be in the tree a service walks (hidden from it)`));
			continue;
		}
		if (!node) {
			if (fontScale <= 1) findings.push(fail(wanted.id, "not in the tree a service walks"));
			continue;
		}
		const where = `${wanted.id} ${describe(node)}`;
		const differences: string[] = [];
		const compare = (name: string, actual: unknown, expected: unknown): void => {
			if (expected !== undefined && actual !== expected) differences.push(`${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
		};
		compare("class", node.className, wanted.className);
		compare("says", spokenLabel(node), wanted.says === undefined ? undefined : localize(wanted.says, direction));
		compare("checkable", node.checkable, wanted.checkable);
		compare("checked", node.checked, wanted.checked);
		compare("selected", node.selected, wanted.selected);
		compare("enabled", node.enabled, wanted.enabled);
		compare("clickable", node.clickable, wanted.clickable);
		compare("long-clickable", node.longClickable, wanted.longClickable);
		compare("focusable", node.focusable, wanted.focusable);
		compare("hint", node.hint, wanted.hint);
		if (differences.length > 0) findings.push(fail(where, differences.join("; ")));
	}
	return findings;
}

const marker = "[Svelte a11y] ";

/**
 * The node infos the lab logged in the last probe of a logcat dump: the `node {json}` lines before the last `done N` line (after the one
 * before it). Null when no probe finished. A line cut short by logcat, or one that is not JSON, is an error, never a smaller list.
 */
export function parseNodeInfo(logcat: string): NodeInfo[] | null {
	const lines = logcat.split("\n").filter((line) => line.includes(marker));
	let end = -1;
	for (let index = lines.length - 1; index >= 0; index--) {
		if ((lines[index] as string).includes(`${marker}done `)) {
			end = index;
			break;
		}
	}
	if (end < 0) return null;
	let start = 0;
	for (let index = end - 1; index >= 0; index--) {
		if ((lines[index] as string).includes(`${marker}done `)) {
			start = index + 1;
			break;
		}
	}
	const infos: NodeInfo[] = [];
	for (const line of lines.slice(start, end)) {
		const at = line.indexOf(`${marker}node `);
		if (at < 0) continue;
		infos.push(JSON.parse(line.slice(at + marker.length + "node ".length)) as NodeInfo);
	}
	const count = Number(/done (\d+)/.exec(lines[end] as string)?.[1] ?? "-1");
	if (count !== infos.length) throw new Error(`the lab logged ${count} nodes and ${infos.length} could be read`);
	return infos;
}

/** Judges what the app publishes against the expectations. A node the app did not publish is a finding; `infos` null (nothing was read) is one too. */
export function judgeNodeInfo(infos: readonly NodeInfo[] | null, expectations: readonly InfoExpectation[], direction: Direction = "ltr"): A11yFinding[] {
	if (infos === null) return [fail("the app's node info", "the lab did not log its nodes (no `[Svelte a11y] done` line)")];
	const findings: A11yFinding[] = [];
	for (const wanted of expectations) {
		const info = infos.find((candidate) => candidate.id === wanted.id);
		if (!info) {
			findings.push(fail(wanted.id, "the app published no node for it"));
			continue;
		}
		const differences: string[] = [];
		const compare = (name: string, actual: unknown, expected: unknown): void => {
			if (expected !== undefined && actual !== expected) differences.push(`${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
		};
		compare("class", info.class, wanted.className);
		compare("content description", info.desc, wanted.desc === undefined ? undefined : localize(wanted.desc, direction));
		compare("text", info.text, wanted.text);
		compare("tooltip", info.tooltip, wanted.tooltip);
		compare("state description", info.stateDescription, wanted.stateDescription ?? "");
		compare("hint text", info.hintText, wanted.hintText ?? "");
		compare("role description", info.roleDescription, wanted.roleDescription === undefined ? undefined : localize(wanted.roleDescription, direction));
		compare("heading", info.heading, wanted.heading);
		compare("checkable", info.checkable, wanted.checkable);
		compare("checked", info.checked, wanted.checked);
		compare("selected", info.selected, wanted.selected);
		compare("enabled", info.enabled, wanted.enabled);
		compare("clickable", info.clickable, wanted.clickable);
		compare("live region", info.liveRegion, wanted.liveRegion);
		compare("important for accessibility", info.important, wanted.important);
		if (wanted.range !== undefined) {
			const actual = info.range ?? null;
			if (JSON.stringify(actual) !== JSON.stringify(wanted.range)) differences.push(`range is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted.range)}`);
		}
		const customs = info.actions.filter((action) => action.id >= customActionStart);
		for (const action of wanted.actions ?? []) {
			const standard = standardActions[action.name];
			const found = standard === undefined ? customs.find((candidate) => candidate.label === action.label) : info.actions.find((candidate) => candidate.id === standard);
			if (!found) differences.push(`no action ${action.name}${standard === undefined ? ` labeled ${JSON.stringify(action.label)}` : ""}`);
			else if (found.label !== action.label) differences.push(`action ${action.name} is labeled ${JSON.stringify(found.label)}, expected ${JSON.stringify(action.label)}`);
		}
		const customWanted = (wanted.actions ?? []).filter((action) => standardActions[action.name] === undefined).length;
		if (wanted.actions !== undefined && customs.length !== customWanted) differences.push(`${customs.length} custom actions, expected ${customWanted}`);
		for (const name of wanted.without ?? []) {
			const id = standardActions[name];
			if (id !== undefined && info.actions.some((action) => action.id === id)) differences.push(`has the ${name} action`);
		}
		if (differences.length > 0) findings.push(fail(wanted.id, differences.join("; ")));
	}
	return findings;
}
