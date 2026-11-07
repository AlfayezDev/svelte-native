import type { Rect } from "./png.ts";

/** One `<node>` of a `uiautomator dump`: the accessibility node info of a view, as a service sees it. */
export type UiNode = {
	/** Position in a pre-order walk: the order a screen reader's linear navigation visits nodes. */
	order: number;
	depth: number;
	text: string;
	hint: string;
	contentDesc: string;
	resourceId: string;
	className: string;
	packageName: string;
	checkable: boolean;
	checked: boolean;
	clickable: boolean;
	longClickable: boolean;
	enabled: boolean;
	focusable: boolean;
	focused: boolean;
	scrollable: boolean;
	selected: boolean;
	password: boolean;
	bounds: Rect;
	parent: UiNode | null;
	children: UiNode[];
};

export type UiTree = {
	rotation: number;
	root: UiNode | null;
	/** Every node in pre-order. */
	nodes: UiNode[];
	/** The XML the tree was parsed from, when a device gave it (`dumpUi`): a failed case keeps it as evidence. Absent for a tree parsed from a sample. */
	raw?: string;
};

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
		if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
		if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
		return entities[body] ?? whole;
	});
}

function attributes(source: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
		const [, name, value] = match;
		if (name !== undefined && value !== undefined) found.set(name, unescapeXml(value));
	}
	return found;
}

function parseBounds(value: string | undefined): Rect {
	const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? "");
	if (!match) return { x: 0, y: 0, width: 0, height: 0 };
	const [left, top, right, bottom] = match.slice(1).map(Number) as [number, number, number, number];
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Parses the XML of `uiautomator dump`. The format is flat enough (`<hierarchy rotation>` around nested `<node .../>`
 * elements with only attributes) that a tag scanner is exact; anything else is an error, never a partial tree.
 */
export function parseHierarchy(xml: string): UiTree {
	const tags = xml.matchAll(/<(\/?)(hierarchy|node)\b((?:[^>"]|"[^"]*")*?)(\/?)>/g);
	const nodes: UiNode[] = [];
	const stack: UiNode[] = [];
	let root: UiNode | null = null;
	let rotation = 0;
	let sawHierarchy = false;
	for (const tag of tags) {
		const [, closing, name, body, selfClosing] = tag;
		if (name === "hierarchy") {
			if (closing === "") {
				sawHierarchy = true;
				rotation = Number(attributes(body ?? "").get("rotation") ?? 0);
			}
			continue;
		}
		if (closing === "/") {
			if (stack.length === 0) throw new Error("uiautomator dump: unbalanced </node>");
			stack.pop();
			continue;
		}
		const attr = attributes(body ?? "");
		const flag = (key: string) => attr.get(key) === "true";
		const parent = stack[stack.length - 1] ?? null;
		const node: UiNode = {
			order: nodes.length,
			depth: stack.length,
			text: attr.get("text") ?? "",
			hint: attr.get("hint") ?? "",
			contentDesc: attr.get("content-desc") ?? "",
			resourceId: attr.get("resource-id") ?? "",
			className: attr.get("class") ?? "",
			packageName: attr.get("package") ?? "",
			checkable: flag("checkable"),
			checked: flag("checked"),
			clickable: flag("clickable"),
			longClickable: flag("long-clickable"),
			enabled: attr.get("enabled") !== "false",
			focusable: flag("focusable"),
			focused: flag("focused"),
			scrollable: flag("scrollable"),
			selected: flag("selected"),
			password: flag("password"),
			bounds: parseBounds(attr.get("bounds")),
			parent,
			children: [],
		};
		nodes.push(node);
		if (parent) parent.children.push(node);
		else if (!root) root = node;
		if (selfClosing !== "/") stack.push(node);
	}
	if (!sawHierarchy) throw new Error("uiautomator dump has no <hierarchy> element");
	if (stack.length !== 0) throw new Error("uiautomator dump: a <node> is never closed");
	return { rotation, root, nodes };
}

export const bottom = (rect: Rect): number => rect.y + rect.height;
export const right = (rect: Rect): number => rect.x + rect.width;

/** What the node says to a user: its text, else its content description, else its hint. */
export function spokenLabel(node: UiNode): string {
	return node.text || node.contentDesc || node.hint;
}

export function descendants(node: UiNode): UiNode[] {
	const found: UiNode[] = [];
	const walk = (current: UiNode) => {
		for (const child of current.children) {
			found.push(child);
			walk(child);
		}
	};
	walk(node);
	return found;
}

/** Nodes whose text or content description equals `value` (case-sensitive, trimmed). */
export function findByLabel(tree: UiTree, value: string): UiNode[] {
	return tree.nodes.filter(
		(node) => node.text.trim() === value || node.contentDesc.trim() === value,
	);
}

/** The centre of a node, in pixels, for `input tap`. */
export function center(node: UiNode): { x: number; y: number } {
	return {
		x: Math.round(node.bounds.x + node.bounds.width / 2),
		y: Math.round(node.bounds.y + node.bounds.height / 2),
	};
}
