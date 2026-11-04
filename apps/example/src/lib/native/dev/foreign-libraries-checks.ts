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
import { tick } from "svelte";
import type { Host, LibraryHandles, LibraryKind } from "./LibrarySet.svelte";
import { libraryLab } from "./foreign.svelte.ts";
import { argb, arrivedInOrder, clear, near, numberIn, riveBackdrop, show, solid, untilTaken } from "./foreign-pixels.ts";
import { pins, resolvePin, type Pinned } from "./foreign-pins.ts";

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
/** What the `UIDatePicker` inside a date picker section holds (iOS, `SvelteQA.datePicker`): the date in milliseconds, its `datePickerMode` and `preferredDatePickerStyle` raw values. */
export type PickerState = { date: number; mode: number; style: number };
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
  /**
   * iOS: the `UIDatePicker` of the date picker section, read (`read`), given a pick the way UIKit reports one (`change` to [milliseconds]: the date, then `valueChanged`) or told its editing
   * ended (`dismiss`: `editingDidEnd`). The answer is what the picker holds afterwards; null where the platform has no such picker.
   */
  picker(action: "read" | "change" | "dismiss", milliseconds?: number): PickerState | null;
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
  /** Every event the section raised since the place was opened, in the order it reached JavaScript. */
  history(): readonly { event: string; detail?: unknown }[];
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
  /** Whether the file a capture answered exists (JavaScript's view of the cache or tmp directory): a `file://` URI on Android, a plain absolute path on iOS (`isCaptureFile`). */
  exists(uri: string): boolean;
  /** `SvelteQaPixels.sample` for a source that is not a capture of the section (a result that came as a string). */
  read(source: string, points?: readonly (readonly [number, number])[], radius?: number): { colors: number[]; width: number; height: number; format: string } | null;
};

/** A command's promise, or "timeout" after [milliseconds]: a native module that cannot find its view never answers, and a check must say so instead of waiting for it. */
const within = <T>(promise: Promise<T> | undefined, milliseconds = 5000): Promise<T | "timeout" | undefined> =>
  promise === undefined ? Promise.resolve(undefined) : Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(resolve, milliseconds, "timeout"))]);

/**
 * Holds the JavaScript thread for [milliseconds] without yielding to anything: no timer, no event and no microtask runs meanwhile, so whatever the native side raises waits in React Native's
 * event queue until the hold ends. React Native's queue (`EventQueue::enqueueEvent`) replaces the unread event of a coalescable type that was queued last for a view, and only then.
 */
function hold(milliseconds: number): void {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { /* the JavaScript thread is held */ }
}

/**
 * The checks of the Android event patches (SPEC.md, "Events on Android"): [send] makes the native side raise two messages of one event name, back to back, from commands the UI thread runs
 * while this thread is held for [milliseconds], so that both wait in React Native's queue together; after the hold both must reach JavaScript, in the order they were raised. Without the
 * library's `canCoalesce() false` the queue would replace the first by the second. [iosWhy] says why the iPhone cannot lose them (it is Android-only there).
 */
async function bothArrive(c: Ctx, name: string, iosWhy: string, wanted: readonly (readonly [event: string, detail: unknown])[], send: () => void, milliseconds: number): Promise<void> {
  if (!c.android) { c.androidOnly(name, iosWhy); return; }
  const from = c.history().length;
  send();
  hold(milliseconds);
  const arrived = await c.until(() => arrivedInOrder(c.history(), from, wanted), 5000);
  const names = new Set(wanted.map(([event]) => event));
  c.check(name, arrived, `wanted ${wanted.map(([event, detail]) => `${event} ${String(detail)}`).join(", ")}; got ${c.history().slice(from).filter((entry) => names.has(entry.event)).map((entry) => `${entry.event} ${String(entry.detail)}`).join(", ") || "none"}`);
}

const describe = (info: Native | null): string => (info ? `${info.class.split(".").pop()} ${info.width}x${info.height}px at ${info.x},${info.y}${info.attached ? "" : " detached"}${info.shown ? "" : " hidden"}` : "no native view");

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
  // The pin of the platform: Android's classes are the libraries' own Kotlin and Java, iOS's what UIKit built for them (`foreign-pins.ts` says how each is spelled).
  const pin = resolvePin(c.android, pinned, info);
  const innerEntry = pin.entry;
  c.check(`mounts: it is the library's view (${pin.name})`, pin.there, `${info.class}; inside: ${info.views.slice(0, 4).join(" | ")}`);
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
async function colours(c: Ctx, name: string, points: readonly (readonly [number, number])[], expected: readonly string[], tolerance = 40, options?: Parameters<Ctx["look"]>[1], settle?: { ms: number; explain: () => string; until?: (look: Look) => boolean }): Promise<Look | null> {
  if (!c.canLook) { c.skip(name, "no pixel reader on this platform yet"); return null; }
  const missesOf = (look: Look): string[] => expected.flatMap((colour, index) => (near(pixel(look, index), colour, tolerance) ? [] : [`${points[index]?.join(",")} is ${at(look, index)}, wanted ${colour}`]));
  // With [settle] the capture is taken again every 400 ms until it shows the colours (and satisfies [settle].until, when the caller's next check asks for more than these colours) or the time is up
  // (a slower phone draws a new image later than onLoad says it has it): what the last one shows is the check.
  let failure = "the capture gave no pixels";
  const { taken: seen, calls, waited } = await untilTaken(
    async () => {
      try { return await c.look(points, options); } catch (error) { failure = `the capture failed: ${String(error)}`; return null; }
    },
    (look) => missesOf(look).length === 0 && (settle?.until?.(look) ?? true),
    settle?.ms ?? 0,
    (milliseconds) => c.pause(milliseconds),
  );
  if (!seen) { c.check(name, false, failure); return null; }
  const missed = missesOf(seen);
  // A late paint says how late (calls and time), so the lab's logs measure the distribution a fixed wait only guessed at.
  const late = settle && calls > 1 ? ` | on capture ${calls}, ${waited} ms in` : "";
  c.check(name, missed.length === 0, missed.length === 0 ? `${expected.map((_, index) => at(seen, index)).join(" ")}${late}` : `${missed.join("; ")}${late}${settle ? ` | ${settle.explain()}` : ""}`);
  return seen;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-image

async function image(c: Ctx): Promise<void> {
  await mounts(c, pins.image);
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
  await mounts(c, pins.blur);
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
  await mounts(c, pins.gradient, c.box(), c.host());
  await colours(c, "the gradient runs from its first colour at the start to its last at the end", [[0.02, 0.12], [0.98, 0.88]], ["#ff7a18", "#319197"], 45);
  // expo-linear-gradient on Android cannot unset `locations` (its prop setter ignores null), so a new list keeps the length.
  c.lab.gradientColors = ["#00c853", "#ffd600", "#2962ff"];
  await c.pause(400);
  await colours(c, "prop update: new colours reach the native view", [[0.02, 0.12], [0.98, 0.88]], ["#00c853", "#2962ff"], 45);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-video

async function video(c: Ctx): Promise<void> {
  await mounts(c, pins.video);
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
  // A pause and the resume right after it are two onPlaybackStateChanged (false, then true) on the UI thread; held JavaScript would see the second alone if the event could coalesce.
  await bothArrive(c, "events: pause() then resume() raise both onPlaybackStateChanged although the JS thread was busy",
    "the loss is Android's: its one `VideoCustomEvent` class coalesced in React Native's event queue; iOS's RCTVideo is a legacy view manager whose events React Native's interop layer sends with `dispatchEvent`, which the queue never replaces",
    [["video-state", false], ["video-state", true]],
    () => { const video = c.handles().video; void Promise.allSettled([video?.pause(), video?.resume()]); }, 1000);
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
  else c.androidOnly("capture: without handleGLSurfaceViewOnAndroid the video is a hole", "the option and the hole belong to Android's SurfaceView");
  // iOS: react-native-view-shot draws the view hierarchy, and an AVPlayerLayer's decoded frames are not part of it (the first iPhone run, 4 Nov 2026: the
  // three points read #000000/0, transparent, in every place while the video played), so the frame is in a capture on Android only.
  if (c.android) c.check("capture: with handleGLSurfaceViewOnAndroid the frame is in the image", !!full && full.colors.every(solid), full ? full.colors.map(show).join(" ") : "no capture");
  else c.androidOnly("capture: with handleGLSurfaceViewOnAndroid the frame is in the image", "a snapshot of the view hierarchy does not hold an AVPlayerLayer's video frames on iOS (transparent on the iPhone)");
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

/**
 * The iOS picker is a view (`RNDateTimePickerComponentView` holding a `UIDatePicker`), so its props and events are the ones to check. The lab has no finger on the phone: the QA module gives the
 * `UIDatePicker` what a finger gives it (the new date, then UIKit's own `valueChanged` and `editingDidEnd` control events), and everything after that is the library's: the view turns the
 * control event into `onChange` and `onPickerDismiss`, the wrapper into `onValueChange` and `onDismiss`, and a `value` or `mode` prop reaches the picker.
 */
async function iosPicker(c: Ctx): Promise<void> {
  const start = Date.UTC(2026, 9, 28, 12, 0, 0);
  const initial = c.picker("read");
  c.check("props: the picker holds the date of the value prop", !!initial && initial.date === start, initial ? `${new Date(initial.date).toISOString()}, mode ${initial.mode}` : "no UIDatePicker");
  const picked = Date.UTC(2026, 10, 15, 8, 30, 0);
  const afterPick = c.picker("change", picked);
  c.check("events: onValueChange arrives with the date the picker holds after a pick", await c.until(() => c.events("date-picked", new Date(picked).toISOString()) >= 1, 4000), `${c.events("date-picked")} picks heard; the picker holds ${afterPick ? new Date(afterPick.date).toISOString() : "nothing"}`);
  await c.pause(400);
  const held = c.picker("read");
  c.check("props: the date the handler stored comes back to the picker as its value", !!held && held.date === picked, held ? new Date(held.date).toISOString() : "no UIDatePicker");
  const changed = Date.UTC(2027, 0, 20, 12, 0, 0);
  c.lab.dateValue = changed;
  c.check("prop update: a new value reaches the picker", await c.until(() => c.picker("read")?.date === changed, 4000), c.picker("read") ? new Date(c.picker("read")?.date ?? 0).toISOString() : "no UIDatePicker");
  const before = c.picker("read")?.mode;
  c.lab.dateMode = "time";
  c.check("prop update: mode time changes the picker's mode", await c.until(() => { const mode = c.picker("read")?.mode; return mode !== undefined && mode !== before; }, 4000), `datePickerMode ${before} -> ${c.picker("read")?.mode}`);
  c.lab.dateMode = "date";
  c.picker("dismiss");
  c.check("events: onDismiss arrives when the picker ends editing", await c.until(() => c.events("date-dismissed") >= 1, 4000), `${c.events("date-dismissed")} dismissals heard`);
}

async function datetime(c: Ctx): Promise<void> {
  if (!c.android) {
    await mounts(c, pins.datetime);
    await iosPicker(c);
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
  await mounts(c, pins.lottie);
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
  // Two plays cancelled by a reset each are two onAnimationFinish(true) on the UI thread; held JavaScript would see one if the event could coalesce.
  await bothArrive(c, "events: two cancelled animations raise both onAnimationFinish although the JS thread was busy",
    "the loss is Android's: its three event classes coalesced in React Native's event queue; iOS sends the events through the codegen emitter's `dispatchEvent`, which the queue never replaces",
    [["lottie-finish", true], ["lottie-finish", true]],
    () => { handle?.play(0, 60); handle?.reset(); handle?.play(0, 60); handle?.reset(); }, 1000);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-pdf: page 1 is blue, page 2 green

async function pdf(c: Ctx): Promise<void> {
  await mounts(c, pins.pdf);
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
  await loadsWhileBusy(c);
}

/** How many Fabric transactions the host has committed (`fabricStats().flushes`, which the host publishes on `globalThis.__svelteFabric` so that app code needs no import). */
const hostFlushes = (): number => (globalThis as { __svelteFabric?: { stats(): { flushes: number } } }).__svelteFabric?.stats().flushes ?? 0;

/**
 * Android's view sends every message it has (loadComplete, pageChanged, scaleChanged, error, ...) as the one Fabric event `topChange`. An event that can coalesce is dispatched
 * as a unique one, and React Native's event queue replaces the unread unique event of the same type for the same view, so with the JavaScript thread busy `loadComplete` was
 * overwritten by the `pageChanged` the view posts 10 ms later (`patches/react-native-pdf@7.0.3.patch` makes the event non-coalescable). Any prop update redraws the document there
 * (`PdfManager.onAfterUpdateTransaction` calls `drawPdf`, which loads it again), so the page prop back to 1 is a reload. iOS has neither half: its `onChange` is a plain `dispatchEvent`
 * (never replaced), and PDFKit's view loads again only when `path` changes, not for a page.
 *
 * The hold starts in the task that commits the prop, so the race is forced by construction instead of left to timing. Setting the prop queues Svelte's microtask, which runs the effects
 * that carry it to the host; the host's `onInvalidate` queues its own microtask (`queueMicrotask(flush)`, `host.ts`), which runs `completeRoot` and so hands the transaction to the UI
 * thread; `tick()` resolves after both, so the continuation below runs with the commit already made. It then holds the thread at once. A timer hop between the commit and the hold
 * (the first version waited `pause(0)`) is a turn of the event loop, in which a fast phone's inline decode (about 4 ms) could already have delivered `loadComplete` to JavaScript; there is
 * no such turn now, so whatever the load raises (`loadComplete` and the `pageChanged` 10 ms after it) waits in the queue together. The check reads `flushes` to say so when the commit was not made.
 */
async function loadsWhileBusy(c: Ctx): Promise<void> {
  const name = "events: onLoadComplete arrives although the JS thread was busy while the document loaded";
  if (!c.android) { c.androidOnly(name, "the loss is Android's: its one `topChange` event coalesces; iOS sends `onChange` through the codegen emitter's `dispatchEvent`, which the queue never replaces, and loads again only when `path` changes"); return; }
  const loads = c.events("pdf-load");
  const flushed = hostFlushes();
  c.lab.pdfPage = 1;
  await tick();
  const committed = hostFlushes() > flushed;
  hold(1500);
  c.check(name, committed && (await c.until(() => c.events("pdf-load") > loads, 5000)), `${loads} -> ${c.events("pdf-load")} onLoadComplete; ${foreignSummary(c, ["pdf-page", "pdf-error"])}${committed ? "" : "; the host had not committed the page prop when the hold began"}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// react-native-view-shot

/**
 * What a `tmpfile` result is on this platform, as the library's own native code answers it. Android: a `file://` URI (`Uri.fromFile(output)` in `ViewShot.java`). iOS: the plain
 * path React Native's `RCTTempFilePath` made, `<app container>/tmp/ReactNative/<uuid>.<ext>` (`RNViewShot.mm` resolves `path` as it is; the README says to prepend `file://` for
 * `expo-sharing`), which is also the form its `releaseCapture` compares with `tmp/ReactNative`: a `file://` prefix would make that a no-op.
 */
const isCaptureFile = (c: Ctx, uri: string): boolean => (c.android ? uri.startsWith("file://") : uri.startsWith("/") && uri.includes("/tmp/ReactNative/"));
/** The end of a path, with an ellipsis when it is cut (a detail that shows `tNative/<uuid>.png` reads as a broken path). */
const tail = (uri: string, length = 64): string => (uri.length > length ? `…${uri.slice(-length)}` : uri);

async function capture(c: Ctx): Promise<void> {
  const shot = c.handles().hosts.capture;
  if (!shot) { c.check("mounts: the ViewShot handed out its host handle", false, "no handle"); return; }
  await mounts(c, pins.capture, shot);
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
    c.check("capture: ViewShot.capture() answers a file and onCapture hears it", isCaptureFile(c, viaShot) && c.exists(viaShot) && (await c.until(() => c.events("viewshot-capture") > heard, 2000)), `${tail(viaShot)}, ${c.events("viewshot-capture")} onCapture, ${c.events("viewshot-failure")} onCaptureFailure`);
    if (viaShot) releaseCapture(viaShot);
    const own = await c.handles().capture();
    c.check("capture: the section's capture() answers a file that exists", isCaptureFile(c, own) && c.exists(own), tail(own));
    releaseCapture(own);
    const rectCard = await c.rect(card);
    const jpg = await c.shot({ format: "jpg", quality: 0.9 }, card);
    const jpgLook = c.read(jpg, [[0.5, 0.5]], 1);
    c.check("capture: format jpg gives a JPEG", jpgLook?.format === "image/jpeg", `${jpgLook?.format}`);
    const scaled = await c.shot({ width: 40, height: 30 }, card);
    const scaledLook = c.read(scaled, [[0.5, 0.5]], 0);
    // The options reach the module as given. Android's library draws exactly that many pixels; iOS's draws at the screen's scale (`UIGraphicsImageRendererFormat.scale = 0` in `RNViewShot.mm`),
    // so 40 x 30 is 40 x 30 points and the image is that times the scale (the README's "twice/3-times bigger" is the same thing).
    const scale = c.android ? 1 : (c.inspect(card)?.density ?? 1);
    c.check("capture: width and height scale the image", scaledLook?.width === 40 * scale && scaledLook?.height === 30 * scale, `${scaledLook?.width}x${scaledLook?.height}, wanted ${40 * scale}x${30 * scale} (40x30 at ${scale}x)`);
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
  await mounts(c, pins.rive);
  c.check("events: onPlay arrives for the file's animation (the file needs the network)", await c.until(() => c.events("rive-play") >= 1, 20000), foreignSummary(c, ["rive-play", "rive-pause", "rive-stop", "rive-error"]));
  // `onPlay` is raised when the file is set up and the animation starts, not when a frame has reached the TextureView and the window has latched it (a row has its neighbours mounted too, on
  // a software-GL emulator: one capture 800 ms after `onPlay` was a hole in one run of 24). The capture is asked again every 400 ms until the middle is painted; a view that never
  // draws still fails, and the message says what the view is and what Rive raised. The loop used to stop on "opaque at three points" while the next check wants the artboard's pink at one of
  // them; it now waits for both (`riveBackdrop`), so a capture that ends the loop is one the check accepts.
  const explain = () => {
    const native = c.inspect(c.host());
    return `${native ? `${native.surfaces.join(", ") || "no texture"}, attached=${native.attached} shown=${native.shown}` : "no native view"}; ${foreignSummary(c, ["rive-play", "rive-error"])}`;
  };
  const middle = await colours(c, "capture: the animation is in the image (its middle is painted, not a hole)", [[0.5, 0.5], [0.45, 0.4], [0.55, 0.6]], ["#d62a5c", "#d62a5c", "#d62a5c"], 255, undefined, { ms: c.where === "row" ? 10000 : 5000, explain, until: (look) => riveBackdrop(look.colors) });
  // The artboard's own background is pink; the truck drives over the middle of it, so one of three points away from each other is enough.
  if (middle) c.check("capture: the animation's background is there (opaque, pink at one of three points)", riveBackdrop(middle.colors), middle.colors.map(show).join(" "));
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
  // Two animations of the Truck artboard played in turn are two onPlay with their own names on the UI thread; held JavaScript would see one if the event could coalesce (the file is Rive's `vehicles.riv`:
  // the artboard "Truck" has the animations idle, curves and bounce and the state machine bumpy; looping keeps both playing, so no onStop follows between).
  await bothArrive(c, "events: two animations played in turn raise both onPlay although the JS thread was busy",
    "the loss is Android's: its events went through `getJSModule(RCTEventEmitter)`, which React Native's interop turns into a coalescable `InteropEvent`; iOS's RiveReactNativeView is a legacy view manager whose events the interop layer sends with `dispatchEvent`, which the queue never replaces",
    [["rive-play", "curves:false"], ["rive-play", "bounce:false"]],
    () => { handle?.play("curves", "loop", "auto", false); handle?.play("bounce", "loop", "auto", false); }, 1000);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// expo-conic-gradient: hard stops make the right half of the turn red and the left half blue; a quarter turn... a half turn swaps them

async function conic(c: Ctx): Promise<void> {
  await mounts(c, pins.conic, c.box(), c.host());
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
  await mounts(c, pins.shadow, c.box(), c.host());
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
  await mounts(c, pins.text);
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
  await mounts(c, pins.svg, root as unknown as Host);
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
