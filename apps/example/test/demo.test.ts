import { afterAll, describe, expect, mock, test } from "bun:test";

/**
 * Demo mode (`src/lib/demo.ts`): a screen plays its script only when its link has `?demo`, runs the steps in order with the settle before
 * the first and the hold after the last, and stops when its screen goes. `onMount` is stood in for, so a test can say whether a component
 * asked to run something when it mounts and then run it. The rest of `svelte` stays as it is, and is put back when the file is done: Bun's
 * module mocks are for the whole run, not for one file, and a module's namespace is live (the copy keeps the real `onMount`).
 */
const realSvelte = { ...(await import("svelte")) };
const mounted: Array<() => unknown> = [];
mock.module("svelte", () => ({ ...realSvelte, onMount: (run: () => unknown) => { mounted.push(run); } }));
afterAll(() => { mock.module("svelte", () => realSvelte); });
const { demoRequested, playDemo, scroller, sleep, typeInto, useDemo } = await import("../src/lib/demo.ts");

const link = (query: string) => new URL(`expo-svelte:///layout${query}`);
/** Runs `body` and returns what the console logged meanwhile, so a demo's `[demo]` lines are heard and not printed. */
async function logging(body: () => Promise<void>): Promise<{ log: string[]; error: string[] }> {
  const saved = { log: console.log, error: console.error };
  const heard = { log: [] as string[], error: [] as string[] };
  console.log = (...args: unknown[]) => { heard.log.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { heard.error.push(args.map(String).join(" ")); };
  try { await body(); } finally { Object.assign(console, saved); }
  return heard;
}
/** The `[demo]` lines without the time they took, which varies. */
const without = (lines: string[]) => lines.map((line) => line.replace(/ after \d+ ms$/, ""));
// A timer can fire a few milliseconds early on a busy machine (the clock is rounded to milliseconds): the lower bounds below leave this much.
const slack = 5;

describe("the demo parameter", () => {
  test("`?demo` and `?demo=1` ask for the demo; no parameter, another one, `?demo=0` and `?demo=false` do not", () => {
    expect(demoRequested(link("?demo"))).toBe(true);
    expect(demoRequested(link("?demo=1"))).toBe(true);
    expect(demoRequested(link("?other=1&demo"))).toBe(true);
    expect(demoRequested(link(""))).toBe(false);
    expect(demoRequested(link("?demos"))).toBe(false);
    expect(demoRequested(link("?demo=0"))).toBe(false);
    expect(demoRequested(link("?demo=false"))).toBe(false);
    expect(demoRequested(undefined)).toBe(false);
  });

  test("without the parameter a screen asks for nothing: no onMount, no steps", () => {
    const before = mounted.length;
    let ran = false;
    useDemo(() => link(""), [[() => { ran = true; }]], { settle: 0, hold: 0 });
    useDemo(() => undefined, [[() => { ran = true; }]], { settle: 0, hold: 0 });
    expect(mounted.length).toBe(before);
    expect(ran).toBe(false);
  });

  test("with the parameter it runs its script once the component mounts, and stops it when the component goes", async () => {
    const seen: string[] = [];
    const before = mounted.length;
    useDemo(() => link("?demo"), [[() => seen.push("one"), 5], [() => seen.push("two"), 5]], { settle: 5, hold: 5 });
    expect(mounted.length).toBe(before + 1);
    expect(seen).toEqual([]);
    const played = await logging(async () => {
      const stop = mounted[before]?.() as () => void;
      await sleep(60);
      expect(seen).toEqual(["one", "two"]);
      stop();
    });
    expect(without(played.log)).toEqual(["[demo] start /layout", "[demo] end /layout"]);
    expect(played.log[1]).toMatch(/^\[demo\] end \/layout after \d+ ms$/);
    // A second screen that is closed before its first step never plays it.
    useDemo(() => link("?demo"), [[() => seen.push("late")]], { settle: 30 });
    const closed = await logging(async () => {
      const stop = mounted[before + 1]?.() as () => void;
      stop();
      await sleep(60);
    });
    expect(seen).toEqual(["one", "two"]);
    expect(without(closed.log)).toEqual(["[demo] start /layout", "[demo] stopped /layout"]);
  });

  test("a step that throws is reported as a failure, and the script does not log an end", async () => {
    const before = mounted.length;
    useDemo(() => link("?demo"), [[() => { throw new Error("no such view"); }]], { settle: 0, hold: 0 });
    const failed = await logging(async () => {
      mounted[before]?.();
      await sleep(30);
    });
    expect(failed.log).toEqual(["[demo] start /layout"]);
    expect(failed.error.length).toBe(1);
    expect(failed.error[0]).toContain("[demo] a step of /layout failed");
  });
});

describe("a script", () => {
  test("runs its steps in order, waits for a step that returns a promise, and keeps the settle, the pauses and the hold", async () => {
    const events: string[] = [];
    const started = performance.now();
    const at: number[] = [];
    const { finished } = playDemo([
      [() => { events.push("a"); at.push(performance.now() - started); }, 30],
      [async () => { events.push("b start"); await sleep(20); events.push("b end"); }, 10],
      [() => { events.push("c"); at.push(performance.now() - started); }],
    ], { settle: 40, pause: 15, hold: 25 });
    expect(await finished).toBe(true);
    const total = performance.now() - started;
    expect(events).toEqual(["a", "b start", "b end", "c"]);
    expect(at[0]).toBeGreaterThanOrEqual(40 - slack);
    // c comes after the settle, a's pause, b's 20 ms of work and b's pause: 40 + 30 + 20 + 10
    expect(at[1]).toBeGreaterThanOrEqual(100 - slack);
    // and the hold (25) follows c's own pause (15)
    expect(total).toBeGreaterThanOrEqual(100 + 15 + 25 - slack);
  });

  test("stop() ends it at once: no later step runs and `finished` says false", async () => {
    const events: string[] = [];
    const { finished, stop } = playDemo([[() => events.push("a"), 200], [() => events.push("b"), 0]], { settle: 5, hold: 0 });
    await sleep(40);
    stop();
    expect(await finished).toBe(false);
    await sleep(20);
    expect(events).toEqual(["a"]);
  });

  test("a stop after the last step has run, in its pause or in the hold, still counts as the end", async () => {
    const inPause = playDemo([[() => {}, 5], [() => {}, 200]], { settle: 0, hold: 0 });
    await sleep(40);
    inPause.stop();
    expect(await inPause.finished).toBe(true);
    const inHold = playDemo([[() => {}, 0]], { settle: 0, hold: 200 });
    await sleep(40);
    inHold.stop();
    expect(await inHold.finished).toBe(true);
  });

  test("a step that throws rejects `finished` and ends the script", async () => {
    const events: string[] = [];
    const { finished } = playDemo([[() => { throw new Error("no such view"); }], [() => events.push("after")]], { settle: 0, hold: 0, pause: 0 });
    await expect(finished).rejects.toThrow("no such view");
    expect(events).toEqual([]);
  });
});

describe("the helpers a script uses", () => {
  test("typeInto sets the value one letter longer at a time", async () => {
    const values: string[] = [];
    await typeInto((value) => values.push(value), "Sam", 1);
    expect(values).toEqual(["S", "Sa", "Sam"]);
  });

  test("a step that hands typeInto its signal stops typing when the script is stopped", async () => {
    const values: string[] = [];
    const demo = playDemo([[(signal) => typeInto((value) => { values.push(value); if (value.length === 3) demo.stop(); }, "abcdef", 2, signal), 0]], { settle: 0, hold: 0 });
    // The stop came in the last step, which then ends: the script is over.
    expect(await demo.finished).toBe(true);
    await sleep(20);
    expect(values).toEqual(["a", "ab", "abc"]);
  });

  test("a scroller glides to an offset in steps that only go forward, jumps to an exact one, and does nothing once its view is gone", async () => {
    const offsets: number[] = [];
    const view = scroller();
    view.ref({ scrollTo: (options) => { offsets.push(options.y ?? -1); } });
    await view.glide(300, 80);
    expect(offsets.length).toBeGreaterThan(2);
    expect(offsets[offsets.length - 1]).toBe(300);
    expect(offsets.every((value, index) => index === 0 || (offsets[index - 1] ?? 0) <= value)).toBe(true);
    view.jump(0);
    expect(offsets[offsets.length - 1]).toBe(0);
    // The next glide starts from where the last one (or jump) left the view.
    offsets.length = 0;
    await view.glide(100, 40);
    expect(offsets[0]).toBeLessThan(50);
    view.ref(null);
    offsets.length = 0;
    await view.glide(500, 40);
    view.jump(5);
    expect(offsets).toEqual([]);
  });
});
