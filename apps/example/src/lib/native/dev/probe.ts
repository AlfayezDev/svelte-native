import { Directory, File, Paths } from "expo-file-system";
import type { Presentation } from "@rasheed/svelte-native";
import { qaModule, type SvelteQA, type BuildIdentity } from "./qa.ts";

/**
 * Device probes for the native screens on iOS (`run=probe:<names>`): each puts a screen in a state, does what a user would
 * through `SvelteQA` (scroll, type into the search field, move a sheet to a detent, escape, focus a text field) and writes what
 * UIKit and the accessibility tree say about it to `Documents/probe/<name>.json`, with a screenshot beside it. They check the
 * behaviour the contract lists (SPEC.md, "What iOS must do (NI)") that a lab scenario cannot see; the verdicts are in the SPEC.
 */

type Router = {
  goto(href: string, options?: { reset?: boolean; presentation?: Presentation }): void;
  back(): boolean;
  readonly entries: readonly unknown[];
};

const pause = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });
const plain = (uri: string) => uri.replace(/^file:\/\//, "");
const screens = "/__dev/screens";

type Step = { name: string; [key: string]: unknown };

type Context = { router: Router; qa: SvelteQA; directory: Directory; steps: Step[]; log: (step: Step) => void };

const state = async (context: Context): Promise<unknown> => JSON.parse(await context.qa.uikitState());

/** How many controllers are presented over the app's root controller, from a `uikitState` snapshot. */
function presentedCount(snapshot: unknown): number {
  let count = 0;
  const walk = (node: { children?: unknown[]; presented?: unknown } | undefined) => {
    if (!node) return;
    for (const child of node.children ?? []) walk(child as typeof node);
    if (node.presented) { count += 1; walk(node.presented as typeof node); }
  };
  walk((snapshot as { root?: Parameters<typeof walk>[0] }).root);
  return count;
}

async function shot(context: Context, name: string): Promise<string> {
  const file = `${name}.png`;
  await context.qa.capture(plain(new File(context.directory, file).uri));
  return file;
}

async function open(context: Context, base: string, goto?: string, presentation?: Presentation) {
  context.router.goto(base, { reset: true });
  await pause(1300);
  if (goto) {
    context.router.goto(goto, { presentation });
    await pause(1300);
  }
}

/** Presents a screen over the menu, then takes it away with a reset of the stack or a back, and reports what is presented after 0.3, 1.5 and 3.2 seconds. */
async function takeAway(context: Context, name: string, goto: string, presentation: Presentation, how: "reset" | "back") {
  await open(context, screens, goto, presentation);
  const presentedBefore = presentedCount(await state(context));
  if (how === "reset") context.router.goto(screens, { reset: true });
  else context.router.back();
  for (const wait of [300, 1200, 1700]) {
    await pause(wait);
    const after = await state(context);
    context.log({ name: `${name} ${how} +${wait}`, presentedBefore, entries: context.router.entries.length, presentedAfter: presentedCount(after), stacks: (after as { stacks?: unknown }).stacks });
  }
}

const probes: Record<string, (context: Context) => Promise<void>> = {
  /** A large title expands at rest and collapses over its 52 pt as the first scroll view scrolls; the offset JavaScript sees is 0 at rest. */
  async "large-title"(context) {
    await open(context, "/__dev", `${screens}`);
    context.log({ name: "rest", state: await state(context), shot: await shot(context, "large-title-rest") });
    for (const y of [20, 52, 120]) {
      const scroll = await context.qa.scrollTo(y);
      await pause(500);
      context.log({ name: `scrolled ${y}`, scroll, state: await state(context), shot: await shot(context, `large-title-${y}`) });
    }
    // The title expands again when the offset returns to the expanded rest, 72 pt (the large title's extra height) above the collapsed one.
    context.log({ name: "back to rest", scroll: await context.qa.scrollTo(-72), state: await state(context), shot: await shot(context, "large-title-back") });
  },

  /** A translucent header lets content run under the bar; the scroll edge appearance is transparent. */
  async translucent(context) {
    await open(context, "/__dev", `${screens}?mode=translucent`);
    context.log({ name: "rest", state: await state(context), shot: await shot(context, "translucent-rest") });
    context.log({ name: "scrolled 200", scroll: await context.qa.scrollTo(200), shot: await shot(context, "translucent-200"), state: await state(context) });
  },

  /** The search slot: a search controller in the bar, the results shown while it is active. */
  async search(context) {
    await open(context, "/__dev", `${screens}?mode=slots`);
    context.log({ name: "rest", state: await state(context), shot: await shot(context, "search-rest") });
    context.log({ name: "typed a", typed: await context.qa.typeSearch("a"), state: await state(context), shot: await shot(context, "search-a") });
    await pause(600);
    const typed = await context.qa.typeSearch("Dana");
    await pause(900);
    context.log({ name: "typed dana", typed, shot: await shot(context, "search-dana"), a11y: JSON.parse(await context.qa.accessibilityTree()) });
  },

  /** A two-detent sheet: its detents resolve to 40 % and 90 % of the space below the top inset; its scroll view scrolls before the sheet moves. */
  async sheet(context) {
    await open(context, screens, `${screens}?mode=sheet`, "sheet");
    context.log({ name: "presented", state: await state(context), shot: await shot(context, "sheet-presented") });
    context.log({ name: "detent 1", sheet: await context.qa.selectDetent(1), shot: await shot(context, "sheet-detent-1") });
    context.log({ name: "scrolled inside", scroll: await context.qa.scrollTo(120), state: await state(context), shot: await shot(context, "sheet-scrolled") });
    context.log({ name: "detent 0", sheet: await context.qa.selectDetent(0), shot: await shot(context, "sheet-detent-0") });
  },

  /** The system's escape (VoiceOver's two-finger scrub) on a form sheet, a modal, a sheet and a pushed screen dismisses them as a user would: JavaScript hears `onDismiss` and the stack follows. */
  async dismissal(context) {
    for (const [name, goto, presentation] of [
      ["form sheet", `${screens}?mode=form`, "formSheet"],
      ["modal", `${screens}?mode=header&depth=1`, "modal"],
      ["sheet", `${screens}?mode=sheet`, "sheet"],
      ["pushed screen", `${screens}?mode=header&depth=2`, undefined],
    ] as const) {
      await open(context, screens, goto, presentation);
      const before = context.router.entries.length;
      const escaped = await context.qa.escape();
      await pause(1500);
      const after = await state(context);
      context.log({ name, escaped, entriesBefore: before, entriesAfter: context.router.entries.length, presentedAfter: presentedCount(after), state: after });
    }
  },

  /** A reset of the stack while a form sheet, a modal (full screen: UIKit takes the stack's view out of the window) or a sheet is presented takes it away. */
  async "reset-form"(context) { await takeAway(context, "form sheet", `${screens}?mode=form`, "formSheet", "reset"); },
  async "reset-modal"(context) { await takeAway(context, "modal", `${screens}?mode=header&depth=1`, "modal", "reset"); },
  async "reset-sheet"(context) { await takeAway(context, "sheet", `${screens}?mode=sheet`, "sheet", "reset"); },
  /** `router.back()` over the same three: what a close button does. */
  async "back-form"(context) { await takeAway(context, "form sheet", `${screens}?mode=form`, "formSheet", "back"); },
  async "back-modal"(context) { await takeAway(context, "modal", `${screens}?mode=header&depth=1`, "modal", "back"); },
  async "back-sheet"(context) { await takeAway(context, "sheet", `${screens}?mode=sheet`, "sheet", "back"); },

  /** Tabs with snippet icons and badges: titles, badge values, images and the bar's direction. */
  async tabs(context) {
    await open(context, "/__dev", `${screens}?mode=tabs`);
    context.log({ name: "tabs", state: await state(context), shot: await shot(context, "tabs") });
  },

  /** The tabs screen mounted and unmounted thirty times: the unmount of a tab with a snippet icon aborted the app (27 Oct). */
  async "tabs-churn"(context) {
    await open(context, "/__dev");
    for (let round = 0; round < 30; round++) {
      context.router.goto(`${screens}?mode=tabs`);
      await pause(500);
      context.router.back();
      await pause(700);
    }
    context.log({ name: "tabs-churn", rounds: 30, entries: context.router.entries.length, state: await state(context) });
  },

  /** A text field at the bottom of a KeyboardAvoidingView: focusing it brings the keyboard up; the field must end up above it. */
  async keyboard(context) {
    await open(context, "/__dev", `${screens}?mode=keyboard`);
    context.log({ name: "before", state: await state(context), shot: await shot(context, "keyboard-before") });
    const focus = await context.qa.focusTextInput();
    await pause(800);
    context.log({ name: "focused", focus, state: await state(context), shot: await shot(context, "keyboard-focused"), a11y: JSON.parse(await context.qa.accessibilityTree()) });
    await context.qa.blur();
    await pause(800);
    context.log({ name: "blurred", shot: await shot(context, "keyboard-blurred") });
  },

  /** The same field in a form sheet, which does not resize for the keyboard by itself. */
  async "keyboard-sheet"(context) {
    await open(context, screens, `${screens}?mode=form`, "formSheet");
    const focus = await context.qa.focusTextInput();
    await pause(800);
    context.log({ name: "focused", focus, state: await state(context), shot: await shot(context, "keyboard-sheet-focused") });
    await context.qa.blur();
  },
};

export const probeNames = Object.keys(probes);

/** Runs the named probes; every result and an `index.json` land in `Documents/probe`. */
export async function runProbes(router: Router, names: readonly string[], token: string | null): Promise<void> {
  const qa = qaModule;
  if (!qa?.enabled) throw new Error("SvelteQA is not available in this build; probes run only in the QA app on iOS");
  const directory = new Directory(Paths.document, "probe");
  if (directory.exists) directory.delete();
  directory.create({ intermediates: true, idempotent: true });
  const index: { token: string | null; build: BuildIdentity; done: boolean; probes: { name: string; error: string | null; file: string }[] } = { token, build: await qa.buildIdentity(), done: false, probes: [] };
  const save = () => new File(directory, "index.json").write(JSON.stringify(index));
  save();
  for (const name of names) {
    const steps: Step[] = [];
    const run = probes[name];
    let error: string | null = null;
    try {
      if (!run) throw new Error(`no probe called ${name} (${probeNames.join(", ")})`);
      await run({ router, qa, directory, steps, log: (step) => steps.push(step) });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    new File(directory, `${name}.json`).write(JSON.stringify({ name, error, steps }));
    index.probes.push({ name, error, file: `${name}.json` });
    save();
  }
  index.done = true;
  save();
}
