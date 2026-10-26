import { adbOk } from "./adb.ts";
import { dumpUi, screenshot, tap, type DeviceSession, type Direction } from "./device.ts";
import { shellQuote } from "./exec.ts";
import { diffImages, type Image, type Rect } from "./png.ts";
import { selectorFor, type Selector, type ScreenCase, type Step } from "./screens.ts";
import { center, type UiNode, type UiTree } from "./uia.ts";
import { sleep } from "./wait.ts";

/** Whether a node answers to the selector: its text or content description equals the label, its class equals the class. */
export function matches(node: UiNode, selector: { label?: string; className?: string }): boolean {
	if (selector.className !== undefined && node.className !== selector.className) return false;
	if (selector.label === undefined) return true;
	return node.text.trim() === selector.label || node.contentDesc.trim() === selector.label;
}

/** The first node (in tree order) that answers to the selector and occupies some of the screen. */
export function findNode(tree: UiTree, selector: Selector, direction: Direction): UiNode | null {
	const wanted = selectorFor(selector, direction);
	return (
		tree.nodes.find(
			(node) => node.bounds.width > 0 && node.bounds.height > 0 && matches(node, wanted),
		) ?? null
	);
}

export function describeSelector(selector: Selector, direction: Direction): string {
	const wanted = selectorFor(selector, direction);
	return [wanted.className, wanted.label === undefined ? undefined : JSON.stringify(wanted.label)]
		.filter(Boolean)
		.join(" ");
}

/** Polls the accessibility tree until a node answers to the selector; returns that tree, or throws after the timeout. */
export async function waitForNode(
	serial: string,
	selector: Selector,
	direction: Direction,
	timeoutMs = 15_000,
): Promise<{ tree: UiTree; node: UiNode }> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const tree = await dumpUi(serial);
		const node = findNode(tree, selector, direction);
		if (node) return { tree, node };
		if (Date.now() >= deadline)
			throw new Error(
				`no node ${describeSelector(selector, direction)} on screen after ${timeoutMs} ms`,
			);
		await sleep(400);
	}
}

export type OpenedCase = { tree: UiTree };

/**
 * A fresh process on the case's screen: the network the case needs, then, in one adb call, the old process killed and the
 * deep link (or the launcher activity) opened, then the steps. Returns without waiting for the anchor.
 */
export async function launchCase(
	session: DeviceSession,
	screen: ScreenCase,
	direction: Direction,
): Promise<void> {
	const { serial, packageName } = session;
	await session.networkMode(screen.network);
	const start = screen.deepLink
		? `am start -W -a android.intent.action.VIEW -d ${shellQuote(screen.deepLink)} ${packageName}`
		: `am start -W -n ${packageName}/.MainActivity`;
	await adbOk(serial, ["shell", `am force-stop ${packageName}; sleep 0.3; ${start}`], {
		timeoutMs: 90_000,
	});
	for (const step of screen.steps) await runStep(serial, step, direction);
}

/** Launches the case and waits for its anchor; returns the accessibility tree that contains the anchor. */
export async function openCase(
	session: DeviceSession,
	screen: ScreenCase,
	direction: Direction,
): Promise<OpenedCase> {
	await launchCase(session, screen, direction);
	const { tree } = await waitForNode(
		session.serial,
		screen.anchor,
		direction,
		screen.needsBackend ? 25_000 : 15_000,
	);
	return { tree };
}

async function runStep(serial: string, step: Step, direction: Direction): Promise<void> {
	if ("pause" in step) {
		await sleep(step.pause);
	} else if ("wait" in step) {
		await waitForNode(serial, step.wait, direction, step.timeoutMs);
	} else {
		const { node } = await waitForNode(serial, step.tap, direction);
		const { x, y } = center(node);
		await tap(serial, x, y);
	}
}

/** The rectangles of the nodes a case masks (spinners), from the tree on screen. */
export function maskRects(tree: UiTree, screen: ScreenCase, direction: Direction): Rect[] {
	const rects: Rect[] = [];
	for (const selector of screen.masks) {
		const wanted = selectorFor(selector, direction);
		const found = tree.nodes.filter(
			(node) => node.bounds.width > 0 && node.bounds.height > 0 && matches(node, wanted),
		);
		// A mask that matches nothing would freeze a reference with the moving node unmasked: refuse instead.
		if (found.length === 0)
			throw new Error(
				`${screen.id}: the mask ${describeSelector(selector, direction)} matches no node`,
			);
		rects.push(...found.map((node) => node.bounds));
	}
	for (const selector of screen.masksWhenShown) {
		const wanted = selectorFor(selector, direction);
		for (const node of tree.nodes)
			if (node.bounds.width > 0 && node.bounds.height > 0 && matches(node, wanted))
				rects.push(node.bounds);
	}
	return rects;
}

/**
 * Screenshots until two in a row are identical outside the masks, so a screen still animating (a transition, a fade, an
 * image loading) is not frozen into a reference mid-motion. `stable` is false when it never settled.
 */
export async function settledScreenshot(
	serial: string,
	masks: Rect[],
	maxAttempts = 14,
): Promise<{ image: Image; stable: boolean; attempts: number }> {
	let previous = await screenshot(serial);
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		await sleep(350);
		const next = await screenshot(serial);
		const same = diffImages(previous, next, masks).differing === 0;
		previous = next;
		if (same) return { image: next, stable: true, attempts: attempt };
	}
	return { image: previous, stable: false, attempts: maxAttempts };
}

function signature(tree: UiTree): string {
	return tree.nodes
		.map(
			(node) =>
				`${node.className}|${node.text}|${node.contentDesc}|${node.bounds.x},${node.bounds.y},${node.bounds.width},${node.bounds.height}|${node.clickable}${node.focusable}${node.enabled}`,
		)
		.join("\n");
}

/** Dumps again until two dumps in a row are the same tree, so a header still populating is not read half built. */
export async function settledTree(
	serial: string,
	first: UiTree,
	maxDumps = 6,
): Promise<{ tree: UiTree; stable: boolean }> {
	let previous = first;
	for (let dump = 1; dump <= maxDumps; dump++) {
		await sleep(300);
		const next = await dumpUi(serial);
		const same = signature(previous) === signature(next);
		previous = next;
		if (same) return { tree: next, stable: true };
	}
	return { tree: previous, stable: false };
}
