/**
 * Reading the recording the QA app makes of its gesture recognizers (`SvelteQAGestureTrace.swift`, started by the launch argument
 * `-SvelteQAGestureTrace YES`, read from `Documents/gesture-trace.json`) against the actions the XCUITest performed (`GESTURES-ACTION` lines carry the
 * phone's clock, as the rows do). For each action: when the touch came down, and for every recognizer that took part when it began, ended, was
 * cancelled or failed, relative to the touch down, with its pan translation at that moment; and what the navigation and a presented sheet were doing.
 * That is the evidence of the arbitration items of SPEC.md, "iOS contract" 3 and 4: how long a pan on a pushed screen waits for the edge swipe, and
 * which of a sheet's drag and a handler's pan moved first.
 */

export type TraceMeta = { id: number; class: string; delegate: string | null; view: string | null; handlerTag?: number | null; frame?: number[] };

/** `[t, id, state, touches, tx, ty, x?, y?]`: state is `UIGestureRecognizer.State`'s raw value. */
export type TraceRow = (number | null)[];

/** `[t, phase, x, y, hit]`: where a touch was, in window points, and the view the system hit-tested with its first ancestors (`Class#identifier < ...`). */
export type TraceTouch = [number, string, number, number, string];

/** `[t, id, state, vx?, vy?]`: a state change a recognizer's own target saw, with the pan's velocity (points per second) at that moment. */
export type TraceEvent = (number | null)[];

export type TraceFile = { startedMs?: number; meta: TraceMeta[]; rows: TraceRow[]; context: [number, string][]; touches?: TraceTouch[]; events?: TraceEvent[] };

export type TraceAction = { scenario: string; round: number; step: number; kind: string; beganMs: number; endedMs: number };

export type RecognizerStory = {
	id: number;
	class: string;
	delegate: string | null;
	handlerTag: number | null;
	/** The first frame with a touch on it, after the touch came down anywhere (ms). */
	downAfterMs: number | null;
	beganAfterMs: number | null;
	endedAfterMs: number | null;
	endedAs: "ended" | "cancelled" | "failed" | null;
	updates: number;
	translationAtBegan: [number, number] | null;
	/** The pan translation in the last frame before it began: a pan that began in the first frame its finger was past the threshold waited for nothing. */
	translationBeforeBegan: [number, number] | null;
	translationAtEnd: [number, number] | null;
	/** How the recognizer's own target saw it end: `ended` or `cancelled`, and the pan's velocity then (points per second). */
	terminal: { as: "ended" | "cancelled"; velocity: [number, number] | null } | null;
};

/** What UIKit's transition coordinator said about a navigation controller's transition in one sample. */
export type Transition = { interactive: boolean; cancelled: boolean; percent: number; velocity: number };

export type Context = { depth: number[]; transitioning: boolean; detent: string | null; y: number | null; visualY: number | null; transition: Transition | null };

export type StepStory = {
	action: TraceAction;
	/** The phone's clock when a touch first reached the window (the touch probe), else any recognizer. */
	touchDownMs: number | null;
	/** The first touch of the action: where it landed and what it hit; null when the app saw none. */
	firstTouch: { x: number; y: number; hit: string } | null;
	/** Touch events the window saw inside the action's window: began, moved, ended or cancelled. */
	touchEvents: Record<string, number>;
	recognizers: RecognizerStory[];
	contextAtStart: Context | null;
	contextAtEnd: Context | null;
	/** The farthest the presented sheet's view got from where it was at the start (points). */
	sheetTravel: number | null;
	/** The stack's transition after the touch: how far the finger had taken it when it let go, whether UIKit cancelled it, and the velocity UIKit finished it at. */
	pop: { percentAtRelease: number; cancelled: boolean; completionVelocity: number } | null;
};

const states = { began: 1, changed: 2, ended: 3, cancelled: 4, failed: 5 } as const;
/** The recording runs per frame: a touch is on screen from a little after the action starts (the test resolves the element first) until it ends. */
const before = 400;
const after = 1500;

function parseContext(text: string): Context | null {
	try {
		const value = JSON.parse(text) as { navigation?: { depth: number; transitioning: boolean; interactive?: boolean; cancelled?: boolean; percent?: number; velocity?: number }[]; sheet?: { detent: string | null; y?: number; visualY?: number } };
		const moving = (value.navigation ?? []).find((entry) => entry.transitioning && entry.percent !== undefined);
		return {
			depth: (value.navigation ?? []).map((entry) => entry.depth),
			transition: moving ? { interactive: moving.interactive === true, cancelled: moving.cancelled === true, percent: moving.percent ?? 0, velocity: moving.velocity ?? 0 } : null,
			transitioning: (value.navigation ?? []).some((entry) => entry.transitioning),
			detent: value.sheet?.detent ?? null,
			y: value.sheet?.y ?? null,
			visualY: value.sheet?.visualY ?? null,
		};
	} catch {
		return null;
	}
}

const pair = (x: number | null | undefined, y: number | null | undefined): [number, number] | null => (typeof x === "number" && typeof y === "number" ? [x, y] : null);

/** One story per action, from the rows inside the action's window. */
export function storiesFrom(trace: TraceFile, actions: readonly TraceAction[]): StepStory[] {
	const meta = new Map(trace.meta.map((entry) => [entry.id, entry]));
	const contexts = trace.context.map(([t, text]) => ({ t, value: parseContext(text) }));
	return actions.map((action) => {
		const from = action.beganMs - before;
		const to = action.endedMs + after;
		const rows = trace.rows.filter((row) => (row[0] as number) >= from && (row[0] as number) <= to);
		const seen = (trace.touches ?? []).filter((touch) => touch[0] >= from && touch[0] <= to);
		const began = seen.find((touch) => touch[1] === "began");
		const touchEvents: Record<string, number> = {};
		for (const touch of seen) touchEvents[touch[1]] = (touchEvents[touch[1]] ?? 0) + 1;
		const touchDown = began
			? began[0]
			: rows.reduce<number | null>((first, row) => ((row[3] as number) > 0 && (first === null || (row[0] as number) < first) ? (row[0] as number) : first), null);
		const byId = new Map<number, TraceRow[]>();
		for (const row of rows) byId.set(row[1] as number, [...(byId.get(row[1] as number) ?? []), row]);
		const recognizers: RecognizerStory[] = [];
		for (const [id, own] of byId) {
			const info = meta.get(id);
			if (!info) continue;
			const down = own.find((row) => (row[3] as number) > 0);
			if (!down) continue;
			const rel = (row: TraceRow | undefined): number | null => (row && touchDown !== null ? Math.round(((row[0] as number) - touchDown) * 10) / 10 : null);
			const began = own.find((row) => row[2] === states.began);
			const end = own.find((row) => (row[2] === states.ended || row[2] === states.cancelled || row[2] === states.failed) && (row[0] as number) >= (down[0] as number));
			const last = [...own].reverse().find((row) => row[4] !== null && row[4] !== undefined);
			const finish = (trace.events ?? []).find((event) => event[1] === id && (event[2] === states.ended || event[2] === states.cancelled) && (event[0] as number) >= from && (event[0] as number) <= to);
			recognizers.push({
				id,
				class: info.class,
				delegate: info.delegate,
				handlerTag: info.handlerTag ?? null,
				downAfterMs: rel(down),
				beganAfterMs: rel(began),
				endedAfterMs: rel(end),
				endedAs: end ? (end[2] === states.ended ? "ended" : end[2] === states.cancelled ? "cancelled" : "failed") : null,
				updates: own.filter((row) => row[2] === states.changed).length,
				translationAtBegan: began ? pair(began[4], began[5]) : null,
				translationBeforeBegan: began ? pair(...(own.filter((row) => (row[0] as number) < (began[0] as number)).at(-1)?.slice(4, 6) ?? [null, null]) as [number | null, number | null]) : null,
				translationAtEnd: last ? pair(last[4], last[5]) : null,
				terminal: finish ? { as: finish[2] === states.ended ? "ended" : "cancelled", velocity: pair(finish[3], finish[4]) } : null,
			});
		}
		recognizers.sort((a, b) => (a.beganAfterMs ?? Infinity) - (b.beganAfterMs ?? Infinity) || a.id - b.id);
		// What the finger did to the navigation and the sheet is between the first touch and a moment after the last one: the lab pops the page or dismisses the sheet after the step.
		const spanFrom = began ? began[0] - 100 : from;
		const spanTo = seen.length > 0 ? (seen.at(-1) as TraceTouch)[0] + 400 : to;
		const inside = contexts.filter((entry) => entry.t >= spanFrom && entry.t <= spanTo && entry.value);
		const atStart = contexts.filter((entry) => entry.t <= (began ? spanFrom : from + before) && entry.value).at(-1)?.value ?? inside[0]?.value ?? null;
		const atEnd = inside.at(-1)?.value ?? atStart;
		const start = atStart?.visualY ?? atStart?.y ?? null;
		const travel = start === null ? null : Math.max(0, ...inside.map((entry) => Math.abs((entry.value?.visualY ?? entry.value?.y ?? start) - start)));
		const lastTouchAt = seen.length > 0 ? (seen.at(-1) as TraceTouch)[0] : null;
		const afterRelease = contexts.filter((entry) => lastTouchAt !== null && entry.t >= spanFrom && entry.t <= lastTouchAt + 2000 && entry.value?.transition);
		const driven = afterRelease.filter((entry) => entry.value?.transition?.interactive && entry.t <= (lastTouchAt as number) + 60);
		const pop = afterRelease.length === 0 ? null : {
			percentAtRelease: driven.at(-1)?.value?.transition?.percent ?? 0,
			cancelled: afterRelease.some((entry) => entry.value?.transition?.cancelled),
			completionVelocity: afterRelease.at(-1)?.value?.transition?.velocity ?? 0,
		};
		return { action, touchDownMs: touchDown, pop, firstTouch: began ? { x: began[2], y: began[3], hit: began[4] } : null, touchEvents, recognizers, contextAtStart: atStart, contextAtEnd: atEnd, sheetTravel: travel === null ? null : Math.round(travel * 10) / 10 };
	});
}

const tag = (entry: RecognizerStory): string => `${entry.class}${entry.handlerTag !== null ? ` #${entry.handlerTag}` : ""}${entry.delegate ? ` (${entry.delegate})` : ""}`;
const at = (value: [number, number] | null): string => (value ? `(${value[0]}, ${value[1]})` : "-");

/** The lines the harness prints and keeps beside the run. */
export function describeStories(stories: readonly StepStory[]): string[] {
	const lines: string[] = [];
	for (const story of stories) {
		const { action } = story;
		const context = story.contextAtStart;
		const end = story.contextAtEnd;
		const depth = context && end ? `stack depth ${context.depth.join("/")}${end.depth.join("/") !== context.depth.join("/") ? ` -> ${end.depth.join("/")}` : ""}` : "no stack";
		const sheet = context?.detent !== null && context?.detent !== undefined ? `, sheet ${context.detent}${end && end.detent !== context.detent ? ` -> ${end.detent}` : ""}, travelled ${story.sheetTravel} pt` : "";
		lines.push(`${action.scenario} round ${action.round} step ${action.step + 1} (${action.kind}), touch down ${story.touchDownMs ?? "not seen"}; ${depth}${sheet}`);
		if (story.pop) lines.push(`    the stack's transition: ${Math.round(story.pop.percentAtRelease * 100)} % when the finger let go, ${story.pop.cancelled ? "CANCELLED" : "completed"} by UIKit, completion velocity ${story.pop.completionVelocity}`);
		if (story.firstTouch) lines.push(`    first touch at (${story.firstTouch.x}, ${story.firstTouch.y}) hit ${story.firstTouch.hit}; events ${Object.entries(story.touchEvents).map(([phase, count]) => `${phase} ${count}`).join(", ")}`);
		for (const entry of story.recognizers) {
			const began = entry.beganAfterMs === null ? "never began" : `began +${entry.beganAfterMs} ms at ${at(entry.translationAtBegan)} (the frame before: ${at(entry.translationBeforeBegan)})`;
			const done = (entry.endedAs ? `, ${entry.endedAs} +${entry.endedAfterMs} ms` : "") + (entry.terminal ? `, its target saw it ${entry.terminal.as}${entry.terminal.velocity ? ` at ${at(entry.terminal.velocity)} pt/s` : ""}` : "");
			lines.push(`    ${tag(entry)}: touch +${entry.downAfterMs} ms, ${began}${done}, ${entry.updates} updates, translation at the end ${at(entry.translationAtEnd)}`);
		}
	}
	return lines;
}
