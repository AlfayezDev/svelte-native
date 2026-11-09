import {
	DeviceStateError,
	DumpError,
	dumpUi,
	endsRun,
	screenshot,
	tap,
	type DeviceSession,
	type Direction,
} from "./device.ts";
import { amStartCommand } from "./adb.ts";
import { accountEmail, placeholder } from "./qa-account.ts";
import { diffImages, type Image, type Rect } from "./png.ts";
import { localize, selectorFor, type Selector, type ScreenCase, type Step } from "./screens.ts";
import { center, type UiNode, type UiTree } from "./uia.ts";
import { sleep } from "./wait.ts";

/**
 * Whether a node answers to the selector: its text or content description equals the label, its class equals the class. The
 * `account` selector is the node that shows the QA account's address; with no account configured it matches nothing.
 */
export function matches(node: UiNode, selector: { label?: string; className?: string; account?: "email"; resourceId?: string }): boolean {
	if (selector.className !== undefined && node.className !== selector.className) return false;
	if (selector.resourceId !== undefined && node.resourceId !== selector.resourceId) return false;
	if (selector.account === "email") {
		const email = accountEmail();
		if (email === null || (node.text.trim().toLowerCase() !== email && node.contentDesc.trim().toLowerCase() !== email)) return false;
	}
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

/**
 * The visible nodes of the tree that show the QA account's address and that no rectangle covers: a signed-in screen is only frozen
 * into a reference when this is empty, because the reference keeps the pixels outside the masks.
 */
export function exposedAccount(tree: UiTree, masks: Rect[]): UiNode[] {
	const email = accountEmail();
	if (email === null) return [];
	return tree.nodes.filter((node) => {
		if (node.bounds.width <= 0 || node.bounds.height <= 0) return false;
		if (!`${node.text}\n${node.contentDesc}`.toLowerCase().includes(email)) return false;
		return !masks.some(
			(mask) =>
				mask.x <= node.bounds.x &&
				mask.y <= node.bounds.y &&
				mask.x + mask.width >= node.bounds.x + node.bounds.width &&
				mask.y + mask.height >= node.bounds.y + node.bounds.height,
		);
	});
}

/**
 * The labels of the screen's own chrome that a mask covers: its title, its declared controls and the controls further down (the tab strip of the account modal is among
 * them), found in the tree on screen. A mask is there for a node that moves (the address, the photo); one over a control hides what the comparison is for, as a mask the
 * covered screen's address left at the height of the modal's tab strip did. Rectangles that only touch do not cover.
 *
 * A control that is inside a masked node is not covered by the mask but carried by it: its parent, or any node above it, lies wholly within the mask, so it moves with the
 * node the mask is for (the Reanimated test square holds the "Animated touch target" that is its whole surface). The mask is on the node that moves, and the control cannot
 * be compared without it.
 */
export function maskedChrome(tree: UiTree, screen: ScreenCase, direction: Direction, masks: Rect[]): string[] {
	const labels = [...(screen.title === null ? [] : [screen.title]), ...screen.controls, ...screen.scrolled].map((label) => localize(label, direction));
	const covers = (mask: Rect, node: Rect) => mask.x < node.x + node.width && node.x < mask.x + mask.width && mask.y < node.y + node.height && node.y < mask.y + mask.height;
	const within = (inner: Rect, outer: Rect) => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
	const carried = (node: UiNode, mask: Rect) => {
		for (let above = node.parent; above !== null; above = above.parent) if (above.bounds.width > 0 && above.bounds.height > 0 && within(above.bounds, mask)) return true;
		return false;
	};
	const found = new Set<string>();
	for (const node of tree.nodes) {
		if (node.bounds.width <= 0 || node.bounds.height <= 0) continue;
		const label = labels.find((candidate) => node.text.trim() === candidate || node.contentDesc.trim() === candidate);
		if (label !== undefined && masks.some((mask) => covers(mask, node.bounds) && !carried(node, mask))) found.add(label);
	}
	return [...found];
}

/** The rectangles of every node that shows the QA account's address anywhere in its text or description, whether a mask covers it or not. */
export function accountRects(tree: UiTree): Rect[] {
	const email = accountEmail();
	if (email === null) return [];
	return tree.nodes
		.filter((node) => node.bounds.width > 0 && node.bounds.height > 0 && `${node.text}\n${node.contentDesc}`.toLowerCase().includes(email))
		.map((node) => node.bounds);
}

export function describeSelector(selector: Selector, direction: Direction): string {
	const wanted = selectorFor(selector, direction);
	return [
		wanted.className,
		wanted.resourceId === undefined ? undefined : `#${wanted.resourceId}`,
		wanted.label === undefined ? undefined : JSON.stringify(wanted.label),
		wanted.account === undefined ? undefined : `the QA account's ${wanted.account} (${placeholder})`,
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * What a wait for the screen saw before it gave up: the last tree it read (null when it never read one), how many dumps that took and how long
 * it really ran (`waitForNode`'s timeout is checked between dumps, and one dump can take far longer than the timeout). A failed case keeps it as evidence.
 */
export type Observation = { tree: UiTree | null; dumps: number; elapsedMs: number };

/** A failure of a case that carries what the device showed at the time (`Observation`), so the evidence of the failed attempt does not have to dump again. */
export class ObservedError extends Error {
	readonly observation: Observation | null;
	constructor(message: string, observation: Observation | null = null, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "ObservedError";
		this.observation = observation;
	}
}

/**
 * Whether a failure is the screen not showing up in a wait or a dump: a node that never came, a dump that held less than the screen's own controls, a
 * dump that could not be read. These are the failures a second launch may cure (a slow start, the first dump after an emulator restart); any other
 * error (a reference that is not there, a bug of the harness) fails the same way again and is not retried.
 */
export function isWaitFailure(error: unknown): boolean {
	return error instanceof ObservedError || error instanceof DumpError;
}

/** No node answered to the selector in time: the screen is not the one the case means, or the device is not in the state it needs (`assertDeviceState`). */
export class NodeNotFoundError extends ObservedError {
	constructor(message: string, observation: Observation | null = null) {
		super(message, observation);
		this.name = "NodeNotFoundError";
	}
}

/** Polls the accessibility tree until a node answers to the selector; returns that tree, or throws after the timeout. */
export async function waitForNode(
	serial: string,
	selector: Selector,
	direction: Direction,
	timeoutMs = 15_000,
): Promise<{ tree: UiTree; node: UiNode }> {
	const started = Date.now();
	const deadline = started + timeoutMs;
	let last: UiTree | null = null;
	let dumps = 0;
	const seen = (): Observation => ({ tree: last, dumps, elapsedMs: Date.now() - started });
	for (;;) {
		let tree: UiTree;
		try {
			tree = await dumpUi(serial);
		} catch (error) {
			// A dump that fails after earlier ones were read keeps the last tree it read (same message, so `deviceGone` and the like still see it).
			if (last !== null && error instanceof Error) throw new ObservedError(error.message, seen(), error);
			throw error;
		}
		last = tree;
		dumps++;
		const node = findNode(tree, selector, direction);
		if (node) return { tree, node };
		if (Date.now() >= deadline)
			throw new NodeNotFoundError(
				`no node ${describeSelector(selector, direction)} on screen after ${timeoutMs} ms`,
				seen(),
			);
		await sleep(400);
	}
}

/**
 * A case on the normal network did not show its anchor: before blaming the screen, ask the device once whether it is in the state
 * the case needs (no proxy, the variant's text size). A proxy or text size left behind by a run that did not restore makes the
 * app show its startup error and every case after this one fail the same way, so that is a `DeviceStateError`, which stops the run
 * (the suite restores the device, records the cause as `aborted` and prints it). Cases on the failing proxies are not asked.
 */
export async function assertDeviceState(
	session: DeviceSession,
	screen: ScreenCase,
	fontScale: number,
): Promise<void> {
	if (screen.network !== "normal") return;
	const problems = await session.stateProblems(fontScale);
	if (problems.length > 0)
		throw new DeviceStateError(
			`the device is not in the state the case needs: ${problems.join(", ")} (case ${screen.id}, which did not show its anchor)`,
		);
}

/** `assertDeviceState` for a failed case, when the failure is that its anchor was not on screen; any other failure is left to the caller. */
export async function guardAnchorFailure(
	session: DeviceSession,
	screen: ScreenCase,
	fontScale: number,
	error: unknown,
): Promise<void> {
	if (error instanceof NodeNotFoundError) await assertDeviceState(session, screen, fontScale);
}

/**
 * Runs `attempt` for a case, and once more when it fails for a reason that is not the device going away or being in the wrong
 * state: the first dump after the emulator was restarted can come back empty while its UI is still starting, and a slow screen
 * can miss its anchor once. An anchor that is missing is first checked against the device (`guardAnchorFailure`), so a left-behind
 * proxy or text size stops the run instead of being retried and recorded for every case. `onFailure` is awaited with the error of each failed try that does
 * not end the run, the first one before the retry launches the case again (`lib/evidence.ts` photographs the screen there). `retryable` says which failures
 * get the retry (`isWaitFailure`); a failure it refuses is thrown at once, with no `onFailure`.
 */
export async function retryCase<T>(
	session: DeviceSession,
	screen: ScreenCase,
	fontScale: number,
	label: string,
	attempt: () => Promise<T>,
	log: (message: string) => void = console.log,
	onFailure?: (error: unknown) => Promise<void>,
	retryable?: (error: unknown) => boolean,
): Promise<T> {
	try {
		return await session.guarded(attempt, log);
	} catch (error) {
		if (endsRun(error)) throw error;
		// `retryable` narrows the retry to the failures a second launch may cure (default: every failure that does not end the run).
		if (retryable !== undefined && !retryable(error)) throw error;
		// Before the retry launches the case again: the screen the first attempt failed on is still there to be looked at.
		await onFailure?.(error);
		await guardAnchorFailure(session, screen, fontScale, error);
		log(`  retrying ${label}: ${error instanceof Error ? error.message.slice(0, 100) : String(error)}`);
		try {
			return await session.guarded(attempt, log);
		} catch (second) {
			if (!endsRun(second)) await onFailure?.(second);
			throw second;
		}
	}
}

export type OpenedCase = { tree: UiTree };

/**
 * A fresh process on the case's screen: the network the case needs, then, in one adb call, the old process killed and the
 * deep link (or the launcher activity) opened, then the steps. Returns without waiting for the anchor.
 */
export function launchCase(
	session: DeviceSession,
	screen: ScreenCase,
	direction: Direction,
): Promise<void> {
	return session.guarded(() => launchOnce(session, screen, direction));
}

async function launchOnce(
	session: DeviceSession,
	screen: ScreenCase,
	direction: Direction,
): Promise<void> {
	const { serial, packageName } = session;
	// Before the app is launched: a device whose proxy is not the case's would show a screen the case does not mean.
	await session.networkMode(screen.network);
	const start = amStartCommand(packageName, screen.deepLink);
	await session.run(serial, ["shell", `am force-stop ${packageName}; sleep 0.3; ${start}`], {
		timeoutMs: 90_000,
	});
	for (const step of screen.steps) await runStep(session, step, direction);
}

/** Launches the case and waits for its anchor; returns the accessibility tree that contains the anchor. */
export async function openCase(
	session: DeviceSession,
	screen: ScreenCase,
	direction: Direction,
): Promise<OpenedCase> {
	return session.guarded(async () => {
		await launchOnce(session, screen, direction);
		const { tree } = await waitForNode(
			session.serial,
			screen.anchor,
			direction,
			screen.needsBackend ? 25_000 : 15_000,
		);
		return { tree };
	});
}

async function runStep(session: DeviceSession, step: Step, direction: Direction): Promise<void> {
	const { serial, packageName } = session;
	if ("pause" in step) {
		await sleep(step.pause);
	} else if ("open" in step) {
		// The activity is not stopped: the running app is told of the link (`singleTask`) and its router goes to it like any later link.
		await session.run(
			serial,
			["shell", amStartCommand(packageName, step.open)],
			{ timeoutMs: 90_000 },
		);
	} else if ("scrollToEnd" in step) {
		// Two swipes of most of the screen's height, 400 ms each: the page ends under the second whatever its length.
		for (let swipe = 0; swipe < 2; swipe++) {
			await session.run(serial, ["shell", "input", "swipe", "540", "2000", "540", "500", "400"]);
			await sleep(500);
		}
	} else if ("wait" in step) {
		await waitForNode(serial, step.wait, direction, step.timeoutMs);
	} else {
		const { node } = await waitForNode(serial, step.tap, direction);
		const { x, y } = center(node);
		await tap(serial, x, y);
	}
}

/**
 * Whether the node is on screen and not under a sheet or modal: `visible` is the tree a service walks (it leaves the covered screen out), absent for a
 * screen with nothing over it. The plain tree lists the covered screen's views, whose rectangles would mask the modal's own content.
 */
function onScreen(node: UiNode, visible: UiTree | undefined): boolean {
	if (visible === undefined) return true;
	const { x, y, width, height } = node.bounds;
	return visible.nodes.some((other) => other.text === node.text && other.contentDesc === node.contentDesc && other.bounds.x === x && other.bounds.y === y && other.bounds.width === width && other.bounds.height === height);
}

/** The rectangles of the nodes a case masks (spinners), from the tree on screen. */
export function maskRects(tree: UiTree, screen: ScreenCase, direction: Direction, visible?: UiTree): Rect[] {
	const rects: Rect[] = [];
	for (const selector of screen.masks) {
		const wanted = selectorFor(selector, direction);
		const found = tree.nodes.filter(
			(node) => node.bounds.width > 0 && node.bounds.height > 0 && matches(node, wanted) && (selector.account === undefined || onScreen(node, visible)),
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

/**
 * The dump a service that skips the not-important views reads (`--compressed`, the tree every accessibility check judges),
 * taken until it holds the screen's own controls: one taken while the screen is still drawing lacks them, and the screen would
 * be judged on a half-built tree. Throws after `attempts` dumps without them, which the suite records as an error for the screen.
 */
export async function dumpWithOwnControls(
	dump: () => Promise<UiTree>,
	own: string[],
	attempts = 3,
	pauseMs = 400,
): Promise<UiTree> {
	let missing = own;
	const started = Date.now();
	let last: UiTree | null = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const tree = await dump();
		last = tree;
		missing = own.filter(
			(label) =>
				!tree.nodes.some(
					(node) => node.bounds.width > 0 && node.bounds.height > 0 && matches(node, { label }),
				),
		);
		if (missing.length === 0) return tree;
		if (attempt < attempts) await sleep(pauseMs);
	}
	throw new ObservedError(
		`the important-views dump lacks ${missing.map((label) => JSON.stringify(label)).join(", ")} of the screen itself after ${attempts} dumps`,
		{ tree: last, dumps: attempts, elapsedMs: Date.now() - started },
	);
}

/**
 * Dumps again until two dumps in a row are the same tree, so a header still populating is not read half built. `important`
 * takes the dumps a service walks (`--compressed`); `first` must be a dump of the same kind.
 */
export async function settledTree(
	serial: string,
	first: UiTree,
	maxDumps = 6,
	options: { important?: boolean } = {},
): Promise<{ tree: UiTree; stable: boolean }> {
	let previous = first;
	for (let dump = 1; dump <= maxDumps; dump++) {
		await sleep(300);
		const next = await dumpUi(serial, options);
		const same = signature(previous) === signature(next);
		previous = next;
		if (same) return { tree: next, stable: true };
	}
	return { tree: previous, stable: false };
}
