import { tick } from "svelte";
import { builtOf, type HtmlNode } from "./html-checks.ts";
import { expectations, times, transitionCheckNames, type Settled, type Verdict } from "./transition-checks.ts";

/**
 * The transition checks of the native checks lab (`/__dev`, "Run all checks", after the HTML checks): the elements of `TransitionsScreen.svelte` are shown, hidden, shuffled and opened, and what the host and
 * Reanimated did to them is read on the device (`transition-checks.ts` says which reads). Nothing here plays an animation or works out a frame: the screen's own `in:`, `out:`, `transition:` and `animate:` run
 * through the host's animation layer, and each check reads its state: `getAnimations()` and the progress it reports, the animation state the host keeps on the node, the props it built the view with, and
 * the committed tree's box of the view from `nativeFabricUIManager`, with and without the transform that Reanimated's last values put over it.
 *
 * The progress signal of the last check is the one the host itself uses: `Playback.currentTime` of an animation is the value of its shared value, which the UI runtime moves and a read from JavaScript asks
 * the UI runtime for. The lab's own check of the runtime (`verifyAnimation`, `+mobile.svelte`) is the same measure with a shared value of its own; this one is the shared value of a real transition.
 */

/** What `TransitionsScreen.svelte` hands out. */
export type TransitionProbeHandle = {
  node(name: string): unknown;
  seen(): readonly string[];
  items(): readonly number[];
  setShown(value: boolean): void;
  setOpen(value: boolean): void;
  shuffle(): void;
};
type Report = (name: string, passed: boolean, detail?: string) => void;

type Box = readonly number[];
type Animation = { playState: string; currentTime: number | null };
/** The part of the renderer's `NativeNode` the checks read: the animations and the layout read of the public API, the state the host keeps for it, and `parent` for whether it is still in the tree. */
type AnimatedNode = {
  parent: unknown;
  hostState: unknown;
  dom: { animation?: { entries?: readonly unknown[]; restore?: unknown; updater?: unknown } | null } | null;
  getAnimations(): readonly Animation[];
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
};
type Binding = { getBoundingClientRect?(node: unknown, includeTransform: boolean): Box | undefined };

const itemNames = [1, 2, 3, 4].map((id) => `item-${id}`);
const settle = async () => { await tick(); await Promise.resolve(); await tick(); };
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
/** Waits (in steps of one frame) until [condition] holds; whether it did within [timeout] ms. */
async function until(condition: () => boolean, timeout: number): Promise<boolean> {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= end) return false;
    await sleep(16);
  }
  return true;
}
/** Blocks the JavaScript thread for [ms] ms, the way the lab's check of the UI runtime does. */
function block(ms: number): void {
  const end = Date.now() + ms;
  let checksum = 0;
  while (Date.now() < end) checksum = Math.imul(checksum + 1, 1664525);
  void checksum;
}

const binding = (): Binding | undefined => (globalThis as { nativeFabricUIManager?: Binding }).nativeFabricUIManager;
/** The committed tree's box of the node's view, with or without the committed transform (React Native's synchronous layout read, the one the host's own `getBoundingClientRect` is made from). */
function committed(node: AnimatedNode, includeTransform: boolean): Box | null {
  const handle = (node.hostState as { node?: unknown } | null | undefined)?.node;
  const read = binding()?.getBoundingClientRect;
  return handle && read ? read.call(binding(), handle, includeTransform) ?? null : null;
}
/** How far the committed box with the committed transform is from the one without it, in px: zero when the node's committed transform is identity. */
function moved(node: AnimatedNode): number | null {
  node.getBoundingClientRect(); // a layout read commits what is pending first, as Svelte's own reads do
  const drawn = committed(node, true);
  const laid = committed(node, false);
  return drawn && laid && drawn.length >= 4 && laid.length >= 4 ? Math.max(...[0, 1, 2, 3].map((at) => Math.abs((drawn[at] as number) - (laid[at] as number)))) : null;
}
/** How far the node is drawn from its layout box now: the host's own read (the layout box moved by what the node's animations draw) against the committed box without a transform. */
function drawnOff(node: AnimatedNode): number {
  const laid = committed(node, false);
  const box = node.getBoundingClientRect();
  return laid ? Math.max(Math.abs(box.x - (laid[0] as number)), Math.abs(box.y - (laid[1] as number))) : 0;
}
/** The progress of the node's running animations in ms (the shared value, read from the UI runtime), the furthest one; null when none runs. */
function progress(node: AnimatedNode): number | null {
  const running = node.getAnimations().filter((animation) => animation.playState === "running" && animation.currentTime !== null);
  return running.length === 0 ? null : Math.max(...running.map((animation) => animation.currentTime as number));
}
const animationState = (node: AnimatedNode) => node.dom?.animation ?? null;
const restoring = (node: AnimatedNode): boolean => (animationState(node)?.restore ?? null) !== null;

function settledOf(node: AnimatedNode): Settled {
  const built = builtOf(node as unknown as HtmlNode);
  const state = animationState(node);
  return {
    animations: node.getAnimations().length,
    drawing: state?.entries?.length ?? 0,
    restoring: restoring(node),
    // The host marks a view that an animation draws (`collapsable: false`, and the worklet's updater): both go when the animations are over.
    animated: built?.props.collapsable === false || (state?.updater ?? null) !== null,
    opacity: built?.style.opacity,
    transform: built?.style.transform,
    moved: moved(node),
  };
}

export async function runTransitionChecks(probe: TransitionProbeHandle | undefined, report: Report): Promise<void> {
  const present = (name: string) => typeof (probe?.node(name) as AnimatedNode | undefined)?.getAnimations === "function";
  const missing = probe ? itemNames.filter((name) => !present(name)) : [...itemNames];
  if (!probe || missing.length > 0) {
    // Each check still reports, so that a screen that did not mount is that many failures and not a count that quietly fell.
    for (const name of transitionCheckNames) report(name, false, `the screen's elements are not mounted: ${missing.join(", ")}`);
    return;
  }
  const node = (name: string): AnimatedNode | undefined => probe.node(name) as AnimatedNode | undefined;
  const count = (event: string) => probe.seen().filter((seen) => seen === event).length;
  const [intro, outro, flip, reversed, busy] = transitionCheckNames;
  const outcomes = new Map<string, Verdict>();
  const mounted = async (name: string) => { await until(() => node(name) !== undefined, 1000); return node(name); };

  // The card is shown: `in:fade` plays, and when it is over the element is its own again.
  const introEnds = count("fader introend");
  probe.setShown(true);
  await settle();
  const fader = await mounted("fader");
  if (fader) {
    await until(() => count("fader introend") > introEnds, times.fade + 3000);
    // The animation is cancelled when Svelte hears it end, and the host writes the node's own values back, takes its worklet away and lets Reanimated's last values of it go, over a few frames.
    await until(() => fader.getAnimations().length === 0 && !restoring(fader), 1500);
    await sleep(150);
  }
  outcomes.set(intro, expectations.intro(count("fader introend") - introEnds, fader ? settledOf(fader) : null));

  // The card is hidden: `out:fly` keeps it in the tree for its duration and then removes it.
  const outroEnds = count("fader outroend");
  if (fader) {
    const hiddenAt = Date.now();
    probe.setShown(false);
    await settle();
    await sleep(Math.max(0, hiddenAt + times.fly / 2 - Date.now()));
    const attached = fader.parent !== null;
    const gone = await until(() => fader.parent === null, times.fly + 1500);
    const elapsed = gone ? Date.now() - hiddenAt : null;
    await sleep(100);
    outcomes.set(outro, expectations.outro(attached, count("fader outroend") - outroEnds, elapsed, times.fly));
  } else outcomes.set(outro, { passed: false, detail: "the card did not mount" });

  // The list is shuffled: `animate:flip` moves each item from where it was, and when it is over every item is in its place and untransformed.
  const items = itemNames.map((name) => node(name) as AnimatedNode);
  const shuffledAt = Date.now();
  probe.shuffle();
  await settle();
  const expected = [...probe.items()];
  const played = await until(() => items.some((item) => drawnOff(item) > 4), times.flip * 0.6);
  await until(() => items.every((item) => item.getAnimations().length === 0), times.flip + 3000 - (Date.now() - shuffledAt));
  await until(() => items.every((item) => !restoring(item)), 1500);
  await sleep(150);
  const places = items.map((item, at) => ({ id: at + 1, item, y: committed(item, false)?.[1] ?? Number.NaN }));
  const got = [...places].sort((a, b) => a.y - b.y).map((place) => place.id);
  outcomes.set(flip, expectations.flip(played, places.map(({ id, item }) => ({ id, animations: item.getAnimations().length, moved: moved(item) })), expected, got));

  // The panel opens with `transition:slide` and is closed again half way: the same transition goes back from where it is, the node leaves, and nothing is left to be written back to it.
  probe.setOpen(true);
  await settle();
  const panel = await mounted("panel");
  if (panel) {
    await until(() => (progress(panel) ?? 0) >= 0.15 * times.slide, 3000);
    const at = progress(panel);
    const midway = at !== null && at > 0 && at < times.slide;
    const panelEnds = count("panel outroend");
    probe.setOpen(false);
    await settle();
    const removed = await until(() => panel.parent === null, times.slide + 2000);
    await sleep(250);
    outcomes.set(reversed, expectations.reversed(midway, count("panel outroend") - panelEnds, removed, restoring(panel)));
  } else outcomes.set(reversed, { passed: false, detail: "the panel did not mount" });

  // The panel opens again, and the JavaScript thread is blocked for 300 ms while its animation runs: the progress is the UI runtime's, so it moves by as much as the time that passed.
  probe.setOpen(true);
  await settle();
  const sliding = await mounted("panel");
  if (sliding) {
    await until(() => (progress(sliding) ?? 0) >= 0.2 * times.slide, 3000);
    const before = progress(sliding);
    const start = Date.now();
    block(300);
    const after = progress(sliding);
    outcomes.set(busy, expectations.busy(before, after, Date.now() - start, times.slide));
    probe.setOpen(false);
    await settle();
    await until(() => sliding.parent === null, times.slide + 2000);
  } else outcomes.set(busy, { passed: false, detail: "the panel did not mount" });

  for (const name of transitionCheckNames) {
    const outcome = outcomes.get(name);
    report(name, outcome?.passed === true, outcome?.detail ?? "the check did not run");
  }
}
