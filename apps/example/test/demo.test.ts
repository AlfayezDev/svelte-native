import { describe, expect, mock, test } from "bun:test";

/**
 * Demo mode (`src/lib/demo.ts`): a screen plays its script only when its link has `?demo`, runs the steps in order with the settle before
 * the first and the hold after the last, and stops when its screen goes. `onMount` is stood in for, so a test can say whether a component
 * asked to run something when it mounts and then run it.
 */
const mounted: Array<() => unknown> = [];
mock.module("svelte", () => ({ onMount: (run: () => unknown) => { mounted.push(run); } }));
const { demoRequested, playDemo, scroller, sleep, typeInto, useDemo } = await import("../src/lib/demo.ts");

const link = (query: string) => new URL(`svelte-native:///layout${query}`);
/** Runs `body` with the console's log quiet: a demo says when it starts and ends. */
async function quietly<T>(body: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try { return await body(); } finally { console.log = log; }
}

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
    await quietly(async () => {
      const stop = mounted[before]?.() as () => void;
      await sleep(60);
      expect(seen).toEqual(["one", "two"]);
      stop();
    });
    // A second screen that is closed before its first step never plays it.
    useDemo(() => link("?demo"), [[() => seen.push("late")]], { settle: 30 });
    await quietly(async () => {
      const stop = mounted[before + 1]?.() as () => void;
      stop();
      await sleep(60);
    });
    expect(seen).toEqual(["one", "two"]);
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
    expect(at[0]).toBeGreaterThanOrEqual(38);
    // c comes after the settle, a's pause, b's 20 ms of work and b's pause: 40 + 30 + 20 + 10
    expect(at[1]).toBeGreaterThanOrEqual(98);
    // and the hold (25) follows c's own pause (15)
    expect(total).toBeGreaterThanOrEqual(98 + 15 + 25 - 3);
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
