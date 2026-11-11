/**
 * The race of the event checks (`foreign-libraries-checks.ts`, SPEC.md, "Events on Android"), apart from React Native so that the harness's tests load it (`qa/test/foreign.test.ts`).
 * A check raises two messages of one event name on the native side, back to back, holds the JavaScript thread while the native side raises them, and then expects both: React Native's
 * event queue replaces the unread event of a coalescable type that was queued last for a view, so a library whose event can coalesce delivers the last one alone.
 */

/** What a race needs of the lab's context (`Ctx` has all of it). */
export type RaceWorld = {
  readonly android: boolean;
  /** Every event the section raised since the place was opened, in the order it reached JavaScript. */
  history(): readonly { event: string; detail?: unknown }[];
  pause(milliseconds: number): Promise<void>;
  until(test: () => boolean, milliseconds: number): Promise<boolean>;
  check(name: string, passed: boolean, detail?: string): void;
  androidOnly(name: string, why: string): void;
};

/** One race: what raises the messages, how long the thread is held and what must have reached JavaScript afterwards. */
export type Race = {
  /** Raises the messages on the native side: sets a prop, sends view commands, calls a native module. Awaited, but only for microtasks. [attempt] counts from 0 (a retry needs messages of its own). */
  send(attempt: number): void | Promise<void>;
  /** The events the check waits for: one of them reaching JavaScript before the hold began would have been read without the queue's replacing anything, and the attempt does not count. */
  names: readonly string[];
  /**
   * The send is a native module call, which React Native posts to the module's thread when it is made, so the hold begins in the same task, without the timer hop. A hop gives the
   * UI thread a frame in which JavaScript reads both events before the hold, which leaves the queue nothing to replace: on the Samsung A16 (8 Nov 2026) video's two volume changes
   * were read during the hop in all five attempts at one place.
   */
  posted?: boolean;
  /** Whether the send is ready for the hold (a prop the host has committed); an attempt that is not ready does not count. */
  ready?(): boolean;
  /** Whether all the messages of the attempt reached JavaScript, from entry [from] of the history on. */
  arrived(from: number, attempt: number): boolean;
  milliseconds: number;
};

/** How many times a race is made before the check gives up. */
export const raceAttempts = 5;

/** The part of React Native's runtime scheduler (`global.nativeRuntimeScheduler`, `RuntimeSchedulerBinding.cpp`) that the hop needs: a task of a priority, run in the JavaScript thread's own event loop. */
export type RuntimeScheduler = { unstable_scheduleCallback(priority: number, callback: () => void): unknown };
/** `ImmediatePriority` of the scheduler (`SchedulerPriority.h`): the task expires at once, so it runs before every task of another priority that is queued, and the ones that come after it. */
export const immediatePriority = 1;

/**
 * The hop after the task that sent: a promise that resolves in the next task of the JavaScript thread, which is the first thing to run after the rendering update of the task that asked, and before
 * anything that was queued meanwhile (React Native's runtime scheduler runs tasks by priority and then by expiry: an immediate task goes before a native event, which is a user-blocking one, and before a
 * timer, which is a normal one). Without the scheduler (a runtime that has none) it is [fallback], a timer.
 *
 * Why not a timer: on Android `setTimeout` is `JavaTimerManager`, whose timers fire in the Choreographer's frame callbacks (`TimerFrameCallback`, `TIMERS_EVENTS`), so a `setTimeout(0)` ends at the next
 * frame, and so does everything the check is racing: the frame that dispatches a view command (`DISPATCH_UI`, which runs before `TIMERS_EVENTS`) lets the view raise its events and the event beat hands them to
 * the JavaScript thread in that callback, ahead of the timer that was due in the same frame. A hop by timer then reads the events before the hold (the Samsung A16, 11 Nov 2026, the `rive` row: both `onPlay`
 * of five attempts were in the history 14 to 23 ms after they were sent, a frame or two, and not one attempt held the thread). The task needs no frame, so the thread is held in the moment the rendering
 * update has handed the command to the native side, which is the earliest the hold can begin without starting before the native side has seen anything.
 */
export function nextTaskOf(scheduler: RuntimeScheduler | undefined, fallback: () => Promise<void>): () => Promise<void> {
  return () => (scheduler ? new Promise<void>((resolve) => { scheduler.unstable_scheduleCallback(immediatePriority, () => resolve()); }) : fallback());
}

/**
 * Makes the race by construction. [Race.send] raises the messages. The task then ends, with one hop ([nextTask], the next task of the thread), because a commit and a view command reach the native side only after the task that made
 * them: React Native's scheduler mounts a commit and dispatches a view command in the rendering update that follows the task (`Scheduler::uiManagerDidFinishTransaction` and
 * `schedulerDidDispatchCommand`, `Scheduler.cpp`, run by `RuntimeScheduler_Modern::updateRendering` at the end of the task), so a hold in the same task would start before the native side had seen anything, and everything it raised would land after the hold, when the thread is
 * free again and the queue is read as it arrives (the negative control on the emulator, 4 Nov 2026: `drawPdf` was logged as the hold ended, 1.5 s after the commit, in all six places of two runs). A native module call is
 * posted to its own thread when it is made, so a [Race.posted] send has no hop: the thread is held in the same task, before the UI thread can raise anything JavaScript could read first. Otherwise, at the start of
 * the next task the thread is held, so that the UI thread raises both messages while JavaScript cannot read the queue and both wait in it together. Without the library's `canCoalesce() false` the
 * queue would then replace the first by the second. The race is forced only if none of the events had reached JavaScript before the hold began (that is looked at, not assumed: a frame can still fall between the update and the
 * hold on a runtime whose hop is a timer) and the send was ready, so an attempt in which one had is thrown away and made again, [raceAttempts] times at most; the check then fails
 * saying it could not force the race, and never passes without having. On another platform the check is Android-only and says why ([iosWhy]). [nextTask] is [RaceWorld.pause] of 0 ms when the caller has none.
 */
export async function runRace(world: RaceWorld, hold: (milliseconds: number) => void, name: string, iosWhy: string, race: Race, nextTask: () => Promise<void> = () => world.pause(0)): Promise<void> {
  if (!world.android) { world.androidOnly(name, iosWhy); return; }
  for (let attempt = 0; attempt < raceAttempts; attempt++) {
    const from = world.history().length;
    await race.send(attempt);
    if (!race.posted) await nextTask();
    const early = world.history().slice(from).some((entry) => race.names.includes(entry.event));
    if (early || (race.ready && !race.ready())) { await world.pause(500); continue; }
    hold(race.milliseconds);
    const arrived = await world.until(() => race.arrived(from, attempt), 2000);
    const got = world.history().slice(from).filter((entry) => race.names.includes(entry.event)).map((entry) => `${entry.event} ${String(entry.detail)}`);
    world.check(name, arrived, `attempt ${attempt + 1}; got ${got.join(", ") || "none"}`);
    return;
  }
  world.check(name, false, `the race could not be forced: the events were read, or the prop was not committed, before the hold began in ${raceAttempts} attempts`);
}
