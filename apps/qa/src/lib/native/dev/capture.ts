import { Directory, File, Paths } from "expo-file-system";
import type { Presentation } from "expo-svelte";
import { qaModule, type BuildIdentity } from "./qa.ts";

/**
 * The iOS side of the parity and accessibility suites (`apps/qa/qa`, "iOS"): nothing outside the process can take an iOS
 * app's screenshot or read its accessibility tree, so the lab does both of itself. `run=capture:<ids>` visits each screen in
 * turn, takes its screenshot until two in a row are identical, dumps the accessibility tree, and writes both into
 * `Documents/capture` with an `index.json` the harness reads through `devicectl device copy from`.
 */

/** How to reach a screen: the route (`goto`), the route to stand on first when the screen is pushed or presented over another (`base`), and how it is presented. */
export type CaptureSpec = { goto: string; base?: string; presentation?: Presentation };

const lab = "/__dev";
const screens = `${lab}/screens`;
const tree = `${lab}/tree`;
export const captureSpecs: Record<string, CaptureSpec> = {
  "dev-checks": { goto: `${lab}?panel=checks` },
  "dev-binding": { goto: `${lab}?panel=binding` },
  "dev-rows": { goto: `${lab}?panel=rows` },
  "dev-async": { goto: `${lab}?panel=async` },
  "dev-async-loading": { goto: `${lab}?panel=async&state=pending` },
  "dev-async-error": { goto: `${lab}?panel=async&state=error` },
  "dev-animation": { goto: `${lab}?panel=animation` },
  // Pushed screens sit on the lab page, as they do when the app opens them from a link, so they have a screen to go back to.
  "lab-screen": { base: lab, goto: `${lab}/screen` },
  "html-elements": { base: lab, goto: `${lab}/html` },
  "transitions": { base: lab, goto: `${lab}/transitions` },
  "screens-menu": { base: lab, goto: screens },
  "screens-header": { base: lab, goto: `${screens}?mode=header&depth=1` },
  "screens-slots": { base: lab, goto: `${screens}?mode=slots` },
  "screens-translucent": { base: lab, goto: `${screens}?mode=translucent` },
  "screens-tabs": { base: lab, goto: `${screens}?mode=tabs` },
  "screens-toolbar": { base: lab, goto: `${screens}?mode=toolbar` },
  "screens-toolbar-center": { base: lab, goto: `${screens}?mode=toolbar-center` },
  // The route-tree lab: a tabs navigator over the lab page; the sheet is a screen of the inbox pane's own stack.
  "tree-home": { base: lab, goto: tree },
  "tree-detail": { base: lab, goto: `${tree}/home/detail/7` },
  "tree-inbox": { base: lab, goto: `${tree}/inbox` },
  "tree-compose": { base: `${tree}/inbox`, goto: `${tree}/inbox/compose`, presentation: "sheet" },
  "screens-sheet": { base: screens, goto: `${screens}?mode=sheet`, presentation: "sheet" },
  "screens-sheet-auto": { base: screens, goto: `${screens}?mode=auto`, presentation: "sheet" },
  "screens-form-sheet": { base: screens, goto: `${screens}?mode=form`, presentation: "formSheet" },
  "screens-modal": { base: screens, goto: `${screens}?mode=header&depth=1`, presentation: "modal" },
};

type Router = { goto(href: string, options?: { reset?: boolean; presentation?: Presentation }): void };
export type Theme = "light" | "dark";

export type CaptureEntry = {
  /** `<screen>--<theme>` */
  name: string;
  screen: string;
  theme: Theme;
  /** What the window reported: right-to-left layout (the launch's language decides it). */
  rtl: boolean | null;
  png: string | null;
  a11y: string | null;
  /** The view controllers' state (`uikitState`): UIKit's own chrome (title, back button, tab bar items) is not in the dump above. */
  uikit: string | null;
  width: number | null;
  height: number | null;
  scale: number | null;
  sha256: string | null;
  /** Screenshots taken until two in a row had the same bytes. */
  attempts: number | null;
  stable: boolean;
  /** Frames (points) of the views that move on their own: spinners and the lab's `qa-mask` views. */
  moving: number[][];
  /** Frames (points) of the system's glass chrome in the window: UIKit draws their edges slightly differently from launch to launch, so the parity suite masks the edges. */
  glass: number[][];
  /** Frames (points) of presented sheets' cards: their rim and shadow are the system's too. */
  sheets: number[][];
  error: string | null;
};
export type CaptureIndex = { schema: 1; token: string | null; build: BuildIdentity; startedAt: string; finishedAt: string | null; done: boolean; themes: Theme[]; entries: CaptureEntry[]; error: string | null };

const pause = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });
const plain = (uri: string) => uri.replace(/^file:\/\//, "");

/** Visits `ids` in every theme and writes the results; resolves when `index.json` says `done`. */
export async function runCapture(router: Router, ids: readonly string[], themes: readonly Theme[], token: string | null): Promise<void> {
  const qa = qaModule;
  if (!qa?.enabled) throw new Error("SvelteQA is not available in this build; capture runs only in the QA app on iOS");
  const directory = new Directory(Paths.document, "capture");
  if (directory.exists) directory.delete();
  directory.create({ intermediates: true, idempotent: true });
  const index: CaptureIndex = { schema: 1, token, build: await qa.buildIdentity(), startedAt: new Date().toISOString(), finishedAt: null, done: false, themes: [...themes], entries: [], error: null };
  const save = () => new File(directory, "index.json").write(JSON.stringify(index));
  save();
  try {
    for (const theme of themes) {
      await qa.setInterfaceStyle(theme);
      await pause(400);
      for (const screen of ids) {
        const entry = await captureScreen(router, qa, directory, screen, theme);
        index.entries.push(entry);
        save();
      }
    }
  } catch (error) {
    index.error = error instanceof Error ? error.message : String(error);
  } finally {
    await qa.setInterfaceStyle("unspecified");
    index.done = true;
    index.finishedAt = new Date().toISOString();
    save();
  }
}

type StateNode = { children?: StateNode[]; presented?: StateNode; sheet?: { presentedViewFrame?: number[] | null; cardFrame?: number[] | null } };

/** The cards of the presented sheets in a `uikitState` snapshot, in points: the system draws their rim and shadow a level differently from launch to launch. */
function sheetFrames(state: { root?: StateNode }): number[][] {
  const frames: number[][] = [];
  const walk = (node: StateNode | undefined) => {
    if (!node) return;
    const frame = node.sheet?.cardFrame ?? node.sheet?.presentedViewFrame;
    if (frame) frames.push(frame);
    for (const child of node.children ?? []) walk(child);
    walk(node.presented);
  };
  walk(state.root);
  return frames;
}

async function captureScreen(router: Router, qa: NonNullable<typeof qaModule>, directory: Directory, screen: string, theme: Theme): Promise<CaptureEntry> {
  const name = `${screen}--${theme}`;
  const entry: CaptureEntry = { name, screen, theme, rtl: null, png: null, a11y: null, uikit: null, width: null, height: null, scale: null, sha256: null, attempts: null, stable: false, moving: [], glass: [], sheets: [], error: null };
  const spec = captureSpecs[screen];
  if (!spec) return { ...entry, error: `no capture spec for ${screen}` };
  try {
    router.goto(spec.base ?? spec.goto, { reset: true });
    await pause(1300); // the previous screens leave, the new one is pushed and its content settles
    if (spec.base) {
      router.goto(spec.goto, { presentation: spec.presentation });
      await pause(1300);
    }
    const path = plain(new File(directory, `${name}.png`).uri);
    let previous = "";
    let attempts = 0;
    for (; attempts < 12;) {
      const shot = await qa.capture(path);
      attempts++;
      Object.assign(entry, { png: `${name}.png`, width: shot.width, height: shot.height, scale: shot.scale, sha256: shot.sha256 });
      if (shot.sha256 === previous) { entry.stable = true; break; }
      previous = shot.sha256;
      await pause(250);
    }
    entry.attempts = attempts;
    const tree = JSON.parse(await qa.accessibilityTree()) as { rtl?: boolean; movingViews?: { frame: number[] }[]; glassViews?: { frame: number[] }[] };
    entry.rtl = tree.rtl ?? null;
    entry.moving = (tree.movingViews ?? []).map((view) => view.frame);
    entry.glass = (tree.glassViews ?? []).map((view) => view.frame);
    new File(directory, `${name}.a11y.json`).write(JSON.stringify(tree));
    entry.a11y = `${name}.a11y.json`;
    const state = await qa.uikitState();
    new File(directory, `${name}.uikit.json`).write(state);
    entry.uikit = `${name}.uikit.json`;
    entry.sheets = sheetFrames(JSON.parse(state));
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  }
  return entry;
}
