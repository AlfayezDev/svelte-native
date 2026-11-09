import { describe, expect, test } from "bun:test";
import { isLabPath, labOnly, launchKind } from "../../src/lib/native/dev/launch-link.ts";
import { createRetrier, isForeground, retryDelay, steadyDelay, type Foreground } from "../../src/lib/native/startup.ts";

/**
 * How the app starts and tries again when its start fails (src/routes/+layout.mobile.svelte, src/lib/native/startup.ts): the start reads the lab
 * link the app was launched with and loads the fonts, and a failed attempt is made again by itself. The loop is driven here with a clock and a
 * foreground of its own.
 */

describe("the retry schedule", () => {
	test("1 s, 2 s, 4 s, 8 s after the first four failures, then every 15 s", () => {
		expect([1, 2, 3, 4, 5, 6, 50].map(retryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
		expect(steadyDelay).toBe(15_000);
	});
	test("a count below one starts the schedule", () => {
		expect(retryDelay(0)).toBe(1_000);
		expect(retryDelay(-3)).toBe(1_000);
	});
});

/** A clock whose waits run when the test says so, and a foreground that the test turns. */
function world(initiallyActive = true) {
	let now = 0;
	let active = initiallyActive;
	const waits = new Map<number, { at: number; callback: () => void }>();
	let nextWait = 0;
	const listeners = new Set<(active: boolean) => void>();
	const foreground: Foreground = {
		active: () => active,
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	};
	return {
		foreground,
		listeners,
		/** The delays of the waits that are pending. */
		pending: () => [...waits.values()].map((wait) => wait.at - now),
		schedule(callback: () => void, ms: number) {
			const id = nextWait++;
			waits.set(id, { at: now + ms, callback });
			return () => { waits.delete(id); };
		},
		/** Moves the clock and runs the waits that fall due, in order. */
		async advance(ms: number) {
			const until = now + ms;
			for (;;) {
				const due = [...waits.entries()].filter(([, wait]) => wait.at <= until).toSorted(([, a], [, b]) => a.at - b.at)[0];
				if (!due) break;
				waits.delete(due[0]);
				now = due[1].at;
				due[1].callback();
				await settle();
			}
			now = until;
		},
		async setActive(next: boolean) {
			active = next;
			for (const listener of [...listeners]) listener(next);
			await settle();
		},
	};
}
const settle = async () => { for (let turn = 0; turn < 6; turn++) await Promise.resolve(); };

/** An attempt that fails until `failUntil` attempts have been made, and records when it ran and whether it was aborted. */
function attempts(failUntil: number) {
	const log: { signal: AbortSignal }[] = [];
	return {
		log,
		failures: [] as number[],
		async attempt(signal: AbortSignal) {
			log.push({ signal });
			if (log.length <= failUntil) throw new Error(`attempt ${log.length} failed`);
		},
	};
}

describe("trying again by itself", () => {
	test("each failure waits as long as the schedule says, and the first success ends it", async () => {
		const clock = world();
		const run = attempts(5);
		const retrier = createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule });
		retrier.start();
		await settle();
		expect(run.log).toHaveLength(1);
		expect(clock.pending()).toEqual([1_000]);
		for (const [waited, count] of [[1_000, 2], [2_000, 3], [4_000, 4], [8_000, 5], [15_000, 6]] as const) {
			await clock.advance(waited - 1);
			expect(run.log).toHaveLength(count - 1);
			await clock.advance(1);
			expect(run.log).toHaveLength(count);
		}
		// The sixth attempt succeeded: nothing is waiting, and the foreground is no longer watched.
		expect(run.failures).toEqual([1, 2, 3, 4, 5]);
		expect(clock.pending()).toEqual([]);
		expect(clock.listeners.size).toBe(0);
		await clock.advance(60_000);
		expect(run.log).toHaveLength(6);
	});

	test("it never gives up: the pace stays at 15 s", async () => {
		const clock = world();
		const run = attempts(Infinity);
		createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule }).start();
		await settle();
		await clock.advance(1_000 + 2_000 + 4_000 + 8_000);
		expect(run.log).toHaveLength(5);
		await clock.advance(15_000 * 4);
		expect(run.log).toHaveLength(9);
		expect(run.failures.at(-1)).toBe(9);
		expect(clock.pending()).toEqual([15_000]);
	});

	test("the Retry button tries at once, abandons an attempt under way, and starts the schedule over", async () => {
		const clock = world();
		const run = attempts(Infinity);
		const retrier = createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule });
		retrier.start();
		await settle();
		await clock.advance(1_000 + 2_000 + 4_000);
		expect(run.failures).toEqual([1, 2, 3, 4]);
		expect(clock.pending()).toEqual([8_000]);
		retrier.retryNow();
		await settle();
		expect(run.log).toHaveLength(5);
		expect(run.failures.at(-1)).toBe(1); // the count started over: the wait is the first one again
		expect(clock.pending()).toEqual([1_000]);

		// An attempt that is still under way when Retry is pressed is aborted, and its outcome is nobody's.
		let release: () => void = () => {};
		const slowSignals: AbortSignal[] = [];
		const failed: number[] = [];
		const slow = createRetrier({
			attempt: (signal) => { slowSignals.push(signal); return new Promise<void>((_resolve, reject) => { release = () => { reject(new Error("late")); }; }); },
			onFailure: (_cause, failures) => { failed.push(failures); },
			foreground: clock.foreground,
			schedule: clock.schedule,
		});
		slow.start();
		await settle();
		const firstRelease = release;
		slow.retryNow();
		await settle();
		expect(slowSignals.map((signal) => signal.aborted)).toEqual([true, false]);
		firstRelease(); // the abandoned attempt fails after all
		await settle();
		expect(failed).toEqual([]); // not counted, nothing scheduled by it
		slow.stop();
		expect(slowSignals[1]?.aborted).toBe(true);
	});

	test("it waits while the app is in the background and tries at once, from the first delay, when it comes back", async () => {
		const clock = world();
		const run = attempts(Infinity);
		createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule }).start();
		await settle();
		await clock.advance(1_000 + 2_000);
		expect(run.failures).toEqual([1, 2, 3]);
		expect(clock.pending()).toEqual([4_000]);

		await clock.setActive(false);
		expect(clock.pending()).toEqual([]); // the wait that was running is cancelled
		await clock.advance(10 * 60_000);
		expect(run.log).toHaveLength(3); // ten minutes in the background: no request

		await clock.setActive(true);
		expect(run.log).toHaveLength(4); // back: at once
		expect(run.failures.at(-1)).toBe(4); // the failures are still the same streak (the caller logs the first one loudly, once)
		expect(clock.pending()).toEqual([1_000]); // and the waits are the first of the schedule again
	});

	test("only active is the foreground: iOS's inactive (Control Center, a system dialog) pauses the waits too, and coming back resumes without a new streak", async () => {
		const clock = world();
		const run = attempts(Infinity);
		createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule }).start();
		await settle();
		await clock.advance(1_000 + 2_000);
		expect(run.failures).toEqual([1, 2, 3]);
		expect(clock.pending()).toEqual([4_000]);
		// The shell maps AppState to this: `inactive` and `background` are both "not active", `active` is the only way back.
		await clock.setActive(false);
		expect(clock.pending()).toEqual([]);
		await clock.advance(60_000);
		expect(run.log).toHaveLength(3);
		await clock.setActive(true);
		expect(run.log).toHaveLength(4);
		expect(run.failures.at(-1)).toBe(4); // not 1: the console.error rule is not armed again by a phone that is picked up
		await clock.setActive(false);
		await clock.setActive(true);
		await clock.setActive(false);
		await clock.setActive(true);
		expect(run.failures.slice(-1)[0]).toBeGreaterThan(4);
		expect(run.failures.filter((count) => count === 1)).toHaveLength(1);
	});

	test("the Retry button is what starts the streak over", async () => {
		const clock = world();
		const run = attempts(Infinity);
		const retrier = createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule });
		retrier.start();
		await settle();
		await clock.advance(1_000);
		expect(run.failures).toEqual([1, 2]);
		retrier.retryNow();
		await settle();
		expect(run.failures).toEqual([1, 2, 1]);
	});

	test("an attempt that fails in the background schedules nothing until the app is back", async () => {
		const clock = world();
		let fail: (cause: Error) => void = () => {};
		const failures: number[] = [];
		const retrier = createRetrier({
			attempt: () => new Promise<void>((_resolve, reject) => { fail = reject; }),
			onFailure: (_cause, count) => { failures.push(count); },
			foreground: clock.foreground,
			schedule: clock.schedule,
		});
		retrier.start();
		await settle();
		await clock.setActive(false);
		fail(new Error("the request ended in the background"));
		await settle();
		expect(failures).toEqual([1]);
		expect(clock.pending()).toEqual([]);
		await clock.setActive(true);
		expect(clock.pending()).toEqual([]); // the new attempt is under way, and fails only when `fail` says
		retrier.stop();
	});

	test("an app that starts in the background makes its first attempt, and waits after it fails", async () => {
		const clock = world(false);
		const run = attempts(Infinity);
		createRetrier({ attempt: run.attempt, onFailure: (_cause, failures) => { run.failures.push(failures); }, foreground: clock.foreground, schedule: clock.schedule }).start();
		await settle();
		expect(run.log).toHaveLength(1);
		expect(clock.pending()).toEqual([]);
	});

	test("stop() ends the attempt under way and every wait", async () => {
		const clock = world();
		const run = attempts(Infinity);
		const retrier = createRetrier({ attempt: run.attempt, onFailure: () => {}, foreground: clock.foreground, schedule: clock.schedule });
		retrier.start();
		await settle();
		expect(clock.pending()).toEqual([1_000]);
		retrier.stop();
		expect(clock.pending()).toEqual([]);
		expect(clock.listeners.size).toBe(0);
		await clock.advance(60_000);
		retrier.retryNow(); // nothing to retry for
		await settle();
		expect(run.log).toHaveLength(1);
	});
});

describe("what the launch link says about the first screen", () => {
	test("the links the QA harness and the lab itself open are the lab's", () => {
		for (const url of ["example-svelte:///__dev", "example-svelte:///__dev/screens?mode=menu", "example-svelte://__dev/tree/home", "example-svelte-smoke:///__dev/smoke", "example-svelte:///__dev?probe=1", "https://example.test/__dev"]) {
			expect([url, launchKind(url)]).toEqual([url, "lab"]);
		}
	});
	test("a link to anything else is another launch: the product's", () => {
		for (const url of ["example-svelte:///workspaces", "example-svelte:///auth/login", "example-svelte:///acme/home", "example://acme/settings", "example-svelte:///__devices", "exp+example://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"]) {
			expect([url, launchKind(url)]).toEqual([url, "other"]);
		}
	});
	test("no link is none: the launcher's icon, or a restart that restored its screens", () => {
		expect([launchKind(null), launchKind(undefined), launchKind("")]).toEqual(["none", "none", "none"]);
	});
	test("the router's path is the lab's under /__dev only", () => {
		expect(["/__dev", "/__dev/screens", "/__dev/tree/home/detail/7"].map(isLabPath)).toEqual([true, true, true]);
		expect(["/", "/auth/login", "/workspaces", "/__devices", "/acme/__dev", "/__dev2"].map(isLabPath)).toEqual([false, false, false, false, false, false]);
	});
	test("the lab starts on its own only when every screen of the stack is the lab's", () => {
		expect(labOnly(["/__dev"])).toBe(true);
		expect(labOnly(["/__dev/tree", "/__dev/tree/home/detail/7"])).toBe(true);
		expect(labOnly(["/auth/login"])).toBe(false); // the router's first screen, when nothing was opened
		expect(labOnly(["/auth/login", "/__dev"])).toBe(false); // restored from a user who went from the login to the lab
		expect(labOnly([])).toBe(false);
	});
});

describe("which AppState statuses pause the asking", () => {
	test("background and iOS's inactive do; active and anything the platform says that the app does not know do not", () => {
		expect(["background", "inactive"].map(isForeground)).toEqual([false, false]);
		expect(["active", "unknown", "extension", "", null, undefined].map(isForeground)).toEqual([true, true, true, true, true, true]);
	});
});
