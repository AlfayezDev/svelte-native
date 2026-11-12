// Demo mode: a screen opened with `?demo` in its link plays a short scripted interaction by itself, so a docs video can be recorded on a
// device without anyone touching it: `adb shell am start -a android.intent.action.VIEW -d "svelte-native:///layout?demo" <package>`
// (`xcrun simctl openurl booted "svelte-native:///layout?demo"` on iOS). Without the parameter nothing in here runs.
//
// A page reads its own link: the router gives every page `url` (the `URL` of its entry, query included) as a prop. So a screen writes
//
//   let { url }: { url: URL } = $props();
//   useDemo(() => url, [[() => (count = 3), 1500], [() => router.goto("/somewhere"), 2000]]);
//
// The script is a list of steps, `[run, pause]`: `run` does the thing (it may return a promise, which is awaited) and `pause` is how long
// to wait afterwards, in ms. A settle comes before the first step (the screen finishes arriving) and a hold after the last (the viewer
// sees the end state). The script logs `[demo] start <path>` and `[demo] end <path> after <ms> ms` to the console, which a recording tool
// can wait for (`adb logcat -s ReactNativeJS`).
import { onMount } from "svelte";

/** What to do, and how long to wait after it (ms; the script's `pause` option when left out). */
export type DemoStep = readonly [run: () => unknown, pause?: number];

export type DemoOptions = {
  /** Wait before the first step: the screen finishes arriving. */
  settle?: number;
  /** Wait after the last step: the viewer reads the end state. */
  hold?: number;
  /** The pause of a step that gives none. */
  pause?: number;
};

/** Waits `ms`: for a step that does several things in turn. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Types `text` into a field by setting its bound value one letter at a time, `perChar` ms apart: `typeInto((value) => (name = value), "Sam")`. */
export async function typeInto(set: (value: string) => void, text: string, perChar = 80): Promise<void> {
  for (let length = 1; length <= text.length; length++) {
    set(text.slice(0, length));
    await sleep(perChar);
  }
}

/** Whether a link asks for the demo: `?demo`, `?demo=1`, but not `?demo=0` or `?demo=false`. */
export function demoRequested(url: URL | undefined): boolean {
  const value = url?.searchParams.get("demo");
  return value !== null && value !== undefined && value !== "0" && value !== "false";
}

/**
 * Plays a script: the settle, then each step and its pause in order (a step that returns a promise is awaited first), then the hold.
 * `finished` resolves `true` when it got to the end, `false` when `stop()` cut it short, and rejects with what a step threw.
 */
export function playDemo(steps: readonly DemoStep[], { settle = 1000, hold = 1500, pause = 1000 }: DemoOptions = {}): { finished: Promise<boolean>; stop(): void } {
  let stopped = false;
  let wake: (() => void) | undefined;
  const wait = (ms: number) => stopped ? Promise.resolve() : new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  const run = async () => {
    await wait(settle);
    for (const [step, after = pause] of steps) {
      if (stopped) return false;
      await step();
      await wait(after);
    }
    if (stopped) return false;
    await wait(hold);
    return !stopped;
  };
  return { finished: run(), stop() { stopped = true; wake?.(); } };
}

/**
 * Plays `steps` once the calling component has mounted, when its link asks for the demo; does nothing else. Call it while the component
 * initialises. `url` is a function (`() => url`) so that a prop is read where it is used, as Svelte wants.
 */
export function useDemo(url: () => URL | undefined, steps: readonly DemoStep[], options?: DemoOptions): void {
  if (!demoRequested(url())) return;
  onMount(() => {
    const path = url()?.pathname ?? "";
    const started = Date.now();
    console.log(`[demo] start ${path}`);
    const demo = playDemo(steps, options);
    demo.finished
      .then((done) => console.log(`[demo] ${done ? "end" : "stopped"} ${path} after ${Date.now() - started} ms`))
      .catch((error: unknown) => console.error(`[demo] a step of ${path} failed`, error));
    return demo.stop;
  });
}

type ScrollHandle = { scrollTo(options: { x?: number; y?: number; animated?: boolean }): void };

/**
 * Scrolls a `ScrollView` or a `List` slowly, the way a person would show a screen: `ref` goes on the view (`ref={scroll.ref}`), and
 * `scroll.glide(to, ms)` moves it to the offset `to` (points) in `ms`, easing in and out, so a viewer can follow it. The platform's own
 * animated `scrollTo` is quick and not adjustable, so the glide writes an offset every frame instead.
 */
export function scroller() {
  let view: ScrollHandle | null = null;
  const at = { x: 0, y: 0 };
  return {
    ref: (handle: ScrollHandle | null) => { view = handle; },
    /** Scrolls to `to` along `axis` and resolves when it has arrived (at once if the view is gone). */
    async glide(to: number, ms = 1200, axis: "x" | "y" = "y"): Promise<void> {
      const from = at[axis];
      const started = Date.now();
      at[axis] = to;
      for (;;) {
        const progress = Math.min(1, (Date.now() - started) / ms);
        if (!view) return;
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - 2 * (1 - progress) * (1 - progress);
        view.scrollTo({ [axis]: from + (to - from) * eased, animated: false });
        if (progress === 1) return;
        await sleep(16);
      }
    },
    /** Scrolls to `to` at once (`animated`: with the platform's own, quicker animation), for a distance a glide would take too long over. */
    jump(to: number, animated = false, axis: "x" | "y" = "y"): void {
      at[axis] = to;
      view?.scrollTo({ [axis]: to, animated });
    },
  };
}
