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
  /** The run was opened with `drive:adb`: the harness presses what `press` asks for. */
  readonly driven: boolean;
  readonly lab: typeof libraryLab;
  handles(): LibraryHandles;
  host(): Host | undefined;
  box(): Host | undefined;
  check(name: string, passed: boolean, detail?: string): void;
  skip(name: string, why: string): void;
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

const describe = (info: Native | null): string => (info ? `${info.class.split(".").pop()} ${info.width}x${info.height}px at ${info.x},${info.y}${info.attached ? "" : " detached"}${info.shown ? "" : " hidden"}` : "no native view");

/**
 * The common part: a native view of the library's class is attached, shown and sized, and its size is the layout the engine measured. Waits for
 * it (a view appears after the engine's frame). [pattern] is matched against the view's class and the classes inside it (a library whose native
 * view sits behind children is reached through its container).
 */
async function mounts(c: Ctx, pattern: RegExp, host: Host | undefined = c.host()): Promise<Native | null> {
  if (!host) { c.check("mounts: the section handed out its host handle", false, "no handle"); return null; }
  if (!c.canInspect) {
    const rect = await c.rect(host);
    c.check("mounts: the engine measured a layout for it", !!rect && rect.width > 0 && rect.height > 0, JSON.stringify(rect));
    c.skip("mounts: the platform built a view of the library's class", "no native inspection on this platform yet");
    return null;
  }
  const ready = () => { const info = c.inspect(host); return !!info && info.attached && info.shown && info.width > 0 && info.height > 0; };
  const up = await c.until(ready, 10000);
  const info = c.inspect(host);
  c.check("mounts: a native view is attached, shown and sized", up, describe(info));
  if (!info) return null;
  // The Android class names are the libraries' own (read from their sources); the iOS ones are recorded in the detail for the first iPhone run to pin.
  if (c.android) c.check(`mounts: it is the library's view (${pattern.source})`, pattern.test(`${info.class} ${info.views.join(" ")}`), `${info.class}; inside: ${info.views.slice(0, 4).join(" | ")}`);
  else c.skip("mounts: it is the library's view", `iOS class names not pinned yet (this run saw ${info.class}; inside: ${info.views.slice(0, 3).join(" | ")})`);
  const rect = await c.rect(host);
  const wide = rect ? Math.abs(info.width / info.density - rect.width) : Infinity;
  const high = rect ? Math.abs(info.height / info.density - rect.height) : Infinity;
  c.check("layout: the native view has the size the engine measured", wide <= 1 && high <= 1, `native ${(info.width / info.density).toFixed(1)}x${(info.height / info.density).toFixed(1)} dp, measured ${rect ? `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}` : "none"}`);
  return info;
}

/** The colour at one point of a look, as a message. */
const at = (look: Look, index: number): string => show(look.colors[index] ?? 0);
const pixel = (look: Look, index: number): number => look.colors[index] ?? 0;

/**
 * [expected] colours at [points] of a capture of the box: one check for all, naming each point that missed. Skipped when the platform cannot read pixels.
 */
async function colours(c: Ctx, name: string, points: readonly (readonly [number, number])[], expected: readonly string[], tolerance = 40, options?: Parameters<Ctx["look"]>[1]): Promise<Look | null> {
  if (!c.canLook) { c.skip(name, "no pixel reader on this platform yet"); return null; }
  let look: Look | null = null;
  try {
    look = await c.look(points, options);
  } catch (error) {
    c.check(name, false, `the capture failed: ${String(error)}`);
    return null;
  }
  if (!look) { c.check(name, false, "the capture gave no pixels"); return null; }
  const missed = expected.flatMap((colour, index) => (near(pixel(look, index), colour, tolerance) ? [] : [`${points[index]?.join(",")} is ${at(look, index)}, wanted ${colour}`]));
  c.check(name, missed.length === 0, missed.length === 0 ? expected.map((_, index) => at(look, index)).join(" ") : missed.join("; "));
  return look;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-image

async function image(c: Ctx): Promise<void> {
  await mounts(c, /ExpoImageView/);
  c.check("events: onLoad arrives for the bundled image, with its url", await c.until(() => c.events("image-load") >= 1, 12000), `${c.events("image-load")} onLoad, ${c.events("image-error")} onError`);
  c.check("events: onDisplay arrives after onLoad", await c.until(() => c.events("image-display") >= 1, 4000));
  c.check("events: no onError for it", c.events("image-error") === 0);
  const loads = c.events("image-load");
  c.lab.image = "red";
  c.check("prop update: a new source loads (onLoad again)", await c.until(() => c.events("image-load") > loads, 8000));
  await c.pause(300);
  await colours(c, "prop update: the native view shows the red source", [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7]], ["#e5484d", "#e5484d", "#e5484d"], 12);
  const second = c.events("image-load");
  c.lab.image = "blue";
  c.check("prop update: and the next source loads too", await c.until(() => c.events("image-load") > second, 8000));
  await c.pause(300);
  await colours(c, "prop update: the native view shows the blue source", [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7]], ["#0091ff", "#0091ff", "#0091ff"], 12);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-blur: the stripes are red | yellow | green | blue | purple, the blur sits over the middle; at a stripe edge inside it the two sides come together

const redYellow = (y: number): [number, number][] => [[0.2 - 0.012, y], [0.2 + 0.012, y]];

async function blur(c: Ctx): Promise<void> {
  await mounts(c, /ExpoBlurView/);
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
  await mounts(c, /LinearGradientView/);
  await colours(c, "the gradient runs from its first colour at the start to its last at the end", [[0.02, 0.12], [0.98, 0.88]], ["#ff7a18", "#319197"], 45);
  c.lab.gradientColors = ["#00c853", "#2962ff"];
  await c.pause(400);
  await colours(c, "prop update: new colours reach the native view", [[0.02, 0.12], [0.98, 0.88]], ["#00c853", "#2962ff"], 45);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-video

async function video(c: Ctx): Promise<void> {
  await mounts(c, /ReactExoplayerView/);
  c.check("events: onLoadStart, onLoad (with a duration) and onReadyForDisplay arrive", (await c.until(() => c.events("video-load") >= 1 && c.events("video-ready") >= 1, 15000)) && c.events("video-load-start") >= 1, `${foreignSummary(c, ["video-load-start", "video-load", "video-ready", "video-progress", "video-error"])}`);
  c.check("events: no onError", c.events("video-error") === 0);
  c.check("events: onProgress keeps arriving while it plays", await progresses(c, 1200));
  if (c.canInspect) {
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
  // command: seek, read back through onSeek and the library's own position
  const seeks = c.events("video-seek");
  c.handles().video?.seek(1.2);
  c.check("command: seek raises onSeek", await c.until(() => c.events("video-seek") > seeks, 6000));
  try {
    const position = await c.handles().video?.getCurrentPosition();
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
  c.check("capture: with handleGLSurfaceViewOnAndroid the frame is in the image", !!full && full.colors.every(solid), full ? full.colors.map(show).join(" ") : "no capture");
  await c.pause(600);
  const after = c.inspect(c.host());
  c.check("capture: the video on screen did not move, resize or hide", !!before && !!after && before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height && after.shown && after.surfaces.length >= 1, `${describe(before)} -> ${describe(after)}; ${after?.surfaces.join(" | ")}`);
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

async function datetime(c: Ctx): Promise<void> {
  if (!c.android) {
    const host = c.host();
    c.check("mounts: the section handed out a view", !!host);
    c.skip("events: onValueChange for a pick, onDismiss", "a pick needs a finger on the picker: the iPhone");
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
    return Promise.race([open, new Promise<string>((resolve) => setTimeout(resolve, 8000, "timeout"))]).catch((error: unknown) => String(error));
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
  await mounts(c, /LottieAnimationView/);
  c.check("events: onAnimationLoaded arrives", await c.until(() => c.events("lottie-loaded") >= 1, 10000), `${foreignSummary(c, ["lottie-loaded", "lottie-failure"])}`);
  c.check("events: no onAnimationFailure", c.events("lottie-failure") === 0);
  const handle = c.handles().lottie;
  // The box is 96 dp high and 395 wide, and the 100 x 100 composition fits its height: 24 of its units are 24 dp, which is 24 / 395 of the width.
  const rect = await c.rect(c.box());
  const dp = rect ? 24 / rect.width : 0.06;
  handle?.pause();
  c.lab.lottieAutoPlay = false;
  c.lab.lottieProgress = 0;
  await c.pause(500);
  const small = await c.look([[0.5, 0.5], dotAt(dp)]);
  c.lab.lottieProgress = 0.5;
  await c.pause(500);
  const big = await c.look([[0.5, 0.5], dotAt(dp)]);
  if (!c.canLook) { c.skip("prop update: progress moves the animation (the dot is smaller at 0 than at 0.5)", "no pixel reader on this platform yet"); }
  else c.check("prop update: progress moves the animation (the dot is smaller at 0 than at 0.5)", !!small && !!big && solid(pixel(small, 0)) && near(pixel(small, 0), "#2e8cf2", 40) && !solid(pixel(small, 1)) && near(pixel(big, 1), "#2e8cf2", 40), `at 0: ${small ? small.colors.map(show).join(" ") : "none"}; at 0.5: ${big ? big.colors.map(show).join(" ") : "none"}`);
  // commands: play the whole animation once and hear it finish
  c.lab.lottieLoop = false;
  await c.pause(300);
  const finishes = c.events("lottie-finish");
  handle?.reset();
  handle?.play(0, 60);
  c.check("commands: play raises onAnimationFinish when a non-looping animation ends", await c.until(() => c.events("lottie-finish") > finishes, 6000), `${c.events("lottie-finish")} finish events`);
  const lastFinish = c.events("lottie-finish", false);
  c.check("commands: and it ended, not cancelled", lastFinish >= 1, `${lastFinish} with isCancelled false`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-pdf: page 1 is blue, page 2 green

async function pdf(c: Ctx): Promise<void> {
  await mounts(c, /PdfView/);
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
  await mounts(c, /ReactViewGroup|EngineView/, shot);
  if (!c.canLook) { c.skip("capture: the rounded card keeps its corners, scale, jpg, base64 and data-uri results", "no pixel reader on this platform yet"); return; }
  const card = shot;
  // 1. the card (a 16 dp radius, overflow hidden, five stripes that reach the corners): transparent rounded corners, the stripes clipped to them
  const corners: [number, number][] = [[0.02, 0.03], [0.98, 0.03], [0.02, 0.97], [0.98, 0.97], [0.5, 0.5], [0.1, 0.5], [0.9, 0.5]];
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
    const darker = !!flat && !!raised && under.some((_, index) => argb(pixel(flat, index)).g - argb(pixel(raised, index)).g >= 12);
    c.check("capture: an elevated child casts a shadow in the image", darker, `flat ${flat?.colors.map(show).join(" ")}, elevated ${raised?.colors.map(show).join(" ")}`);
  } catch (error) {
    c.check("capture: an elevated child casts a shadow in the image", false, String(error));
  }
  // 2. the formats and results
  try {
    // the section's own capture(): a view that has just been laid out
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
  await mounts(c, /RiveReactNativeView/);
  c.check("events: onPlay arrives for the file's animation (the file needs the network)", await c.until(() => c.events("rive-play") >= 1, 20000), foreignSummary(c, ["rive-play", "rive-pause", "rive-stop", "rive-error"]));
  await c.pause(800);
  const middle = await colours(c, "capture: the animation is in the image (its middle is painted, not a hole)", [[0.5, 0.5], [0.45, 0.4], [0.55, 0.6]], ["#d62a5c", "#d62a5c", "#d62a5c"], 255, undefined);
  if (middle) c.check("capture: the animation's own background is opaque pink", middle.colors.every(solid) && argb(pixel(middle, 0)).r > 150 && argb(pixel(middle, 0)).g < 140, middle.colors.map(show).join(" "));
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
  await mounts(c, /ConicGradientView/);
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

async function shadow(c: Ctx): Promise<void> {
  await mounts(c, /FastShadowView/);
  const below: [number, number][] = [[0.5, 0.78], [0.5, 0.74]];
  if (!c.canLook) { c.skip("capture: the shadow is drawn outside the card (not clipped to its frame)", "no pixel reader on this platform yet"); }
  else {
    const withShadow = await c.look(below);
    c.check("the shadow is drawn below the card, outside its frame", !!withShadow && withShadow.colors.some((value) => argb(value).a > 20), withShadow ? withShadow.colors.map(show).join(" ") : "no capture");
    c.lab.shadowOpacity = 0;
    await c.pause(500);
    const without = await c.look(below);
    c.check("prop update: opacity 0 takes it away", !!without && without.colors.every(clear), without ? without.colors.map(show).join(" ") : "no capture");
    c.lab.shadowOpacity = 0.45;
  }
  const presses = c.events("shadow-press");
  await c.tap(c.host());
  c.check("events: a press on the child inside the shadow reaches JavaScript", await c.until(() => c.events("shadow-press") > presses, 3000));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-animateable-text: the number the shared value holds, written to the native text on the UI thread

async function text(c: Ctx): Promise<void> {
  await mounts(c, /Text/);
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
  c.check("it advances while the JavaScript thread is blocked", moved >= 8 && moved <= 30, `${before} -> ${after} over a 900 ms block (20 per second expected)`);
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
  await mounts(c, /SvgView/, root as unknown as Host);
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
  const presses = c.events("svg-press");
  await c.tap(root as unknown as Host);
  c.check("events: a press on the Svg (pointerEvents box-only) reaches its onPress", await c.until(() => c.events("svg-press") > presses, 3000));
}

export const libraryChecks: Record<LibraryKind, (c: Ctx) => Promise<void>> = {
  image, blur, gradient, video, datetime, lottie, pdf, capture, rive, conic, shadow, text, svg,
};
