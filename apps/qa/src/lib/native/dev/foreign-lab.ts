import { requireOptionalNativeModule } from "expo-modules-core";
import { count, foreignEvents, foreignHandles, foreignLab } from "./foreign.svelte.ts";
import type { Camera } from "@alfayez/svelte-native/foreign";
import type { Kind } from "./ForeignSet.svelte";

/**
 * The `foreign-views` stress scenario (SPEC.md, "Foreign views"): a WebView, a map with a marker and a video view mount,
 * update, take commands, raise events and take a tap natively, inline, in the windowed List and in a native sheet, and
 * twenty mount and unmount cycles of each leave no frame, node or React Native view behind. The views sit on the lab page
 * (`/__dev/foreign`); this file drives it from outside, through the router, `foreignLab` and `foreignHandles`.
 */
type Check = { name: string; passed: boolean; detail: string };
type Stats = Record<string, number>;
type Engine = { foreignStats?: (collect?: boolean) => Stats | null; stats?: () => Stats | null; tap?: (x: number, y: number) => boolean; drag?: (x0: number, y0: number, x1: number, y1: number, durationMs: number) => boolean };
type Router = { goto(href: string, options?: { presentation?: "sheet" }): void; back(): boolean; entries: readonly unknown[] };
export type ForeignOutcome = { passed: boolean; summary: string; detail: Record<string, unknown> };

const engine = requireOptionalNativeModule<Engine>("SvelteEngine");
const CYCLES = 20;
const kinds: Kind[] = ["web", "map", "video"];
type CycleKind = Kind | "map-bare";

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Polls [test] every 50 ms for up to [milliseconds]; the last answer. */
async function until(test: () => boolean, milliseconds: number, signal: AbortSignal): Promise<boolean> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end && !signal.aborted) {
    if (test()) return true;
    await pause(50, signal);
  }
  return test();
}

/** The engine's counts, read on its main thread (null while that is busy: asked again). */
async function read(name: "foreignStats" | "stats", signal: AbortSignal, collect = false): Promise<Stats> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const value = (name === "foreignStats" ? engine?.foreignStats?.(collect) : engine?.stats?.()) ?? null;
    if (value) return value;
    await pause(150, signal);
  }
  throw new Error(`SvelteEngine.${name}() gave no answer`);
}
/** The counts of both layers; `collect` runs a full collection first, so the number of reachable React Native views is a leak check. */
const snapshot = async (signal: AbortSignal, collect = false) => ({ foreign: await read("foreignStats", signal, collect), engine: await read("stats", signal) });

type MapView = NonNullable<NonNullable<ReturnType<typeof foreignHandles.get>>["map"]>;
/** The map's camera, or why it could not be read (a rejected promise is a result of the check, not an exception of the scenario). */
const readCamera = (map: MapView | null | undefined): Promise<{ camera: Camera } | { error: string }> =>
  map ? map.getCamera().then((camera) => ({ camera }), (error: unknown) => ({ error: String(error) })) : Promise.resolve({ error: "the map has no handle yet" });

async function tapOn(source: string, target: Kind | "control"): Promise<boolean> {
  const rect = await foreignHandles.get(source)?.rect(target);
  console.info("[Svelte foreign tap]", source, target, JSON.stringify(rect));
  if (!rect || !engine?.tap) return false;
  return engine.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

export async function runForeignViews(router: Router, signal: AbortSignal): Promise<ForeignOutcome> {
  const checks: Check[] = [];
  const check = (name: string, passed: boolean, info = "") => {
    checks.push({ name, passed, detail: info });
    console.info("[Svelte foreign]", JSON.stringify({ name, passed, detail: info }));
  };
  // What the emulator's own limits decide (the Google map's gestures need a valid Maps key) is reported beside the verdict, not judged by it.
  const observed: Record<string, unknown> = {};
  const observe = (name: string, value: unknown) => {
    observed[name] = value;
    console.info("[Svelte foreign observed]", JSON.stringify({ name, value }));
  };
  const depth = router.entries.length;
  const message = (source: string, text: string) => count(source, "web-message", text) > 0;
  const shown = (source: string) => foreignHandles.has(source);
  const leave = async (source: string) => {
    router.back();
    await until(() => !shown(source), 4000, signal);
    await pause(400, signal);
  };

  foreignEvents.length = 0;
  foreignLab.version = "v1";
  const before = await snapshot(signal, true);

  // 1. Inline, in a plain column.
  router.goto("/__dev/foreign?mode=inline");
  check("inline: the lab page opens", await until(() => shown("inline"), 8000, signal));
  check("webview: mounts, loads its page and posts the ready message", await until(() => message("inline", "ready:v1"), 15000, signal), `events ${foreignEvents.filter((e) => e.source === "inline").map((e) => e.event).join(",")}`);
  check("webview: onLoadEnd arrives", count("inline", "web-load-end") > 0);
  foreignLab.version = "v2";
  check("webview: a prop update (the page's source) reloads it", await until(() => message("inline", "ready:v2"), 10000, signal));
  foreignHandles.get("inline")?.web?.injectJavaScript("window.ReactNativeWebView.postMessage('injected')");
  check("webview: the injectJavaScript command runs in the page", await until(() => message("inline", "injected"), 6000, signal));
  check("map: mounts and becomes ready", await until(() => count("inline", "map-ready") > 0, 12000, signal));
  const map = foreignHandles.get("inline")?.map;
  // The map applies its initial region once it is ready; a `setCamera` that comes first is overridden, so it is sent until it holds.
  const atTarget = (read: { camera: Camera } | { error: string } | undefined) => !!read && "camera" in read && Math.abs(read.camera.center.latitude - 21.4) < 0.01 && Math.abs(read.camera.center.longitude - 39.8) < 0.01 && Math.round(read.camera.zoom ?? 0) === 7;
  let camera: { camera: Camera } | { error: string } | undefined;
  for (let attempt = 0; attempt < 8 && !atTarget(camera) && !signal.aborted; attempt++) {
    map?.setCamera({ center: { latitude: 21.4, longitude: 39.8 }, zoom: 7, pitch: 0, heading: 0 });
    await pause(250, signal);
    camera = await readCamera(map);
  }
  check("map: the setCamera command moves the native camera (read back through RNMapsAirModule.getCamera)", atTarget(camera), JSON.stringify(camera));
  // The camera animation and the region events need frames the software GPU of the emulator does not complete; recorded, not judged.
  map?.animateToRegion({ latitude: 24.7, longitude: 46.7, latitudeDelta: 0.5, longitudeDelta: 0.5 }, 200);
  await pause(2500, signal);
  observe("regionEvents", count("inline", "map-region"));
  observe("cameraAfterAnimate", await readCamera(map));
  check("video: mounts and renders its first frame", await until(() => count("inline", "video-first-frame") > 0, 12000, signal));
  const handles = foreignHandles.get("inline");
  check("video: the player plays", await until(() => handles?.player?.playing === true, 6000, signal), `status ${handles?.player?.status}`);
  const inline = await snapshot(signal);
  check("engine: three frames, none waiting, four nodes owned by React Native", inline.foreign.frames - before.foreign.frames === 3 && inline.foreign.waiting === 0 && inline.foreign.nodes - before.foreign.nodes >= 4, JSON.stringify(inline.foreign));

  // Touch: a tap over a foreign view goes to that view, a tap on a plain control goes to JavaScript.
  const touches = () => count("inline", "js-touch");
  let base = touches();
  const tappedWeb = await tapOn("inline", "web");
  check("touch: a tap on the webview reaches the page", tappedWeb && (await until(() => message("inline", "tap"), 5000, signal)));
  await pause(400, signal);
  check("touch: that tap did not reach JavaScript's touch dispatch", touches() === base, `touches ${touches() - base}`);
  // expo-video forwards the touches it receives to JavaScript as React touch events of its own tag (`dispatchMotionEvent`), so its
  // tap shows as one touch: the proof that the view got the touch natively. The engine's own dispatch never saw it (the hit is the view).
  base = touches();
  await tapOn("inline", "video");
  check("touch: a tap on the video view reaches the view, which reports it itself as a touch event of its own tag", await until(() => touches() === base + 1, 3000, signal), `touches ${touches() - base}`);
  base = touches();
  // A pan on the map: react-native-maps' own view sees the finger (`onPanDrag`, from the view's gesture detector), and the Google map
  // underneath may move its camera and report `onPress` for a tap, which needs a Maps key the emulator's placeholder is not.
  const mapRect = await foreignHandles.get("inline")?.rect("map");
  const cameraBefore = await readCamera(map);
  const pans = count("inline", "map-pan-drag");
  if (mapRect && engine?.drag) engine.drag(mapRect.x + mapRect.width * 0.7, mapRect.y + mapRect.height / 2, mapRect.x + mapRect.width * 0.3, mapRect.y + mapRect.height / 2, 400);
  check("touch: a pan on the map reaches the map view (onPanDrag)", await until(() => count("inline", "map-pan-drag") > pans, 3000, signal), `events ${count("inline", "map-pan-drag") - pans}`);
  await pause(1200, signal);
  const cameraAfter = await readCamera(map);
  observe("mapPan", { before: cameraBefore, after: cameraAfter });
  await pause(200, signal);
  check("touch: that pan did not reach JavaScript's touch dispatch", touches() === base, `touches ${touches() - base}`);
  base = touches();
  const pressed = count("inline", "map-press");
  await tapOn("inline", "map");
  observe("mapPress", await until(() => count("inline", "map-press") > pressed, 3000, signal));
  await pause(300, signal);
  check("touch: that tap did not reach JavaScript's touch dispatch", touches() === base, `touches ${touches() - base}`);
  base = touches();
  await tapOn("inline", "control");
  check("touch: a tap on a plain control still does (control)", await until(() => count("inline", "control-press") === 1 && touches() > base, 3000, signal), `touches ${touches() - base}`);
  await leave("inline");
  const afterInline = await snapshot(signal, true);
  check("inline: leaving the page drops every frame and node", afterInline.foreign.frames === before.foreign.frames && afterInline.foreign.nodes === before.foreign.nodes && afterInline.foreign.waiting === 0 && afterInline.foreign.registryLeaks === 0, JSON.stringify(afterInline.foreign));

  foreignLab.version = "v1";
  // 2. In the windowed List: rows come and go while it scrolls.
  router.goto("/__dev/foreign?mode=list");
  check("list: the page opens with rows of foreign views", await until(() => shown("row-0") && shown("row-1") && shown("row-2"), 8000, signal));
  check("list: the webview in a row loads and posts", await until(() => message("row-0", "ready:v1"), 15000, signal));
  check("list: the map in a row becomes ready", await until(() => count("row-1", "map-ready") > 0, 12000, signal));
  check("list: the video in a row renders", await until(() => count("row-2", "video-first-frame") > 0, 12000, signal));
  await tapOn("row-0", "web");
  check("list: a tap on the webview in a row reaches the page", await until(() => message("row-0", "tap"), 5000, signal));
  foreignLab.scrollIndex = 23;
  check("list: scrolling away unmounts the first rows' views", await until(() => !shown("row-0") && !shown("row-1"), 8000, signal), `rows mounted ${[...foreignHandles.keys()].join(",")}`);
  foreignLab.scrollIndex = 0;
  check("list: scrolling back mounts fresh views that load again", await until(() => shown("row-0"), 8000, signal) && (await until(() => count("row-0", "web-message", "ready:v1") >= 2, 15000, signal)));
  await leave("row-0");
  foreignLab.scrollIndex = -1;
  const afterList = await snapshot(signal, true);
  check("list: leaving the page drops every frame and node", afterList.foreign.frames === before.foreign.frames && afterList.foreign.nodes === before.foreign.nodes && afterList.foreign.waiting === 0 && afterList.foreign.registryLeaks === 0, JSON.stringify(afterList.foreign));

  // 3. In a native sheet.
  router.goto("/__dev/foreign?mode=sheet", { presentation: "sheet" });
  check("sheet: the sheet opens with the three views", await until(() => shown("sheet"), 8000, signal));
  check("sheet: the webview loads and posts", await until(() => message("sheet", "ready:v1"), 15000, signal));
  check("sheet: the map and the video are up", (await until(() => count("sheet", "map-ready") > 0, 12000, signal)) && (await until(() => count("sheet", "video-first-frame") > 0, 12000, signal)));
  await pause(700, signal); // the sheet's own entrance
  await tapOn("sheet", "web");
  check("sheet: a tap on the webview reaches the page", await until(() => message("sheet", "tap"), 5000, signal));
  await leave("sheet");
  const afterSheet = await snapshot(signal, true);
  check("sheet: closing it drops every frame and node", afterSheet.foreign.frames === before.foreign.frames && afterSheet.foreign.nodes === before.foreign.nodes && afterSheet.foreign.waiting === 0 && afterSheet.foreign.registryLeaks === 0, JSON.stringify(afterSheet.foreign));

  // 4. Cycles: mount and unmount each view twenty times; the counts return to where they began.
  router.goto("/__dev/foreign?mode=cycle");
  check("cycle: the page opens", await until(() => router.entries.length === depth + 1, 4000, signal));
  const cycleKinds: CycleKind[] = [...kinds, "map-bare"];
  for (const kind of cycleKinds) {
    foreignLab.cycleKind = kind;
    const start = await snapshot(signal, true);
    let ready = 0;
    for (let cycle = 0; cycle < CYCLES && !signal.aborted; cycle++) {
      const seen = foreignEvents.length;
      foreignLab.cycleVisible = true;
      await until(() => foreignHandles.has("cycle"), 3000, signal);
      const signalled = await until(() => foreignEvents.slice(seen).some((e) => e.source === "cycle" && (e.event === "web-message" || e.event === "map-ready" || e.event === "video-first-frame")), 4000, signal);
      if (signalled) ready++;
      foreignLab.cycleVisible = false;
      await until(() => !foreignHandles.has("cycle"), 3000, signal);
      await pause(120, signal);
    }
    // A view may be held a moment longer by the library (a WebView or video player tears down on its own schedule): the count is
    // taken again, after a collection, once a second for up to ten seconds (three for the map, which the SDK never lets go of),
    // and the time it took to settle is reported.
    const patience = kind === "web" || kind === "video" ? 10000 : 3000;
    let end = await snapshot(signal, true);
    let settledMs = 0;
    while (end.foreign.reactViews > start.foreign.reactViews && settledMs < patience && !signal.aborted) {
      await pause(1000, signal);
      settledMs += 1000;
      end = await snapshot(signal, true);
    }
    const grew = (key: string) => end.foreign[key] - start.foreign[key];
    // The engine's frames, React Native's view-state registry and the engine's own views return to where they began. The view objects
    // themselves are the libraries' to release: judged for the WebView and the player, reported for the map (below).
    const clean = end.foreign.frames === start.foreign.frames && end.foreign.nodes === start.foreign.nodes && end.foreign.registryLeaks === 0 && end.foreign.waiting === 0 && grew("created") === CYCLES && grew("dropped") === CYCLES && end.engine.alive === start.engine.alive;
    const cleanDetail = `frames ${start.foreign.frames}→${end.foreign.frames}, nodes ${start.foreign.nodes}→${end.foreign.nodes}, registry leaks ${end.foreign.registryLeaks}, created ${grew("created")}, dropped ${grew("dropped")}, alive ${start.engine.alive}→${end.engine.alive}, ready ${ready}/${CYCLES}`;
    const releasedDetail = `reachable ${start.foreign.reactViews}→${end.foreign.reactViews} after ${settledMs} ms`;
    if (kind === "map-bare") {
      // The map without its marker, to tell the marker's part in what the library holds from the map's own.
      observe("cycle map without marker", { clean, cleanDetail, releasedDetail });
      continue;
    }
    check(`cycle: ${CYCLES} mounts and unmounts of the ${kind} view leave no frame, node or registry entry behind`, clean, cleanDetail);
    // The Google Maps SDK keeps every MapView it has shown (its renderer thread and a layout listener on the window's observer
    // reference the view; SPEC.md, "Foreign views", Limits), with or without the engine: reported, not judged.
    if (kind === "map") observe("cycle map view objects still reachable after a collection", { start: start.foreign.reactViews, end: end.foreign.reactViews, settledMs });
    else check(`cycle: the ${kind} view objects are released after a collection`, end.foreign.reactViews <= start.foreign.reactViews, releasedDetail);
  }
  await leave("cycle");
  const after = await snapshot(signal, true);
  check("end: the router is where it began and the engine and React Native hold no frame, node or registry entry", router.entries.length === depth && after.foreign.frames === before.foreign.frames && after.foreign.nodes === before.foreign.nodes && after.foreign.registryLeaks === 0, `depth ${router.entries.length}/${depth}, ${JSON.stringify(after.foreign)}`);

  const failed = checks.filter((entry) => !entry.passed);
  // One logcat line is cut near 4 KB: every check is logged on its own line above, the result carries the failures and the totals.
  return {
    passed: failed.length === 0,
    summary: `${checks.length - failed.length} / ${checks.length} checks${failed.length ? ` · FAILED ${failed.length}: ${failed.map((entry) => entry.name.slice(0, 48)).join(" | ")}` : ""}`,
    detail: { failed, observed, after: after.foreign },
  };
}
