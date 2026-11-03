/**
 * The checks of the native-view libraries (SPEC.md, "Foreign views", "Device verification of the libraries"): for each of the thirteen, what must
 * hold on a device in the three places the lab mounts it (inline, in a row of the windowed `List`, in a native sheet). Each check reads the answer
 * from the platform where it can: the class Android built and its size (`SvelteEngine.inspect`), the pixels of a capture of the section
 * (`captureRef`, then `SvelteQaPixels.sample`), an event the library raised, a command's own result, the text the native view holds. A check
 * that cannot run on a platform (no pixel reader, no `inspect`) is `skip`ped and reported, never counted as a pass.
 *
 * `foreign-libraries-lab.ts` mounts the section, builds the context and calls the library's function here.
 */
import { dismissDatePicker, openDatePicker, captureRef, releaseCapture, type CaptureOptions } from "@rasheed/svelte-native/foreign";
import type { Host, LibraryHandles, LibraryKind } from "./LibrarySet.svelte";
import { libraryLab } from "./foreign.svelte.ts";
import { argb, clear, near, numberIn, show, solid } from "./foreign-pixels.ts";

export type Where = "inline" | "row" | "sheet";
export type Rect = { x: number; y: number; width: number; height: number };
/** `SvelteEngine.inspect`'s answer (Android): what the platform built for a tag. */
export type Native = {
  owner: "react" | "engine";
  class: string;
  width: number;
  height: number;
  x: number;
  y: number;
  attached: boolean;
  shown: boolean;
  visibility: number;
  alpha: number;
  density: number;
  text: string;
  views: string[];
  surfaces: string[];
  /** The view's parent and whether it clips its children to their bounds. */
  parent: string;
  /** How the view clips what it draws: `canvas` (an engine view with `overflow: hidden`: the padding box), `none`; `children` (Android's `clipChildren`) for a view of a library. */
  clip: string;
};
/** What a capture of a view holds at the points asked for (fractions of the image). */
export type Look = { colors: number[]; width: number; height: number; format: string; uri: string };

export type Ctx = {
  readonly kind: LibraryKind;
  readonly where: Where;
  /** The name the section records its events under. */
  readonly source: string;
  readonly android: boolean;
  /** The platform can say what it built (`inspect`) and read the pixels of a capture (`SvelteQaPixels`). */
  readonly canInspect: boolean;
  readonly canLook: boolean;
  /** The platform can press the screen at a point (the engine's `tap`: Android). A press needs a finger elsewhere: the iPhone has none that the lab can use. */
  readonly canTap: boolean;
  /** The run was opened with `drive:adb`: the harness presses what `press` asks for. */
  readonly driven: boolean;
  readonly lab: typeof libraryLab;
  handles(): LibraryHandles;
  host(): Host | undefined;
  box(): Host | undefined;
  check(name: string, passed: boolean, detail?: string): void;
  skip(name: string, why: string): void;
  /** A check that exists on Android only (it reads a class, a surface, a dialog or a counter that another platform does not have): reported as such, not as a skip the platform could still make. */
  androidOnly(name: string, why: string): void;
  until(test: () => boolean, milliseconds: number): Promise<boolean>;
  pause(milliseconds: number): Promise<void>;
  /** How many times the section raised [event] (with [detail], when given) since the place was opened. */
  events(event: string, detail?: unknown): number;
  inspect(host?: Host): Native | null;
  rect(host?: Host): Promise<Rect | null>;
  /** The point ([fx], [fy], fractions of [host]'s own box) as a point of the section's box, for `look`; null while a layout is missing. */
  point(host: Host, fx: number, fy: number): Promise<[number, number] | null>;
  /** Asks the harness to tap the button with this resource id on the screen (`foreign-press.ts`): a native dialog the page cannot press. */
  press(id: string, resourceId: string): void;
  /** A tap through the engine's root at the middle of [host] (the section's view by default). */
  tap(host?: Host): Promise<boolean>;
  /** Captures [target] (the section's box by default) and reads the colours at [points]. */
  look(points: readonly (readonly [number, number])[], options?: { target?: Host; capture?: CaptureOptions; radius?: number }): Promise<Look | null>;
  /** Draws [target] to a file the lab removes when the place closes (unless it is [kept]). */
  shot(options?: CaptureOptions, target?: Host, kept?: boolean): Promise<string>;
  /** Keeps a file name for the next launch's leftover check (`foreign-leftovers`). */
  leave(uri: string): void;
  /** Whether the file of a `file://` URI exists (JavaScript's view of the cache directory). */
  exists(uri: string): boolean;
  /** `SvelteQaPixels.sample` for a source that is not a capture of the section (a result that came as a string). */
  read(source: string, points?: readonly (readonly [number, number])[], radius?: number): { colors: number[]; width: number; height: number; format: string } | null;
};

/** A command's promise, or "timeout" after [milliseconds]: a native module that cannot find its view never answers, and a check must say so instead of waiting for it. */
const within = <T>(promise: Promise<T> | undefined, milliseconds = 5000): Promise<T | "timeout" | undefined> =>
  promise === undefined ? Promise.resolve(undefined) : Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(resolve, milliseconds, "timeout"))]);

const describe = (info: Native | null): string => (info ? `${info.class.split(".").pop()} ${info.width}x${info.height}px at ${info.x},${info.y}${info.attached ? "" : " detached"}${info.shown ? "" : " hidden"}` : "no native view");

/**
 * The native class a library's view must have on Android, as its own source names it (never a pattern that more than one class could match): `host` is the full class name
 * of the view the section's handle names, `inside` the simple class name of a view in the tree below the handle's (a library whose native view sits behind children is
 * reached through the section's box, and its size is that of this view).
 */
export type Pinned = ({ host: string } | { inside: string }) & {
  /**
   * The same on iOS, from the libraries' own sources: the class UIKit shows for the section's view (`host`; React Native's own `RCTLegacyViewManagerInteropComponentView` for a library
   * that is still a Paper view manager, with the library's view `inside` it) and/or the simple class name of a view in the tree below it (`inside`). Absent: the iOS class is recorded, not pinned.
   */
  ios?: { host?: string; inside?: string };
};

/**
 * The common part: a native view of the library's class is attached, shown and sized, and its size is the layout the engine measured. Waits for
 * it (a view appears after the engine's frame).
 */
async function mounts(c: Ctx, pinned: Pinned, host: Host | undefined = c.host(), measured: Host | undefined = host): Promise<Native | null> {
  if (!host) { c.check("mounts: the section handed out its host handle", false, "no handle"); return null; }
  if (!c.canInspect) {
    const rect = await c.rect(measured);
    c.check("mounts: the engine measured a layout for it", !!rect && rect.width > 0 && rect.height > 0, JSON.stringify(rect));
    c.skip("mounts: the platform built a view of the library's class", "no native inspection on this platform yet");
    return null;
  }
  const ready = () => { const info = c.inspect(host); return !!info && info.attached && info.shown && info.width > 0 && info.height > 0; };
  const up = await c.until(ready, 10000);
  const info = c.inspect(host);
  c.check("mounts: a native view is attached, shown and sized", up, describe(info));
  if (!info) return null;
  // The pin of the platform: Android's classes are the libraries' own Kotlin and Java, iOS's what UIKit built for them (see `Pinned.ios`).
  const pin: { host?: string; inside?: string } = c.android ? ("inside" in pinned ? { inside: pinned.inside } : { host: pinned.host }) : (pinned.ios ?? {});
  const innerEntry = pin.inside !== undefined ? info.views.find((entry) => entry.trim().startsWith(`${pin.inside} `)) : undefined;
  const name = c.android ? ("inside" in pinned ? pinned.inside : pinned.host) : [pin.host, pin.inside === undefined ? undefined : `${pin.inside} inside`].filter(Boolean).join(", ");
  const there = (pin.host === undefined || info.class === pin.host) && (pin.inside === undefined || innerEntry !== undefined);
  if (c.android || pin.host !== undefined || pin.inside !== undefined) c.check(`mounts: it is the library's view (${name})`, there, `${info.class}; inside: ${info.views.slice(0, 4).join(" | ")}`);
  else c.skip("mounts: it is the library's view", `iOS class not pinned (this run saw ${info.class}; inside: ${info.views.slice(0, 3).join(" | ")})`);
  // The size compared is the view's own, or that of the pinned view inside the section's box.
  const inner = innerEntry ? /(\d+)x(\d+)\s*(?:clip=\w+)?\s*$/.exec(innerEntry) : null;
  const nativeWidth = inner ? Number(inner[1]) : info.width;
  const nativeHeight = inner ? Number(inner[2]) : info.height;
  const rect = await c.rect(measured);
  const wide = rect ? Math.abs(nativeWidth / info.density - rect.width) : Infinity;
  const high = rect ? Math.abs(nativeHeight / info.density - rect.height) : Infinity;
  c.check("layout: the native view has the size the engine measured", wide <= 1 && high <= 1, `native ${(nativeWidth / info.density).toFixed(1)}x${(nativeHeight / info.density).toFixed(1)} dp, measured ${rect ? `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}` : "none"}`);
  return info;
}

/** The colour at one point of a look, as a message. */
const at = (look: Look, index: number): string => show(look.colors[index] ?? 0);
const pixel = (look: Look, index: number): number => look.colors[index] ?? 0;

/**
 * [expected] colours at [points] of a capture of the box: one check for all, naming each point that missed. Skipped when the platform cannot read pixels.
 */
async function colours(c: Ctx, name: string, points: readonly (readonly [number, number])[], expected: readonly string[], tolerance = 40, options?: Parameters<Ctx["look"]>[1], settle?: { ms: number; explain: () => string }): Promise<Look | null> {
  if (!c.canLook) { c.skip(name, "no pixel reader on this platform yet"); return null; }
  // With [settle] the capture is taken again every 400 ms until it shows the colours or the time is up (a slower phone draws a new image later than onLoad says it has it): what the last one shows is the check.
  const deadline = Date.now() + (settle?.ms ?? 0);
  for (;;) {
    let look: Look | null;
    try {
      look = await c.look(points, options);
    } catch (error) {
      c.check(name, false, `the capture failed: ${String(error)}`);
      return null;
    }
    if (!look) { c.check(name, false, "the capture gave no pixels"); return null; }
    const seen = look;
    const missed = expected.flatMap((colour, index) => (near(pixel(seen, index), colour, tolerance) ? [] : [`${points[index]?.join(",")} is ${at(seen, index)}, wanted ${colour}`]));
    if (missed.length > 0 && Date.now() < deadline) { await c.pause(400); continue; }
    c.check(name, missed.length === 0, missed.length === 0 ? expected.map((_, index) => at(seen, index)).join(" ") : `${missed.join("; ")}${settle ? ` | ${settle.explain()}` : ""}`);
    return seen;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-image

async function image(c: Ctx): Promise<void> {
  await mounts(c, { host: "expo.modules.image.ExpoImageViewWrapper", ios: { host: "ExpoImage.ImageView" } });
  c.check("events: onLoad arrives for the bundled image, with its url", await c.until(() => c.events("image-load") >= 1, 12000), `${c.events("image-load")} onLoad, ${c.events("image-error")} onError`);
  c.check("events: onDisplay arrives after onLoad", await c.until(() => c.events("image-display") >= 1, 4000));
  c.check("events: no onError for it", c.events("image-error") === 0);
  // A new source: onLoad says it is decoded, onDisplay that it is drawn (after its transition, which a slower phone takes longer over); the capture is asked again until it shows
  // the colour, and a miss says what the platform has (the view, whether it is shown and how opaque, the events) to tell a view that never drew from a late one.
  const explain = () => {
    const native = c.inspect(c.host());
    return `${native ? `${native.class} ${native.width}x${native.height} attached=${native.attached} shown=${native.shown} alpha=${native.alpha}` : "no native view"}; ${c.events("image-load")} onLoad, ${c.events("image-display")} onDisplay, ${c.events("image-error")} onError`;
  };
  const switchTo = async (source: "red" | "blue", name: string, check: string): Promise<void> => {
    const loads = c.events("image-load");
    const displays = c.events("image-display");
    c.lab.image = source;
    c.check(name, await c.until(() => c.events("image-load") > loads, 8000));
    await c.until(() => c.events("image-display") > displays, 4000);
    await colours(c, check, [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7]], source === "red" ? ["#e5484d", "#e5484d", "#e5484d"] : ["#0091ff", "#0091ff", "#0091ff"], 12, undefined, { ms: 5000, explain });
  };
  await switchTo("red", "prop update: a new source loads (onLoad again)", "prop update: the native view shows the red source");
  await switchTo("blue", "prop update: and the next source loads too", "prop update: the native view shows the blue source");
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-blur: the stripes are red | yellow | green | blue | purple, the blur sits over the middle; at a stripe edge inside it the two sides come together

const redYellow = (y: number): [number, number][] => [[0.2 - 0.012, y], [0.2 + 0.012, y]];

async function blur(c: Ctx): Promise<void> {
  await mounts(c, { inside: "ExpoBlurView", ios: { host: "ExpoBlur.ExpoBlurView" } });
  if (!c.canLook) { c.skip("prop update: the blur smears a stripe edge in proportion to its intensity", "no pixel reader on this platform yet"); return; }
  const gap = async (intensity: number, y: number): Promise<{ spread: number; text: string } | null> => {
    c.lab.blurIntensity = intensity;
    await c.pause(500);
    const look = await c.look(redYellow(y));
    if (!look) return null;
    const left = argb(pixel(look, 0));
    const right = argb(pixel(look, 1));
    return { spread: Math.max(Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)), text: `${at(look, 0)} | ${at(look, 1)}` };
  };
  try {
    // Below the label and inside the blur box (its top and bottom are 14 % in); above it, outside the blur box, the edge stays sharp.
    const sharpOutside = await gap(70, 0.06);
    const weak = await gap(1, 0.78);
    const strong = await gap(100, 0.78);
    c.check("the stripe edge outside the blur box is sharp", !!sharpOutside && sharpOutside.spread > 100, sharpOutside?.text ?? "no capture");
    c.check("prop update: intensity 100 pulls the two sides of a stripe edge together, intensity 1 leaves them apart", !!weak && !!strong && strong.spread < weak.spread * 0.6, `intensity 1 ${weak?.text} (${weak?.spread}), intensity 100 ${strong?.text} (${strong?.spread})`);
  } catch (error) {
    c.check("prop update: the blur smears a stripe edge in proportion to its intensity", false, String(error));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-linear-gradient

async function gradient(c: Ctx): Promise<void> {
  // The container is flattened away when it only lays its children out: the section's box holds the native gradient (a View with only layout props has no native view).
  await mounts(c, { inside: "LinearGradientView", ios: { inside: "LinearGradientView" } }, c.box(), c.host());
  await colours(c, "the gradient runs from its first colour at the start to its last at the end", [[0.02, 0.12], [0.98, 0.88]], ["#ff7a18", "#319197"], 45);
  // expo-linear-gradient on Android cannot unset `locations` (its prop setter ignores null), so a new list keeps the length.
  c.lab.gradientColors = ["#00c853", "#ffd600", "#2962ff"];
  await c.pause(400);
  await colours(c, "prop update: new colours reach the native view", [[0.02, 0.12], [0.98, 0.88]], ["#00c853", "#2962ff"], 45);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-video

async function video(c: Ctx): Promise<void> {
  await mounts(c, { host: "com.brentvatne.exoplayer.ReactExoplayerView", ios: { host: "RCTLegacyViewManagerInteropComponentView", inside: "RCTVideo" } });
  c.check("events: onLoadStart, onLoad (with a duration) and onReadyForDisplay arrive", (await c.until(() => c.events("video-load") >= 1 && c.events("video-ready") >= 1, 15000)) && c.events("video-load-start") >= 1, `${foreignSummary(c, ["video-load-start", "video-load", "video-ready", "video-progress", "video-error"])}`);
  c.check("events: no onError", c.events("video-error") === 0);
  c.check("events: onProgress keeps arriving while it plays", await progresses(c, 1200));
  if (!c.android) c.androidOnly("the player draws into a surface of its own", "ExoPlayer draws into a SurfaceView or TextureView; AVPlayerLayer is a layer of the view and has no surface to list");
  else if (c.canInspect) {
    const info = c.inspect(c.host());
    c.check("the player draws into a surface of its own", (info?.surfaces.length ?? 0) >= 1, `${info?.surfaces.join(" | ") ?? "no native view"}`);
  }
  // paused: progress stops, and starts again when it is not
  c.lab.videoPaused = true;
  await c.pause(900);
  const frozen = c.events("video-progress");
  await c.pause(1200);
  c.check("prop update: paused stops the progress events", c.events("video-progress") === frozen, `${frozen} -> ${c.events("video-progress")}`);
  c.lab.videoPaused = false;
  c.check("prop update: and resuming starts them again", await c.until(() => c.events("video-progress") > frozen + 1, 5000));
  // commands: pause and resume stop and restart the progress events the same way the prop does
  try {
    const paused = await within(c.handles().video?.pause());
    c.check("command: pause() answers", paused !== "timeout", String(paused));
    await c.pause(900);
    const stopped = c.events("video-progress");
    await c.pause(1200);
    c.check("command: pause() stops the progress events", c.events("video-progress") === stopped, `${stopped} -> ${c.events("video-progress")}`);
    const resumed = await within(c.handles().video?.resume());
    c.check("command: resume() answers", resumed !== "timeout", String(resumed));
    c.check("command: resume() starts them again", await c.until(() => c.events("video-progress") > stopped + 1, 5000));
  } catch (error) {
    c.check("command: pause() and resume()", false, String(error));
  }
  // command: seek, read back through onSeek and the library's own position
  const seeks = c.events("video-seek");
  c.handles().video?.seek(1.2);
  c.check("command: seek raises onSeek", await c.until(() => c.events("video-seek") > seeks, 6000));
  try {
    const position = await within(c.handles().video?.getCurrentPosition());
    c.check("command: getCurrentPosition answers a position near the seek", typeof position === "number" && position >= 0.5 && position <= 3.2, `position ${String(position)}`);
  } catch (error) {
    c.check("command: getCurrentPosition answers a position near the seek", false, String(error));
  }
  // capture: not a hole, and the video on screen undisturbed
  if (!c.canLook) {
    c.skip("capture: the surface is in the image with handleGLSurfaceViewOnAndroid, a hole without it", "no pixel reader on this platform yet");
    return;
  }
  const before = c.inspect(c.host());
  const ticks = c.events("video-progress");
  const plain = await c.look([[0.5, 0.5], [0.3, 0.5], [0.7, 0.5]]);
  const full = await c.look([[0.5, 0.5], [0.3, 0.5], [0.7, 0.5]], { capture: { handleGLSurfaceViewOnAndroid: true } });
  if (c.android) c.check("capture: without handleGLSurfaceViewOnAndroid the video is a hole", !!plain && plain.colors.every(clear), plain ? plain.colors.map(show).join(" ") : "no capture");
  else c.androidOnly("capture: without handleGLSurfaceViewOnAndroid the video is a hole", "the option and the hole belong to Android's SurfaceView; an AVPlayerLayer is drawn into a snapshot as it is");
  c.check("capture: with handleGLSurfaceViewOnAndroid the frame is in the image", !!full && full.colors.every(solid), full ? full.colors.map(show).join(" ") : "no capture");
  await c.pause(600);
  const after = c.inspect(c.host());
  c.check("capture: the video on screen did not move, resize or hide", !!before && !!after && before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height && after.shown && (!c.android || after.surfaces.length >= 1), `${describe(before)} -> ${describe(after)}; ${after?.surfaces.join(" | ")}`);
  c.check("capture: it kept playing", c.events("video-progress") > ticks + 1, `${ticks} -> ${c.events("video-progress")} progress events`);
}

const foreignSummary = (c: Ctx, names: string[]): string => names.map((name) => `${name} ${c.events(name)}`).join(", ");
async function progresses(c: Ctx, milliseconds: number): Promise<boolean> {
  const start = c.events("video-progress");
  await c.pause(milliseconds);
  return c.events("video-progress") > start + 1;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// @react-native-community/datetimepicker: Android opens dialogs (the module's `show`/`dismiss`); the iOS view is the component

/** The checks of the Android date and time dialogs (`openDatePicker`, `dismissDatePicker`, the harness's presses): the names the iPhone reports as Android-only. */
const androidDialogChecks = [
  "commands: openDatePicker keeps its promise pending while the dialog is up",
  "commands: dismissDatePicker finds the dialog the module opened",
  "commands: the dismissed dialog resolves the promise with null",
  "events: OK in the date dialog resolves openDatePicker with the date",
  "events: Cancel resolves it with null",
  "events: OK in the time dialog resolves it with a time of day",
  "commands: the time dialog opens and closes the same way",
] as const;

async function datetime(c: Ctx): Promise<void> {
  if (!c.android) {
    await mounts(c, { host: "", ios: { host: "RNDateTimePickerComponentView" } });
    c.skip("events: onValueChange for a pick, onDismiss", "a pick needs a finger on the picker: the iPhone");
    // iOS shows the picker in the view tree; the Android module opens and closes dialogs, which are the checks below.
    for (const name of androidDialogChecks) c.androidOnly(name, "Android's picker is a dialog window that the module opens, dismisses and answers; iOS has no such module call");
    return;
  }
  // The dialog is a native window of its own: the module's own `dismiss` says whether one was showing, and the pending `open` ends with null.
  const pending = openDatePicker({ value: new Date(Date.UTC(2026, 9, 28, 12, 0, 0)), mode: "date" });
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  await c.pause(1200);
  c.check("commands: openDatePicker keeps its promise pending while the dialog is up", !settled);
  const wasShowing: boolean | string = await dismissDatePicker("date").catch((error: unknown) => String(error));
  c.check("commands: dismissDatePicker finds the dialog the module opened", wasShowing === true, String(wasShowing));
  const result: Date | null | string = await Promise.race([pending, new Promise<string>((resolve) => setTimeout(resolve, 4000, "timeout"))]).catch((error: unknown) => String(error));
  c.check("commands: the dismissed dialog resolves the promise with null", result === null, String(result));
  if (c.driven) await pressed(c);
  else c.skip("events: pressing OK, Cancel and the time dialog's OK end the dialog with a date or null", "the harness did not drive the run (drive:adb)");
  const time = openDatePicker({ value: new Date(Date.UTC(2026, 9, 28, 12, 0, 0)), mode: "time" });
  void time.catch(() => undefined);
  await c.pause(1200);
  const timeShowing: boolean | string = await dismissDatePicker("time").catch((error: unknown) => String(error));
  c.check("commands: the time dialog opens and closes the same way", timeShowing === true, String(timeShowing));
  await Promise.race([time, new Promise((resolve) => setTimeout(resolve, 2000))]).catch(() => undefined);
}

/** The dialog pressed by the harness: OK answers a date, Cancel answers null, and the time dialog answers the time of day it was given. */
async function pressed(c: Ctx): Promise<void> {
  const value = new Date(Date.UTC(2026, 9, 28, 12, 30, 0));
  const answer = async (mode: "date" | "time", resourceId: string, id: string): Promise<Date | null | string> => {
    const open = openDatePicker({ value, mode });
    void open.catch(() => undefined);
    await c.pause(1200);
    c.press(id, resourceId);
    const result = await Promise.race([open, new Promise<string>((resolve) => setTimeout(resolve, 12000, "timeout"))]).catch((error: unknown) => String(error));
    // The harness looks at the screen once more to see its tap closed the dialog: the next one opens after that look.
    await c.pause(3000);
    return result;
  };
  const ok = await answer("date", "android:id/button1", "date-ok");
  c.check("events: OK in the date dialog resolves openDatePicker with the date", ok instanceof Date && Math.abs(ok.getTime() - value.getTime()) < 24 * 3600 * 1000, String(ok));
  const cancel = await answer("date", "android:id/button2", "date-cancel");
  c.check("events: Cancel resolves it with null", cancel === null, String(cancel));
  const time = await answer("time", "android:id/button1", "time-ok");
  c.check("events: OK in the time dialog resolves it with a time of day", time instanceof Date, String(time));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// lottie-react-native: a blue dot, 60 % to 100 % of 60 units in two seconds; at 24 units from the middle it is inside only past 80 %

const dotAt = (distance: number): [number, number] => [0.5 + distance, 0.5];

async function lottie(c: Ctx): Promise<void> {
  await mounts(c, { host: "com.airbnb.lottie.LottieAnimationView", ios: { host: "LottieAnimationViewComponentView", inside: "LottieContainerView" } });
  c.check("events: onAnimationLoaded arrives", await c.until(() => c.events("lottie-loaded") >= 1, 10000), `${foreignSummary(c, ["lottie-loaded", "lottie-failure"])}`);
  c.check("events: no onAnimationFailure", c.events("lottie-failure") === 0);
  const handle = c.handles().lottie;
  // The box is 96 dp high and 395 wide, and the 100 x 100 composition fits its height: 24 of its units are 24 dp, which is 24 / 395 of the width.
  const rect = await c.rect(c.box());
  const dp = rect ? 24 / rect.width : 0.06;
  handle?.pause();
  c.lab.lottieAutoPlay = false;
  // The prop's default is 0, so 0 would not be a change: the small dot is a progress a little past it.
  c.lab.lottieProgress = 0.02;
  await c.pause(500);
  const small = await c.look([[0.5, 0.5], dotAt(dp)]);
  c.lab.lottieProgress = 0.5;
  await c.pause(500);
  const big = await c.look([[0.5, 0.5], dotAt(dp)]);
  if (!c.canLook) { c.skip("prop update: progress moves the animation (the dot is smaller at 0.02 than at 0.5)", "no pixel reader on this platform yet"); }
  else c.check("prop update: progress moves the animation (the dot is smaller at 0.02 than at 0.5)", !!small && !!big && solid(pixel(small, 0)) && near(pixel(small, 0), "#2e8cf2", 40) && !solid(pixel(small, 1)) && near(pixel(big, 1), "#2e8cf2", 40), `at 0.02: ${small ? small.colors.map(show).join(" ") : "none"}; at 0.5: ${big ? big.colors.map(show).join(" ") : "none"}`);
  // commands: play the whole animation once and hear it finish
  c.lab.lottieLoop = false;
  await c.pause(300);
  // reset() cancels a running animation, which is an onAnimationFinish(true) of its own: only the ones that ran to the end (false) count.
  handle?.reset();
  await c.pause(400);
  const finishes = c.events("lottie-finish", false);
  handle?.play(0, 60);
  c.check("commands: play ends a non-looping animation with onAnimationFinish(false), not cancelled", await c.until(() => c.events("lottie-finish", false) > finishes, 6000), `${c.events("lottie-finish", false)} ended, ${c.events("lottie-finish", true)} cancelled`);
  // pause holds an animation half way (no end for longer than it needs), resume lets it finish
  handle?.reset();
  await c.pause(400);
  const ends = c.events("lottie-finish", false);
  handle?.play(0, 60);
  await c.pause(700);
  handle?.pause();
  await c.pause(2600);
  c.check("commands: pause holds a running animation (it does not finish while paused)", c.events("lottie-finish", false) === ends, `${ends} -> ${c.events("lottie-finish", false)} ended`);
  handle?.resume();
  c.check("commands: resume lets it finish", await c.until(() => c.events("lottie-finish", false) > ends, 5000), `${c.events("lottie-finish", false)} ended`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-pdf: page 1 is blue, page 2 green

async function pdf(c: Ctx): Promise<void> {
  await mounts(c, { host: "org.wonday.pdf.PdfView", ios: { host: "RCTLegacyViewManagerInteropComponentView", inside: "RNPDFPdfView" } });
  c.check("events: onLoadComplete arrives with two pages", await c.until(() => c.events("pdf-load", 2) >= 1, 15000), foreignSummary(c, ["pdf-load", "pdf-page", "pdf-error"]));
  c.check("events: onPageChanged reports page 1 of 2", await c.until(() => c.events("pdf-page", "1/2") >= 1, 5000));
  c.check("events: no onError", c.events("pdf-error") === 0);
  await c.pause(600);
  await colours(c, "the first page is drawn (its blue)", [[0.5, 0.7]], ["#3373d9"], 40);
  c.lab.pdfPage = 2;
  c.check("prop update: page 2 raises onPageChanged 2/2", await c.until(() => c.events("pdf-page", "2/2") >= 1, 6000));
  await c.pause(600);
  await colours(c, "prop update: the second page is drawn (its green)", [[0.5, 0.7]], ["#268c59"], 40);
  c.handles().pdf?.setPage(1);
  c.check("command: setPage(1) raises onPageChanged 1/2 again", await c.until(() => c.events("pdf-page", "1/2") >= 2, 6000));
  await c.pause(600);
  await colours(c, "command: and the first page is back", [[0.5, 0.7]], ["#3373d9"], 40);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-view-shot

async function capture(c: Ctx): Promise<void> {
  const shot = c.handles().hosts.capture;
  if (!shot) { c.check("mounts: the ViewShot handed out its host handle", false, "no handle"); return; }
  await mounts(c, { host: "expo.modules.svelteengine.views.EngineView", ios: { host: "RCTViewComponentView" } }, shot);
  if (!c.canLook) { c.skip("capture: the rounded card keeps its corners, scale, jpg, base64 and data-uri results", "no pixel reader on this platform yet"); return; }
  const card = shot;
  // 1. the card (a 16 dp radius, overflow hidden, five stripes that reach the corners): transparent rounded corners, the stripes clipped to them
  const corners: [number, number][] = [[0.02, 0.03], [0.98, 0.03], [0.02, 0.97], [0.98, 0.97], [0.5, 0.85], [0.1, 0.5], [0.9, 0.5]];
  let look: Look | null = null;
  try { look = await c.look(corners, { target: card, radius: 0 }); } catch (error) { c.check("capture: the rounded card has transparent corners and its stripes inside", false, String(error)); }
  if (look) {
    c.check("capture: the rounded card has transparent corners", look.colors.slice(0, 4).every(clear), look.colors.slice(0, 4).map(show).join(" "));
    c.check("capture: its stripes are drawn inside (green middle, red and purple ends)", near(pixel(look, 4), "#30a46c", 30) && near(pixel(look, 5), "#e5484d", 30) && near(pixel(look, 6), "#8e4ec6", 30), look.colors.slice(4).map(show).join(" "));
    c.check("capture: the file is the card's size in pixels", look.width > 0 && look.height > 0, `${look.width}x${look.height}`);
  }
  // an elevated child casts its shadow in the image: the green stripe just below a white square is darker with elevation than without
  try {
    const under: [number, number][] = [[0.5, 0.7], [0.5, 0.64]];
    const flat = await c.look(under, { target: card, radius: 0 });
    c.lab.captureElevation = 10;
    await c.pause(500);
    const raised = await c.look(under, { target: card, radius: 0 });
    c.lab.captureElevation = 0;
    const darker = !!flat && !!raised && under.every((_, index) => near(pixel(flat, index), "#30a46c", 4)) && under.some((_, index) => argb(pixel(flat, index)).g - argb(pixel(raised, index)).g >= 4);
    c.check("capture: an elevated child casts a shadow in the image", darker, `flat ${flat?.colors.map(show).join(" ")}, elevated ${raised?.colors.map(show).join(" ")}`);
  } catch (error) {
    c.check("capture: an elevated child casts a shadow in the image", false, String(error));
  }
  // 2. the formats and results
  try {
    // the ViewShot's own capture(): a view that has just been laid out, and its onCapture hears it
    const heard = c.events("viewshot-capture");
    const viaShot = (await c.handles().viewShot?.capture()) ?? "";
    c.check("capture: ViewShot.capture() answers a file and onCapture hears it", viaShot.startsWith("file://") && c.exists(viaShot) && (await c.until(() => c.events("viewshot-capture") > heard, 2000)), `${viaShot.slice(-40)}, ${c.events("viewshot-capture")} onCapture, ${c.events("viewshot-failure")} onCaptureFailure`);
    if (viaShot) releaseCapture(viaShot);
    const own = await c.handles().capture();
    c.check("capture: the section's capture() answers a file that exists", own.startsWith("file://") && c.exists(own), own.slice(-48));
    releaseCapture(own);
    const rectCard = await c.rect(card);
    const jpg = await c.shot({ format: "jpg", quality: 0.9 }, card);
    const jpgLook = c.read(jpg, [[0.5, 0.5]], 1);
    c.check("capture: format jpg gives a JPEG", jpgLook?.format === "image/jpeg", `${jpgLook?.format}`);
    const scaled = await c.shot({ width: 40, height: 30 }, card);
    const scaledLook = c.read(scaled, [[0.5, 0.5]], 0);
    c.check("capture: width and height scale the image", scaledLook?.width === 40 && scaledLook?.height === 30, `${scaledLook?.width}x${scaledLook?.height}`);
    const base64 = await captureRef(card, { result: "base64", format: "png" });
    const fromBase64 = c.read(base64, [[0.5, 0.5]], 1);
    c.check("capture: result base64 is a PNG that decodes to the card's size", typeof base64 === "string" && !base64.startsWith("file:") && fromBase64?.format === "image/png" && fromBase64.width > 0, `${base64.length} characters, ${fromBase64?.width}x${fromBase64?.height} ${fromBase64?.format}`);
    const dataUri = await captureRef(card, { result: "data-uri", format: "jpg" });
    const fromData = c.read(dataUri, [[0.5, 0.5]], 1);
    c.check("capture: result data-uri carries its media type and decodes", dataUri.startsWith("data:image/jpeg;base64,") && fromData?.format === "image/jpeg", `${dataUri.slice(0, 32)}..., ${fromData?.width}x${fromData?.height}`);
    c.check("capture: the file's pixel size is the layout's size times the density", !!rectCard && !!look && Math.abs(look.width - rectCard.width * (c.inspect(card)?.density ?? 1)) <= 2, `${look?.width} px for ${rectCard?.width} dp`);
  } catch (error) {
    c.check("capture: formats and results", false, String(error));
  }
  // 3. files: a tmpfile exists until releaseCapture, and two are left for the next launch to find gone
  try {
    const file = await c.shot({ format: "png", result: "tmpfile" }, card, true);
    const present = c.exists(file);
    releaseCapture(file);
    await c.pause(300);
    c.check("capture: a tmpfile exists until releaseCapture removes it", present && !c.exists(file), `exists ${present} -> ${c.exists(file)}`);
    c.leave(await c.shot({ format: "png", result: "tmpfile" }, card, true));
    c.leave(await c.shot({ format: "jpg", result: "tmpfile" }, card, true));
  } catch (error) {
    c.check("capture: tmpfile lifecycle", false, String(error));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// rive-react-native: the vehicles file is fetched from Rive's CDN (the lab needs the network for it)

async function rive(c: Ctx): Promise<void> {
  await mounts(c, { host: "com.rivereactnative.RiveReactNativeView", ios: { host: "RCTLegacyViewManagerInteropComponentView", inside: "RiveReactNativeView" } });
  c.check("events: onPlay arrives for the file's animation (the file needs the network)", await c.until(() => c.events("rive-play") >= 1, 20000), foreignSummary(c, ["rive-play", "rive-pause", "rive-stop", "rive-error"]));
  await c.pause(800);
  const middle = await colours(c, "capture: the animation is in the image (its middle is painted, not a hole)", [[0.5, 0.5], [0.45, 0.4], [0.55, 0.6]], ["#d62a5c", "#d62a5c", "#d62a5c"], 255, undefined);
  // The artboard's own background is pink; the truck drives over the middle of it, so one of three points away from each other is enough.
  if (middle) c.check("capture: the animation's background is there (opaque, pink at one of three points)", middle.colors.every(solid) && middle.colors.some((value) => argb(value).r > 200 && argb(value).g < 110), middle.colors.map(show).join(" "));
  // prop update: `fit` fill paints the whole box, contain leaves the sides of a wide box bare
  const edges: [number, number][] = [[0.05, 0.5], [0.95, 0.5]];
  c.lab.riveFit = "contain";
  await c.pause(600);
  const contain = await c.look(edges);
  c.lab.riveFit = "fill";
  await c.pause(900);
  const fill = await c.look(edges);
  if (!c.canLook) c.skip("prop update: fit changes how the animation fills the box", "no pixel reader on this platform yet");
  else c.check("prop update: fit fill paints the sides that contain leaves bare", !!contain && !!fill && contain.colors.every((value) => !solid(value) || near(value, "#ffffff", 20) || argb(value).r < 150) && fill.colors.every(solid) && argb(pixel(fill, 0)).r > 150, `contain ${contain?.colors.map(show).join(" ")}; fill ${fill?.colors.map(show).join(" ")}`);
  c.lab.riveFit = "contain";
  // commands
  const handle = c.handles().rive;
  const pauses = c.events("rive-pause");
  handle?.pause();
  c.check("commands: pause raises onPause", await c.until(() => c.events("rive-pause") > pauses, 5000), foreignSummary(c, ["rive-pause"]));
  const plays = c.events("rive-play");
  handle?.play();
  c.check("commands: play raises onPlay again", await c.until(() => c.events("rive-play") > plays, 5000), foreignSummary(c, ["rive-play"]));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-conic-gradient: hard stops make the right half of the turn red and the left half blue; a quarter turn... a half turn swaps them

async function conic(c: Ctx): Promise<void> {
  await mounts(c, { inside: "ConicGradientView", ios: { inside: "ConicGradientView" } }, c.box(), c.host());
  c.lab.conicHard = true;
  c.lab.conicAngle = 0;
  await c.pause(500);
  await colours(c, "the sweep starts at the top and runs clockwise (right half red, left half blue)", [[0.75, 0.5], [0.25, 0.5]], ["#e5484d", "#0091ff"], 30);
  c.lab.conicAngle = 180;
  await c.pause(500);
  await colours(c, "prop update: angle 180 swaps the halves", [[0.75, 0.5], [0.25, 0.5]], ["#0091ff", "#e5484d"], 30);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-fast-shadow: the card is centred in a 96 dp box, 38 dp high, and its shadow (12 dp blur, 5 dp down) reaches 17 dp below it

/** The checks of the Android shadow view and of the engine's canvas clip: the names the iPhone reports as Android-only. */
const androidShadowChecks = [
  "the unflattened wrapper has a native view of its own that holds the second card's FastShadowView",
  "the wrapper clips its canvas (overflow hidden, padding box)",
  "the rounded overflow-hidden box clips its canvas (padding box)",
  "so does the wrapper with overflow hidden between the box and the second card",
] as const;

async function shadow(c: Ctx): Promise<void> {
  await mounts(c, { inside: "FastShadowView", ios: { host: "RCTViewComponentView" } }, c.box(), c.host());
  const wrapped = c.handles().extras.wrapped;
  if (!c.android) {
    // react-native-fast-shadow has no iOS code: `ShadowedView` is React Native's `View`, and `shadowStyle` writes the layer's own shadow props. These four read Android's native view and its canvas clip.
    for (const name of androidShadowChecks) c.androidOnly(name, "react-native-fast-shadow's native view and the engine's canvas clip are Android's; on iOS ShadowedView is a plain View whose layer carries the shadow");
  } else if (c.canInspect) {
    // The wrapper is a view of its own (`collapsable={false}`, a `testID`, `overflow: hidden`: Fabric does not flatten it away), clips its canvas, and holds the second card's native shadow view.
    // (The card's own container, `wrapped`, is a layout-only view that Fabric flattens: it has no native view to read, only a layout to measure.)
    const wrapper = c.handles().extras.wrapper;
    const inner = wrapper && (await c.until(() => !!c.inspect(wrapper), 5000)) ? c.inspect(wrapper) : null;
    c.check("the unflattened wrapper has a native view of its own that holds the second card's FastShadowView", !!inner && inner.views.some((entry) => entry.includes("FastShadowView")), inner ? `${inner.class} ${inner.width}x${inner.height} clip=${inner.clip}; ${inner.views.join(" | ")}` : wrapper ? `no native view for tag ${wrapper.tag}` : "no handle");
    c.check("the wrapper clips its canvas (overflow hidden, padding box)", inner?.clip === "canvas", `clip=${inner?.clip}`);
    // `overflow: hidden` clips the canvas to the padding box (not each child to its own bounds) for the box and for the wrapper inside it.
    const box = c.inspect(c.box());
    c.check("the rounded overflow-hidden box clips its canvas (padding box)", box?.clip === "canvas", `box clip=${box?.clip}`);
    c.check("so does the wrapper with overflow hidden between the box and the second card", !!box?.views.some((entry) => /^\s*EngineView \d+x\d+ clip=canvas/.test(entry)), (box?.views ?? []).join(" | "));
  }
  if (!c.canLook) { c.skip("capture: the shadows are drawn outside their cards (not clipped to the card's frame)", "no pixel reader on this platform yet"); }
  else {
    const rect = await c.rect(c.box());
    const edge = async (host: Host | undefined, dp: number): Promise<[number, number] | null> => {
      const bottom = host ? await c.point(host, 0.5, 1) : null;
      return bottom && rect ? [bottom[0], bottom[1] + dp / rect.height] : null;
    };
    const near = await Promise.all([edge(c.host(), 5), edge(wrapped, 5)]);
    const far = await Promise.all([edge(c.host(), 9), edge(wrapped, 9)]);
    const points = [...near, ...far].filter((point): point is [number, number] => point !== null);
    if (points.length !== 4) c.check("the cards have a layout", false, JSON.stringify([near, far]));
    else {
      const withShadow = await c.look(points, { radius: 0 });
      // The shadow of a card, below it by 5 dp and by 9 dp: the card directly in the box, then the card in the wrapper.
      c.check("the shadow is drawn below each card, outside its frame, in the box and in the wrapper", !!withShadow && [0, 1, 2, 3].every((index) => argb(pixel(withShadow, index)).a > 20), withShadow ? withShadow.colors.map(show).join(" ") : "no capture");
      c.lab.shadowOpacity = 0;
      await c.pause(500);
      const without = await c.look(points, { radius: 0 });
      c.check("prop update: opacity 0 takes both away", !!without && without.colors.every(clear), without ? without.colors.map(show).join(" ") : "no capture");
      c.lab.shadowOpacity = 0.45;
    }
  }
  if (!c.canTap) { c.skip("events: a press on the child inside the shadow reaches JavaScript", "a press needs a finger: the lab has none on the iPhone (XCUITest does not run on it), and the press tests the touch path, not the shadow"); return; }
  const presses = c.events("shadow-press");
  await c.tap(c.host());
  c.check("events: a press on the child inside the shadow reaches JavaScript", await c.until(() => c.events("shadow-press") > presses, 3000));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-animateable-text: the number the shared value holds, written to the native text on the UI thread

async function text(c: Ctx): Promise<void> {
  await mounts(c, { host: "com.facebook.react.views.text.ReactTextView", ios: { host: "JBAnimatedTextComponentView" } });
  if (!c.canInspect) { c.skip("the native text follows the shared value", "no native inspection on this platform yet"); return; }
  const read = (): number | null => numberIn(c.inspect(c.host())?.text);
  c.check("the first string is `count N`", await c.until(() => (c.inspect(c.host())?.text ?? "").startsWith("count"), 6000), c.inspect(c.host())?.text ?? "none");
  const first = read();
  await c.pause(1000);
  const second = read();
  c.check("the native text advances on its own (the shared value drives it)", first !== null && second !== null && second !== first, `${first} -> ${second}`);
  // block the JavaScript thread: the number is written on the UI thread, so it moves on
  const before = read();
  const until = Date.now() + 900;
  while (Date.now() < until) { /* the JavaScript thread is held */ }
  await c.pause(0);
  const after = read();
  const moved = before !== null && after !== null ? (after - before + 101) % 101 : -1;
  c.check("it advances while the JavaScript thread is blocked", moved >= 8 && moved <= 70, `${before} -> ${after} over a 900 ms block and two native reads (20 per second)`);
  const shown = c.handles().shown();
  c.check("JavaScript's view of the shared value agrees with the native text", shown !== null && read() !== null && Math.min((shown - (read() ?? 0) + 101) % 101, (((read() ?? 0) - shown) + 101) % 101) <= 12, `shared value ${shown}, native ${read()}`);
  c.lab.textStatic = "hello native text";
  c.check("prop update: a plain text prop changes the native string", await c.until(() => c.inspect(c.host())?.text === "hello native text", 4000), c.inspect(c.host())?.text ?? "none");
  c.lab.textStatic = "second string";
  c.check("prop update: and the next one", await c.until(() => c.inspect(c.host())?.text === "second string", 4000), c.inspect(c.host())?.text ?? "none");
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-svg

async function svg(c: Ctx): Promise<void> {
  const handles = c.handles().svg;
  const root = handles.root;
  const path = handles.path;
  const heart = handles.heart;
  const ring = handles.ringSvg;
  if (!root || !path || !heart || !ring) { c.check("mounts: the section handed out its SVG handles", false, `root ${!!root}, path ${!!path}, heart ${!!heart}, ring ${!!ring}`); return; }
  await mounts(c, { host: "com.horcrux.svg.SvgView", ios: { host: "RNSVGSvgView" } }, root as unknown as Host);
  // commands: the library's own TurboModule answers for the native shape
  const length = (await c.until(() => typeof path.getTotalLength() === "number", 4000)) ? path.getTotalLength() : undefined;
  c.check("commands: getTotalLength reads the path from the native view (the check mark is 22.6 units long)", typeof length === "number" && length > 20 && length < 60, `length ${String(length)}`);
  const bounds = path.getBBox();
  c.check("commands: getBBox answers the path's box", !!bounds && bounds.width > 10 && bounds.height > 5, JSON.stringify(bounds));
  const dataUrl = await new Promise<string | null>((resolve) => { const timer = setTimeout(resolve, 4000, null); root.toDataURL((value) => { clearTimeout(timer); resolve(value); }, { width: 40, height: 40 }); });
  const drawn = dataUrl ? c.read(dataUrl, [[0.5, 0.5]], 0) : null;
  c.check("commands: toDataURL draws the Svg to a base64 PNG", !!drawn && drawn.format === "image/png" && drawn.width > 0, drawn ? `${drawn.width}x${drawn.height} ${drawn.format}` : "no image");
  if (!c.canLook) {
    c.skip("capture: the heart and the gradient card are drawn, a prop update repaints the heart, the ring is animated", "no pixel reader on this platform yet");
  } else {
    // the heart (a 24 unit view box in a 34 dp Svg): its middle is its fill; the card (a 58 x 34 dp Svg): orange at the top left, teal at the bottom right
    const middle = await c.point(heart as unknown as Host, 0.5, 0.52);
    const top = await c.point(root as unknown as Host, 0.12, 0.35);
    const bottom = await c.point(root as unknown as Host, 0.88, 0.65);
    if (!middle || !top || !bottom) c.check("capture: the icons have a layout", false, `${middle} ${top} ${bottom}`);
    else {
      await colours(c, "capture: the heart is its fill colour and the card's gradient runs orange to teal", [middle, top, bottom], ["#e5484d", "#ff7a18", "#319197"], 55);
      c.lab.svgHeart = "#0091ff";
      await c.pause(500);
      await colours(c, "prop update: a new fill reaches the native path", [middle], ["#0091ff"], 40);
    }
    // the ring: `strokeDashoffset` and the dot's `r` follow one shared value on the UI thread, so captures a moment apart differ
    const cover = await c.point(ring as unknown as Host, 0.5, 0.88);
    const dot = await c.point(ring as unknown as Host, 0.5 + 0.125, 0.5);
    if (!cover || !dot) c.check("animation: the ring has a layout", false);
    else {
      const seen = new Set<string>();
      for (let frame = 0; frame < 8; frame++) {
        const look = await c.look([cover, dot], { radius: 0 });
        if (look) seen.add(look.colors.map((value) => (solid(value) ? "1" : "0")).join(""));
        await c.pause(230);
      }
      c.check("animation: animatedProps move the native ring (its bottom arc and the dot appear and go)", seen.size >= 2, `states seen: ${[...seen].join(", ")}`);
    }
  }
  if (!c.canTap) { c.skip("events: a press on the Svg (pointerEvents box-only) reaches its onPress", "a press needs a finger: the lab has none on the iPhone (XCUITest does not run on it)"); return; }
  const presses = c.events("svg-press");
  await c.tap(root as unknown as Host);
  c.check("events: a press on the Svg (pointerEvents box-only) reaches its onPress", await c.until(() => c.events("svg-press") > presses, 3000));
}

export const libraryChecks: Record<LibraryKind, (c: Ctx) => Promise<void>> = {
  image, blur, gradient, video, datetime, lottie, pdf, capture, rive, conic, shadow, text, svg,
};
