import { requireOptionalNativeModule } from "expo-modules-core";
import { Directory, File, Paths } from "expo-file-system";
import { captureRef, releaseCapture, type CaptureOptions } from "@rasheed/svelte-native/foreign";
import Platform from "react-native/Libraries/Utilities/Platform";
import { libraryKinds, type Host, type LibraryHandles, type LibraryKind } from "./LibrarySet.svelte";
import { count, foreignEvents, foreignLab, libraryHandles, libraryLab, resetLibraryLab } from "./foreign.svelte.ts";
import { libraryChecks, type Ctx, type Look, type Native, type Rect, type Where } from "./foreign-libraries-checks.ts";

/**
 * The `foreign-libraries` stress scenario (SPEC.md, "Foreign views", "Device verification of the libraries"): each of the thirteen native-view
 * libraries is mounted in each of the three places the lab has (inline, a row of the windowed `List`, a native sheet) and checked there
 * (`foreign-libraries-checks.ts`): it mounts, a prop update changes the native view, it raises its events, its commands work. Every check is
 * logged on a line of its own (`[Svelte foreign library]`, which `qa/lib/foreign.ts` reads), and the scenario's result carries the failures.
 * The page is `/__dev/foreign?mode=libraries|libraries-list|libraries-sheet`; this file drives it through the router, `libraryLab` and `libraryHandles`.
 *
 * `foreign-leftovers` runs in the launch after it: the files the capture checks left behind in the cache directory belonged to a process that is
 * gone, and none may still be there.
 */
type Stats = Record<string, number>;
type Engine = {
  foreignStats?: (collect?: boolean) => Stats | null;
  inspect?: (tag: number) => Native | null;
  tap?: (x: number, y: number) => boolean;
};
type Sampled = { colors: number[]; width: number; height: number; format: string };
type Pixels = { sample(source: string, points: readonly (readonly [number, number])[], radius?: number): Sampled };
/** iOS: `SvelteQA` (`modules/svelte-qa-ios`) reads the same two things, under other names. */
type QaIos = { inspect?(tag: number): Native | null; samplePixels?(source: string, points: readonly (readonly [number, number])[], radius?: number): Sampled };
type Router = { goto(href: string, options?: { presentation?: "sheet" }): void; back(): boolean; entries: readonly unknown[] };
export type LibraryCheck = { library: LibraryKind; where: Where; name: string; passed: boolean; detail: string };
export type LibrarySkip = { library: LibraryKind; where: Where; name: string; why: string };
export type LibrariesOutcome = { passed: boolean; summary: string; detail: Record<string, unknown> };

const engine = requireOptionalNativeModule<Engine>("SvelteEngine");
const android = Platform.OS === "android";
const qaIos = android ? null : requireOptionalNativeModule<QaIos>("SvelteQA");
const pixels: Pixels | null = android ? requireOptionalNativeModule<Pixels>("SvelteQaPixels") : qaIos?.samplePixels ? { sample: (source, points, radius) => qaIos.samplePixels?.(source, points, radius) as Sampled } : null;
const inspectTag = (tag: number): Native | null => (android ? engine?.inspect?.(tag) : qaIos?.inspect?.(tag)) ?? null;
const places: readonly Where[] = ["inline", "row", "sheet"];
/** The file of the captures a launch leaves for the next one to find gone. */
const leftoverFile = () => new File(Paths.document, "foreign-leftovers.json");

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
async function until(test: () => boolean, milliseconds: number, signal: AbortSignal): Promise<boolean> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end && !signal.aborted) {
    if (test()) return true;
    await pause(50, signal);
  }
  return test();
}
const rectOf = (host: Host | undefined): Promise<Rect | null> => new Promise<Rect | null>((resolve) => {
  if (!host) { resolve(null); return; }
  const timer = setTimeout(resolve, 2000, null);
  host.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ x, y, width, height }); });
});

/** Where each place is opened: the page, how it is shown, and the name its section records events under. */
function place(kind: LibraryKind, where: Where): { href: string; sheet: boolean; source: string; index: number } {
  const index = libraryKinds.indexOf(kind);
  if (where === "inline") return { href: `/__dev/foreign?mode=libraries&kind=${kind}`, sheet: false, source: "libraries", index };
  if (where === "row") return { href: "/__dev/foreign?mode=libraries-list", sheet: false, source: `libraries-row-${index}`, index };
  return { href: `/__dev/foreign?mode=libraries-sheet&kind=${kind}`, sheet: true, source: "libraries-sheet", index };
}

export async function runForeignLibraries(router: Router, signal: AbortSignal, only?: readonly LibraryKind[], driven = false): Promise<LibrariesOutcome> {
  const checks: LibraryCheck[] = [];
  const skips: LibrarySkip[] = [];
  const depth = router.entries.length;
  const baseline = engine?.foreignStats?.(true) ?? null;
  foreignEvents.length = 0;
  resetLibraryLab();

  for (const kind of only ?? libraryKinds) {
    for (const where of places) {
      if (signal.aborted) break;
      const opened = place(kind, where);
      const record = (name: string, passed: boolean, detail = "") => {
        // One logcat line is cut near 4 KB: a check's own line stays far under it.
        const entry: LibraryCheck = { library: kind, where, name: name.slice(0, 200), passed, detail: detail.slice(0, 300) };
        checks.push(entry);
        console.info("[Svelte foreign library]", JSON.stringify(entry));
      };
      const skip = (name: string, why: string) => {
        skips.push({ library: kind, where, name, why });
        console.info("[Svelte foreign library skipped]", JSON.stringify({ library: kind, where, name, why }));
      };
      const released: string[] = [];
      resetLibraryLab();
      foreignEvents.length = 0;
      let handlesNow: LibraryHandles | undefined;
      const ctx: Ctx = {
        kind, where, source: opened.source, android,
        canInspect: android ? typeof engine?.inspect === "function" : typeof qaIos?.inspect === "function",
        canLook: !!pixels,
        driven,
        press: (id, resourceId) => { console.info("[Svelte foreign press]", JSON.stringify({ id, resourceId })); },
        lab: libraryLab,
        handles: () => { handlesNow = libraryHandles.get(opened.source) ?? handlesNow; if (!handlesNow) throw new Error(`the ${kind} section is not mounted in ${where}`); return handlesNow; },
        host: () => libraryHandles.get(opened.source)?.hosts[kind],
        box: () => libraryHandles.get(opened.source)?.boxes[kind],
        check: (name, passed, detail) => record(`${where}: ${name}`, passed, detail),
        skip: (name, why) => skip(`${where}: ${name}`, why),
        until: (test, milliseconds) => until(test, milliseconds, signal),
        pause: (milliseconds) => pause(milliseconds, signal),
        events: (event, detail) => count(opened.source, event, detail),
        inspect: (host) => {
          const target = host ?? libraryHandles.get(opened.source)?.hosts[kind];
          if (!target) return null;
          for (let attempt = 0; attempt < 3; attempt++) { const found = inspectTag(target.tag); if (found) return found; }
          return null;
        },
        rect: (host) => rectOf(host ?? libraryHandles.get(opened.source)?.hosts[kind]),
        point: async (host, fx, fy) => {
          const [inner, outer] = await Promise.all([rectOf(host), rectOf(libraryHandles.get(opened.source)?.boxes[kind])]);
          if (!inner || !outer || outer.width <= 0 || outer.height <= 0) return null;
          return [(inner.x + inner.width * fx - outer.x) / outer.width, (inner.y + inner.height * fy - outer.y) / outer.height];
        },
        tap: async (host) => {
          const rect = await rectOf(host ?? libraryHandles.get(opened.source)?.hosts[kind]);
          return !!rect && !!engine?.tap && engine.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
        },
        shot: async (options?: CaptureOptions, target?: Host, kept = false) => {
          const view = target ?? libraryHandles.get(opened.source)?.boxes[kind];
          const uri = await captureRef(view, { format: "png", result: "tmpfile", ...options });
          if (!kept) released.push(uri);
          return uri;
        },
        look: async (points, options) => {
          if (!pixels) return null;
          const uri = await ctx.shot(options?.capture, options?.target);
          const read = pixels.sample(uri, points, options?.radius ?? 1);
          return { ...read, uri } satisfies Look;
        },
        read: (source, points = [[0.5, 0.5]], radius = 1) => (pixels ? pixels.sample(source, points, radius) : null),
        leave: (uri) => { try { const file = leftoverFile(); const known = file.exists ? (JSON.parse(file.textSync()) as string[]) : []; file.write(JSON.stringify([...known, uri])); } catch { /* the next launch finds nothing to check */ } },
        exists: (uri) => { try { return new File(uri).exists; } catch { return false; } },
      };

      try {
        router.goto(opened.href, opened.sheet ? { presentation: "sheet" } : undefined);
        if (where === "row") foreignLab.scrollIndex = opened.index;
        const mounted = await until(() => libraryHandles.has(opened.source), 10000, signal);
        record(`${where}: the section opens`, mounted);
        if (mounted) {
          await pause(where === "sheet" ? 900 : 500, signal);
          await libraryChecks[kind](ctx);
        }
      } catch (error) {
        record(`${where}: the checks ran to the end`, false, error instanceof Error ? `${error.message}` : String(error));
      }
      for (const uri of released) { try { releaseCapture(uri); } catch { /* already gone */ } }
      resetLibraryLab();
      if (router.entries.length > depth) router.back();
      foreignLab.scrollIndex = -1;
      await until(() => !libraryHandles.has(opened.source) && router.entries.length === depth, 6000, signal);
      await pause(400, signal);
      const stats = engine?.foreignStats?.(true) ?? null;
      if (stats && baseline) record(`${where}: leaving drops every frame and node`, stats.frames === baseline.frames && stats.nodes === baseline.nodes && stats.waiting === 0 && stats.registryLeaks === 0, JSON.stringify(stats));
    }
  }

  const failed = checks.filter((entry) => !entry.passed);
  const perLibrary: Record<string, { checks: number; failed: number; skipped: number }> = {};
  for (const kind of libraryKinds) {
    const own = checks.filter((entry) => entry.library === kind);
    if (own.length === 0 && !skips.some((entry) => entry.library === kind)) continue;
    perLibrary[kind] = { checks: own.length, failed: own.filter((entry) => !entry.passed).length, skipped: skips.filter((entry) => entry.library === kind).length };
  }
  return {
    passed: failed.length === 0,
    summary: `${checks.length - failed.length} / ${checks.length} checks, ${skips.length} skipped${failed.length ? ` · FAILED ${failed.length}: ${failed.slice(0, 6).map((entry) => `${entry.library} ${entry.name}`.slice(0, 48)).join(" | ")}` : ""}`,
    detail: { libraries: perLibrary, failed: failed.slice(0, 12).map((entry) => `${entry.library} ${entry.name}`.slice(0, 120)), skipped: skips.length },
  };
}

/**
 * The launch after `foreign-libraries`: the files its capture checks left in the cache directory ("`tmpfile`: a file that lasts until the app exits")
 * were made by a process that is gone, so none of them (and no `ReactNative-snapshot-image*` file at all) may be there now. The first launch on a
 * device has nothing to find; a launch that finds files was not cleaned after.
 */
export async function runForeignLeftovers(): Promise<LibrariesOutcome> {
  const checks: LibraryCheck[] = [];
  const record = (name: string, passed: boolean, detail = "") => {
    const entry: LibraryCheck = { library: "capture", where: "inline", name, passed, detail };
    checks.push(entry);
    console.info("[Svelte foreign library]", JSON.stringify(entry));
  };
  let known: string[] = [];
  try { const file = leftoverFile(); if (file.exists) known = JSON.parse(file.textSync()) as string[]; } catch { known = []; }
  const alive = known.filter((uri) => { try { return new File(uri).exists; } catch { return false; } });
  record("a previous launch's tmpfile captures are gone after its process died", alive.length === 0, `${known.length} left by the last launch, ${alive.length} still there`);
  const others = (() => { try { return new Directory(Paths.cache).list().map((item) => item.name).filter((name) => name.startsWith("ReactNative-snapshot-image")); } catch { return []; } })();
  record("no ReactNative-snapshot-image file is in the cache directory at the start of a launch", others.length === 0, `${others.length} found: ${others.slice(0, 3).join(", ")}`);
  try { leftoverFile().write("[]"); } catch { /* nothing to clear */ }
  const failed = checks.filter((entry) => !entry.passed);
  return { passed: failed.length === 0, summary: `${checks.length - failed.length} / ${checks.length} checks`, detail: { libraries: { capture: { checks: checks.length, failed: failed.length, skipped: 0 } }, failed: failed.map((entry) => entry.name) } };
}
