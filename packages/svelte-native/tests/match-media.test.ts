import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { answer, hostGlobals, load, resize, setting, settle, switchScheme, type World } from "./match-media-harness.ts";

/**
 * `window.matchMedia` on the device, from the library's own polyfills: the `MediaQueryList` it returns, what it listens to and when, and what the boot does (nothing). The system is the
 * stand-ins of `match-media-harness.ts`; the table of queries is `media-query.test.ts`.
 */
const host = hostGlobals();
let world: World;
const entry = 'import "../src/polyfills.ts";';
const mm = (query: string) => window.matchMedia(query);
type Change = { type: string; matches: boolean; media: string; target: unknown };
const record = (list: MediaQueryList): Change[] => {
  const events: Change[] = [];
  list.addEventListener("change", (event) => events.push({ type: event.type, matches: event.matches, media: event.media, target: event.target }));
  return events;
};

beforeEach(async () => {
  world = host.install();
  await load(entry);
});
afterAll(() => host.restore());

describe("the polyfill", () => {
  test("is a function on window that reads nothing from the system and loads nothing until it is called", async () => {
    // The beforeEach loaded the polyfills: that is all that has happened.
    expect(typeof window.matchMedia).toBe("function");
    expect(world.loaded).toBe(0);
    expect(world.reads).toEqual({ dimensions: 0, appearance: 0 });
    expect(world.asked).toEqual({ motion: 0, contrast: 0, inverted: 0, transparency: 0 });
    expect(world.added).toBe(0);
    mm("(min-width: 100px)");
    expect(world.loaded).toBe(1);
    mm("screen");
    mm("(prefers-color-scheme: dark)");
    expect(world.loaded).toBe(1); // loaded once
    // A list that has not been read has read nothing.
    expect(world.reads).toEqual({ dimensions: 0, appearance: 0 });
    expect(world.added).toBe(0);
  });

  test("a platform that has a matchMedia keeps it", async () => {
    const own = () => ({ matches: true });
    (window as unknown as { matchMedia: unknown }).matchMedia = own;
    await load(entry);
    expect(window.matchMedia).toBe(own as never);
  });

  test("a call with no query is an error, as in a browser; anything else is a query", () => {
    expect(() => (window.matchMedia as () => unknown)()).toThrow(TypeError);
    expect(mm("(min-width: 100px)").matches).toBe(true);
    expect(mm(undefined as never).matches).toBe(false); // "undefined" is a media type nothing matches
    expect(mm({ toString: () => "(min-width: 100px)" } as never).matches).toBe(true);
  });

  test("a malformed query is a list that matches nothing, says `not all`, and reads and listens to nothing", () => {
    for (const query of ["(", "foo bar", "(min-width: red)", "(foo: bar)", "screen and", "(min-width: 100px", "((((", ")", "\u0000"]) {
      const list = mm(query);
      expect([query, list.matches, list.media]).toEqual([query, false, "not all"]);
      const events = record(list);
      resize(world, { width: 100 });
      resize(world, { width: 900 });
      expect(events).toEqual([]);
    }
    expect(world.reads).toEqual({ dimensions: 0, appearance: 0 });
    expect(world.asked).toEqual({ motion: 0, contrast: 0, inverted: 0, transparency: 0 });
    expect(world.added).toBe(0);
  });
});

describe("MediaQueryList", () => {
  test("it has what the DOM's has: media as a browser writes it, matches from the system as it is, and the listener methods", () => {
    const list = mm("(MIN-WIDTH:600PX) and (orientation:portrait)");
    expect(list.media).toBe("(min-width: 600px) and (orientation: portrait)");
    expect(list.matches).toBe(false);
    expect(list.onchange).toBeNull();
    expect(Object.prototype.toString.call(list)).toBe("[object MediaQueryList]");
    for (const method of ["addEventListener", "removeEventListener", "addListener", "removeListener", "dispatchEvent"] as const) expect(typeof list[method]).toBe("function");
    // `matches` is live even with no listener: the window turns, and the list says so.
    resize(world, { width: 700, height: 1000 });
    expect(list.matches).toBe(true);
    resize(world, { width: 1000, height: 700 });
    expect(list.matches).toBe(false);
    expect(mm("").matches).toBe(true);
    expect(mm("").media).toBe("");
  });

  test("a type-only query reads nothing from the system", () => {
    expect(mm("screen").matches).toBe(true);
    expect(mm("print").matches).toBe(false);
    expect(mm("(hover: none)").matches).toBe(true);
    expect(world.reads).toEqual({ dimensions: 0, appearance: 0 });
  });

  test("a query reads only the sources it needs: width reads the window, the scheme reads the appearance", () => {
    expect(mm("(min-width: 400px)").matches).toBe(true);
    expect(world.reads).toEqual({ dimensions: 1, appearance: 0 });
    expect(mm("(prefers-color-scheme: dark)").matches).toBe(false);
    expect(world.reads).toEqual({ dimensions: 1, appearance: 1 });
    expect(world.asked).toEqual({ motion: 0, contrast: 0, inverted: 0, transparency: 0 });
  });

  test("it reads the window in points, the pixel ratio and the scheme from the system", () => {
    expect(mm("(min-resolution: 2.6dppx)").matches).toBe(true);
    resize(world, { scale: 1 });
    expect(mm("(min-resolution: 2dppx)").matches).toBe(false);
    expect(mm("(min-width: 411px) and (max-width: 411px)").matches).toBe(true);
    world.scheme = "dark";
    expect(mm("(prefers-color-scheme: dark)").matches).toBe(true);
    world.scheme = null; // a system that says nothing is light
    expect(mm("(prefers-color-scheme: light)").matches).toBe(true);
    expect(mm("(prefers-color-scheme: dark)").matches).toBe(false);
  });
});

describe("change events", () => {
  test("a listener hears a change when the result flips, and only then, with matches and media", () => {
    const list = mm("(min-width: 600px)");
    const events = record(list);
    resize(world, { width: 500 });
    resize(world, { width: 599 });
    expect(events).toEqual([]);
    resize(world, { width: 700 });
    expect(events).toEqual([{ type: "change", matches: true, media: "(min-width: 600px)", target: list }]);
    resize(world, { width: 800, height: 300 });
    resize(world, { width: 600 });
    expect(events).toHaveLength(1);
    resize(world, { width: 300 });
    expect(events.map((event) => event.matches)).toEqual([true, false]);
    // A change that did not flip the result: a different size with the same answer.
    resize(world, { width: 200 });
    expect(events).toHaveLength(2);
  });

  test("the event's `currentTarget` is the list while it is heard, and `preventDefault` and the like are there", () => {
    const list = mm("(min-width: 600px)");
    const seen: unknown[] = [];
    list.addEventListener("change", function (this: unknown, event) {
      seen.push(this, event.currentTarget, event.target, event.bubbles, event.cancelable, event.defaultPrevented);
      event.preventDefault();
      event.stopPropagation();
    });
    resize(world, { width: 700 });
    expect(seen).toEqual([list, list, list, false, false, false]);
  });

  test("each query follows its own result: two lists on one window flip at their own widths", () => {
    const narrow = mm("(min-width: 500px)");
    const wide = mm("(min-width: 800px)");
    const heard: string[] = [];
    narrow.addEventListener("change", (event) => heard.push(`narrow ${event.matches}`));
    wide.addEventListener("change", (event) => heard.push(`wide ${event.matches}`));
    resize(world, { width: 600 });
    resize(world, { width: 900 });
    resize(world, { width: 300 });
    expect(heard).toEqual(["narrow true", "wide true", "narrow false", "wide false"]);
  });

  test("a turn flips orientation and the range; the scheme flips prefers-color-scheme", () => {
    const portrait = mm("(orientation: portrait)");
    const range = mm("(400px <= width < 700px)");
    const dark = mm("(prefers-color-scheme: dark)");
    const heard: string[] = [];
    portrait.addEventListener("change", (event) => heard.push(`portrait ${event.matches}`));
    range.addEventListener("change", (event) => heard.push(`range ${event.matches}`));
    dark.addEventListener("change", (event) => heard.push(`dark ${event.matches}`));
    resize(world, { width: 891, height: 411 });
    expect(heard).toEqual(["portrait false", "range false"]);
    switchScheme(world, "dark");
    expect(heard.at(-1)).toBe("dark true");
    switchScheme(world, null);
    expect(heard.at(-1)).toBe("dark false");
    switchScheme(world, "dark");
    switchScheme(world, "dark");
    expect(heard.filter((entry) => entry.startsWith("dark"))).toEqual(["dark true", "dark false", "dark true"]);
  });

  test("a list that is `or` of a window and the scheme hears both sources", () => {
    const list = mm("(min-width: 600px), (prefers-color-scheme: dark)");
    const events = record(list);
    resize(world, { width: 700 });
    expect(events).toHaveLength(1);
    switchScheme(world, "dark"); // still true: no flip
    expect(events).toHaveLength(1);
    resize(world, { width: 300 }); // true because dark
    expect(events).toHaveLength(1);
    switchScheme(world, "light");
    expect(events.map((event) => event.matches)).toEqual([true, false]);
  });
});

describe("listeners", () => {
  test("onchange is an event handler: set, replaced and cleared, and a value that is no function is null", () => {
    const list = mm("(min-width: 600px)");
    const calls: string[] = [];
    list.onchange = function (this: unknown, event) { calls.push(`first ${String(this === list)} ${event.matches}`); };
    expect(world.listeners.dimensions.size).toBe(1);
    resize(world, { width: 700 });
    const second = () => { calls.push("second"); };
    list.onchange = second;
    expect(list.onchange).toBe(second);
    expect(world.listeners.dimensions.size).toBe(1); // one subscription, not two
    resize(world, { width: 300 });
    expect(calls).toEqual(["first true true", "second"]);
    list.onchange = null;
    expect(list.onchange).toBeNull();
    expect(world.listeners.dimensions.size).toBe(0);
    resize(world, { width: 700 });
    expect(calls).toHaveLength(2);
    list.onchange = "not a function" as never;
    expect(list.onchange).toBeNull();
    expect(world.listeners.dimensions.size).toBe(0);
  });

  test("onchange and addEventListener are heard together, in the order they were added", () => {
    const list = mm("(min-width: 600px)");
    const calls: string[] = [];
    list.addEventListener("change", () => calls.push("a"));
    list.onchange = () => calls.push("onchange");
    list.addEventListener("change", () => calls.push("b"));
    resize(world, { width: 700 });
    expect(calls).toEqual(["a", "onchange", "b"]);
  });

  test("the legacy addListener and removeListener are the same listeners", () => {
    const list = mm("(min-width: 600px)");
    const calls: boolean[] = [];
    const listener = (event: MediaQueryListEvent) => calls.push(event.matches);
    list.addListener(listener);
    expect(world.listeners.dimensions.size).toBe(1);
    resize(world, { width: 700 });
    expect(calls).toEqual([true]);
    list.removeEventListener("change", listener); // either removes what either added
    expect(world.listeners.dimensions.size).toBe(0);
    list.addEventListener("change", listener);
    list.removeListener(listener);
    expect(world.listeners.dimensions.size).toBe(0);
    resize(world, { width: 300 });
    expect(calls).toEqual([true]);
    list.addListener(null);
    expect(world.listeners.dimensions.size).toBe(0);
  });

  test("a listener that is added twice is heard once; an object with handleEvent is a listener; once removes itself", () => {
    const list = mm("(min-width: 600px)");
    const calls: string[] = [];
    const listener = () => calls.push("fn");
    list.addEventListener("change", listener);
    list.addEventListener("change", listener);
    list.addEventListener("change", { handleEvent: (event: MediaQueryListEvent) => calls.push(`object ${event.matches}`) } as never);
    list.addEventListener("change", () => calls.push("once"), { once: true });
    resize(world, { width: 700 });
    resize(world, { width: 300 });
    expect(calls).toEqual(["fn", "object true", "once", "fn", "object false"]);
    list.removeEventListener("change", listener);
    resize(world, { width: 700 });
    expect(calls.at(-1)).toBe("object true");
    // A listener that was never added, and an event of another type, change nothing.
    list.removeEventListener("change", () => {});
    list.removeEventListener("resize", listener);
    list.addEventListener("resize", () => calls.push("resize"));
    resize(world, { width: 300 });
    expect(calls).not.toContain("resize");
  });

  test("a listener that removes itself, or another, while it is heard: the others are still heard", () => {
    const list = mm("(min-width: 600px)");
    const calls: string[] = [];
    const second = () => calls.push("second");
    const first = () => {
      calls.push("first");
      list.removeEventListener("change", first);
      list.removeEventListener("change", second);
    };
    list.addEventListener("change", first);
    list.addEventListener("change", second);
    list.addEventListener("change", () => calls.push("third"));
    resize(world, { width: 700 });
    expect(calls).toEqual(["first", "third"]);
    resize(world, { width: 300 });
    expect(calls).toEqual(["first", "third", "third"]);
  });

  test("a listener that throws does not stop the others; the error goes to the host's uncaught-error path", () => {
    const list = mm("(min-width: 600px)");
    const calls: string[] = [];
    const timers: (() => void)[] = [];
    const setTimeoutBefore = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: () => void) => { timers.push(callback); return 0; }) as never;
    try {
      list.addEventListener("change", () => { throw new Error("listener failed"); });
      list.addEventListener("change", () => calls.push("second"));
      resize(world, { width: 700 });
    } finally {
      globalThis.setTimeout = setTimeoutBefore;
    }
    expect(calls).toEqual(["second"]);
    expect(timers).toHaveLength(1);
    expect(() => timers[0]?.()).toThrow("listener failed");
  });

  test("dispatchEvent calls the change listeners with the event it is given, and ignores other types", () => {
    const list = mm("(min-width: 600px)");
    const calls: unknown[] = [];
    list.addEventListener("change", (event) => calls.push(event));
    const own = { type: "change", matches: true, media: "x" } as MediaQueryListEvent;
    expect(list.dispatchEvent(own)).toBe(true);
    expect(calls).toEqual([own]);
    expect(list.dispatchEvent({ type: "resize" } as Event)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("lists are independent: a listener of one list is not called for another's change", () => {
    const first = mm("(min-width: 600px)");
    const second = mm("(min-width: 600px)");
    const one = record(first);
    const two = record(second);
    second.removeEventListener("change", () => {});
    resize(world, { width: 700 });
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(one[0]?.target).toBe(first);
    expect(two[0]?.target).toBe(second);
  });
});

describe("addEventListener options", () => {
  test("a signal that aborts removes the listener, and the system's listener with it", () => {
    const list = mm("(min-width: 600px)");
    const controller = new AbortController();
    const calls: boolean[] = [];
    list.addEventListener("change", (event) => calls.push(event.matches), { signal: controller.signal });
    expect(world.listeners.dimensions.size).toBe(1);
    resize(world, { width: 700 });
    expect(calls).toEqual([true]);
    controller.abort();
    expect(world.listeners.dimensions.size).toBe(0);
    resize(world, { width: 300 });
    expect(calls).toEqual([true]);
    expect(world.added).toBe(world.removed);
  });

  test("a signal that has aborted already adds nothing", () => {
    const list = mm("(min-width: 600px)");
    const controller = new AbortController();
    controller.abort();
    const calls: boolean[] = [];
    list.addEventListener("change", (event) => calls.push(event.matches), { signal: controller.signal });
    expect(world.added).toBe(0);
    resize(world, { width: 700 });
    expect(calls).toEqual([]);
  });

  test("one signal for several lists and listeners ends them all; another listener of the list stays", () => {
    const controller = new AbortController();
    const a = mm("(min-width: 600px)");
    const b = mm("(orientation: landscape)");
    const heard: string[] = [];
    a.addEventListener("change", () => heard.push("a signal"), { signal: controller.signal });
    a.addEventListener("change", () => heard.push("a free"));
    b.addEventListener("change", () => heard.push("b signal"), { signal: controller.signal });
    controller.abort();
    resize(world, { width: 891, height: 411 });
    expect(heard).toEqual(["a free"]);
    expect(world.listeners.dimensions.size).toBe(1);
  });

  test("removing the listener takes the abort listener off the signal; once does too", () => {
    const list = mm("(min-width: 600px)");
    const abort = new Set<unknown>();
    const signal = {
      aborted: false,
      addEventListener: (type: string, listener: unknown) => { if (type === "abort") abort.add(listener); },
      removeEventListener: (type: string, listener: unknown) => { if (type === "abort") abort.delete(listener); },
    } as unknown as AbortSignal;
    const listener = () => {};
    list.addEventListener("change", listener, { signal });
    expect(abort.size).toBe(1);
    list.removeEventListener("change", listener);
    expect(abort.size).toBe(0);
    list.addEventListener("change", () => {}, { signal, once: true });
    expect(abort.size).toBe(1);
    resize(world, { width: 700 }); // heard once, and gone
    expect(abort.size).toBe(0);
    expect(world.listeners.dimensions.size).toBe(0);
    // An abort after the listener is gone does nothing.
    list.addEventListener("change", listener, { signal });
    list.removeListener(listener);
    for (const abortListener of abort) (abortListener as () => void)();
    expect(world.listeners.dimensions.size).toBe(0);
  });

  test("a listener added twice with a signal is added once, and its abort listener once", () => {
    const list = mm("(min-width: 600px)");
    const abort = new Set<unknown>();
    const signal = { aborted: false, addEventListener: (_type: string, listener: unknown) => { abort.add(listener); }, removeEventListener: (_type: string, listener: unknown) => { abort.delete(listener); } } as unknown as AbortSignal;
    const listener = () => {};
    list.addEventListener("change", listener, { signal });
    list.addEventListener("change", listener, { signal });
    expect(abort.size).toBe(1);
  });

  test("once is heard once, and the system is let go with it", () => {
    const list = mm("(min-width: 600px)");
    const calls: boolean[] = [];
    list.addEventListener("change", (event) => calls.push(event.matches), { once: true });
    resize(world, { width: 700 });
    resize(world, { width: 300 });
    expect(calls).toEqual([true]);
    expect(world.listeners.dimensions.size).toBe(0);
  });
});

describe("what a list listens to", () => {
  test("nothing until it has a listener, and one native listener per source however many lists and listeners", () => {
    const a = mm("(min-width: 600px)");
    const b = mm("(orientation: landscape)");
    const c = mm("(prefers-color-scheme: dark)");
    expect(world.added).toBe(0);
    a.addEventListener("change", () => {});
    a.addEventListener("change", () => {});
    b.addEventListener("change", () => {});
    expect(world.listeners.dimensions.size).toBe(1); // a and b share the window listener
    expect(world.listeners.appearance.size).toBe(0);
    c.addEventListener("change", () => {});
    expect(world.listeners.appearance.size).toBe(1);
    expect(world.listeners.reduceMotionChanged.size).toBe(0);
    expect(world.added).toBe(2);
  });

  test("a list takes its sources away with its last listener, and the shared one goes with the last list", () => {
    const a = mm("(min-width: 600px)");
    const b = mm("(orientation: landscape) and (prefers-color-scheme: dark)");
    const one = () => {};
    const two = () => {};
    const three = () => {};
    a.addEventListener("change", one);
    b.addEventListener("change", two);
    b.addEventListener("change", three);
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([1, 1]);
    b.removeEventListener("change", two);
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([1, 1]);
    b.removeEventListener("change", three);
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([1, 0]); // a still listens to the window
    a.removeEventListener("change", one);
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([0, 0]);
    expect(world.added).toBe(world.removed);
  });

  test("a list wakes again after it slept, and sees the state as it is then", () => {
    const list = mm("(min-width: 600px)");
    const listener = () => {};
    list.addEventListener("change", listener);
    list.removeEventListener("change", listener);
    resize(world, { width: 700 }); // nobody listens: nobody is told
    const events = record(list);
    resize(world, { width: 800 }); // 700 -> 800 is no flip
    expect(events).toEqual([]);
    resize(world, { width: 300 });
    expect(events.map((event) => event.matches)).toEqual([false]);
  });

  test("a list is not held by the system once its listeners are gone: add and remove 100 times leaves nothing", () => {
    const list = mm("(min-width: 600px), (prefers-color-scheme: dark), (prefers-reduced-motion: reduce)");
    for (let turn = 0; turn < 100; turn++) {
      const listener = () => {};
      list.addEventListener("change", listener);
      list.removeEventListener("change", listener);
    }
    expect(world.added).toBe(world.removed);
    expect(world.added).toBe(300);
    for (const set of Object.values(world.listeners)) expect(set.size).toBe(0);
  });

  test("a query of no source (a type, hover) listens to nothing and never fires", () => {
    const list = mm("screen and (hover: none)");
    const events = record(list);
    resize(world, { width: 100 });
    switchScheme(world, "dark");
    expect(events).toEqual([]);
    expect(world.added).toBe(0);
  });
});

describe("prefers-reduced-motion", () => {
  test("the system answers late: false until it has, then what it said, and a listener hears it if it differs", async () => {
    world.settings.motion = true;
    const list = mm("(prefers-reduced-motion: reduce)");
    expect(world.asked.motion).toBe(1); // asked as the query is made
    expect(list.matches).toBe(false);
    const events = record(list);
    expect(world.listeners.reduceMotionChanged.size).toBe(1);
    answer(world);
    await settle();
    expect(list.matches).toBe(true);
    expect(events).toEqual([{ type: "change", matches: true, media: "(prefers-reduced-motion: reduce)", target: list }]);
  });

  test("an answer that agrees with the first guess is no change", async () => {
    const list = mm("(prefers-reduced-motion: reduce)");
    const events = record(list);
    answer(world);
    await settle();
    expect(list.matches).toBe(false);
    expect(events).toEqual([]);
    const quiet = mm("(prefers-reduced-motion: no-preference)");
    expect(quiet.matches).toBe(true);
  });

  test("the setting's change event flips the list, and so does the opposite", async () => {
    const list = mm("(prefers-reduced-motion: reduce)");
    const events = record(list);
    answer(world);
    await settle();
    setting(world, "reduceMotionChanged", true);
    expect(list.matches).toBe(true);
    setting(world, "reduceMotionChanged", true);
    setting(world, "reduceMotionChanged", false);
    expect(events.map((event) => event.matches)).toEqual([true, false]);
    const calm = mm("(prefers-reduced-motion: no-preference)");
    expect(calm.matches).toBe(true);
    setting(world, "reduceMotionChanged", true);
    expect(calm.matches).toBe(false);
  });

  test("the last listener removes the system's listener; the next one asks again, in case the setting changed in between", async () => {
    const list = mm("(prefers-reduced-motion: reduce)");
    const listener = () => {};
    list.addEventListener("change", listener);
    answer(world);
    await settle();
    const asked = world.asked.motion;
    list.removeEventListener("change", listener);
    expect(world.listeners.reduceMotionChanged.size).toBe(0);
    world.settings.motion = true; // changed while nothing listened
    const events = record(list);
    expect(world.asked.motion).toBe(asked + 1);
    answer(world);
    await settle();
    expect(events.map((event) => event.matches)).toEqual([true]);
  });

  test("an answer that was asked before an event is older than the event", async () => {
    const list = mm("(prefers-reduced-motion: reduce)");
    const events = record(list);
    // The question is open; the system sends the event first, then the old answer arrives.
    world.settings.motion = false;
    setting(world, "reduceMotionChanged", true);
    answer(world);
    await settle();
    expect(list.matches).toBe(true);
    expect(events.map((event) => event.matches)).toEqual([true]);
  });

  test("a read with nobody listening asks again, one question at a time", async () => {
    const list = mm("(prefers-reduced-motion: reduce)");
    answer(world);
    await settle();
    const asked = world.asked.motion;
    expect(list.matches).toBe(false);
    expect(list.matches).toBe(false);
    expect(list.matches).toBe(false);
    expect(world.asked.motion).toBe(asked + 1); // the question is open until the system answers
    world.settings.motion = true;
    answer(world);
    await settle();
    expect(list.matches).toBe(true);
  });

  test("a system that fails to answer leaves the setting off and does not throw; the next read asks again", async () => {
    const list = mm("(prefers-reduced-motion: reduce)");
    for (const question of world.questions.splice(0)) question.fail(new Error("not available"));
    await settle();
    expect(list.matches).toBe(false);
    world.settings.motion = true;
    answer(world);
    await settle();
    expect(list.matches).toBe(true);
  });
});

describe("prefers-contrast", () => {
  test("on iOS it is Increase Contrast (darker system colors)", () => {
    world.os = "ios";
    const list = mm("(prefers-contrast: more)");
    const events = record(list);
    expect(list.matches).toBe(false);
    expect(world.listeners.darkerSystemColorsChanged.size).toBe(1);
    expect(world.listeners.highTextContrastChanged.size).toBe(0);
    setting(world, "darkerSystemColorsChanged", true);
    expect(list.matches).toBe(true);
    expect(events.map((event) => event.matches)).toEqual([true]);
    expect(mm("(prefers-contrast: no-preference)").matches).toBe(false);
    expect(mm("(prefers-contrast: less)").matches).toBe(false);
  });

  test("on Android it is high contrast text", () => {
    const list = mm("(prefers-contrast: more)");
    const events = record(list);
    expect(world.listeners.highTextContrastChanged.size).toBe(1);
    expect(world.listeners.darkerSystemColorsChanged.size).toBe(0);
    setting(world, "highTextContrastChanged", true);
    expect(list.matches).toBe(true);
    setting(world, "highTextContrastChanged", false);
    expect(events.map((event) => event.matches)).toEqual([true, false]);
  });

  test("the first answer comes from the system, and no preference is the default until it does", async () => {
    world.settings.contrast = true;
    const list = mm("(prefers-contrast: more)");
    expect(world.asked.contrast).toBe(1);
    expect(list.matches).toBe(false);
    const events = record(list);
    answer(world);
    await settle();
    expect(list.matches).toBe(true);
    expect(events.map((event) => event.matches)).toEqual([true]);
    expect(world.asked.motion).toBe(0); // a contrast query does not ask about motion
  });
});

describe("inverted-colors and prefers-reduced-transparency", () => {
  test("inverted-colors is the system's color inversion: asked when the query is made, and its change event flips the list", async () => {
    world.settings.inverted = true;
    const list = mm("(inverted-colors: inverted)");
    expect(world.asked.inverted).toBe(1);
    expect(list.matches).toBe(false);
    const events = record(list);
    expect(world.listeners.invertColorsChanged.size).toBe(1);
    answer(world);
    await settle();
    expect(list.matches).toBe(true);
    setting(world, "invertColorsChanged", false);
    expect(events.map((event) => event.matches)).toEqual([true, false]);
    expect(mm("(inverted-colors: none)").matches).toBe(true);
    expect(world.asked.motion).toBe(0);
    list.removeEventListener("change", () => {});
  });

  test("prefers-reduced-transparency is iOS's Reduce Transparency: its answer and its change event", async () => {
    world.settings.transparency = true;
    const list = mm("(prefers-reduced-transparency: reduce)");
    expect(world.asked.transparency).toBe(1);
    const events = record(list);
    expect(world.listeners.reduceTransparencyChanged.size).toBe(1);
    answer(world);
    await settle();
    expect(events.map((event) => event.matches)).toEqual([true]);
    setting(world, "reduceTransparencyChanged", false);
    expect(list.matches).toBe(false);
    expect(mm("(prefers-reduced-transparency: no-preference)").matches).toBe(true);
  });

  test("the last listener removes the system's listeners of both", () => {
    const first = mm("(inverted-colors: inverted)");
    const second = mm("(prefers-reduced-transparency: reduce)");
    const one = () => {};
    const two = () => {};
    first.addEventListener("change", one);
    second.addEventListener("change", two);
    first.removeEventListener("change", one);
    second.removeEventListener("change", two);
    expect(world.listeners.invertColorsChanged.size + world.listeners.reduceTransparencyChanged.size).toBe(0);
    expect(world.added).toBe(world.removed);
  });
});

describe("what a phone is, and the screen", () => {
  test("forced-colors, update, scripting and color-gamut read nothing from the system, and never fire", () => {
    for (const query of ["(forced-colors: none)", "(update: fast)", "(scripting: enabled)", "(color-gamut: srgb)", "(hover: none)"]) {
      const list = mm(query);
      expect([query, list.matches]).toEqual([query, true]);
      record(list);
    }
    expect(mm("(forced-colors: active)").matches).toBe(false);
    expect(mm("(color-gamut: p3)").matches).toBe(false);
    expect(world.reads).toEqual({ dimensions: 0, appearance: 0 });
    expect(world.asked).toEqual({ motion: 0, contrast: 0, inverted: 0, transparency: 0 });
    expect(world.added).toBe(0);
  });

  test("device-width and device-height are the screen's, which Dimensions has apart from the window", () => {
    // The stand-in's screen is the window and 48 points of bars.
    expect(mm("(device-height: 939px)").matches).toBe(true);
    expect(mm("(min-device-height: 900px)").matches).toBe(true);
    expect(mm("(min-height: 900px)").matches).toBe(false);
    expect(mm("(device-width: 411px)").matches).toBe(true);
    expect(mm("(max-device-aspect-ratio: 1/2)").matches).toBe(true);
    const list = mm("(min-device-width: 600px)");
    const events = record(list);
    expect(world.listeners.dimensions.size).toBe(1); // a turn changes the screen too, and Dimensions says so
    resize(world, { width: 891, height: 411 });
    expect(events.map((event) => event.matches)).toEqual([true]);
  });

  test("a viewport unit follows the window, and a turn flips it", () => {
    const list = mm("(min-height: 100vw)");
    const events = record(list);
    expect(list.matches).toBe(true);
    resize(world, { width: 891, height: 411 });
    expect(events.map((event) => event.matches)).toEqual([false]);
    expect(mm("(min-width: -1px)").matches).toBe(true);
  });
});
