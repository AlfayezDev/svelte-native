import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { mapsProblems, mapsStreamEvents, neverCoalesces, pdfProblems, lottieProblems, stripComments, videoEmitterProblems, videoProblems } from "../../src/doctor/shapes.ts";
import { readerFor } from "../../src/doctor/resolve.ts";
import { libraryPath } from "../support/paths.ts";
import { viewConfigs } from "./support/configs.ts";
import { libraryFile } from "./support/specs.ts";

/**
 * How the Android native-view libraries send their events (SPEC.md, "Foreign views", "Events on Android"): a Fabric event that can coalesce is replaced by the next one of its
 * name for the same view while the JavaScript thread is busy, so each library's event classes are pinned by what their installed source does now, and `svelte-native doctor`
 * asks the same of an app's install (`src/doctor/shapes.ts`, which nothing else tests). These are pins of third-party code: a library or React Native upgrade that changes one
 * fails here and sends whoever upgrades back to the events.
 */
const withoutComments = (file: string): string => stripComments(libraryFile(file));

// Every message of react-native-pdf's Android view (loadComplete, pageChanged, scaleChanged, error, linkPressed, pageSingleTap) is the one Fabric event
// `topChange`. An event that can coalesce is dispatched as a unique one, and React Native's C++ event queue (`EventQueue::enqueueEvent`) replaces
// the unread unique event of the same type for the same view, so with the JavaScript thread busy the `loadComplete` of a document was overwritten by
// the `pageChanged` the view posts 10 ms later (28 of 182 emulator row mounts, 10 of 130 Samsung row mounts lost `onLoadComplete`). The patch
// (`react-native-pdf@7.0.3.patch` in the package's `patches/`) makes the event non-coalescable. iOS is not affected: its codegen emitter's `onChange` is a plain `dispatchEvent`.
test("react-native-pdf's topChange event, which carries every message of the Android view, does not coalesce", () => {
  const directory = libraryPath("react-native-pdf/android/src/main/java/org/wonday/pdf");
  const code = (file: string) => stripComments(libraryFile(`react-native-pdf/android/src/main/java/org/wonday/pdf/${file}`));
  const view = code("PdfView.java");
  const event = code("events/TopChangeEvent.java");
  // PdfView still puts several messages on the one event class (when the library splits them over events, this pin is to be revisited) ...
  const messages = new Set([...view.matchAll(/putString\("message", "(\w+)\|/g)].map((match) => match[1]));
  expect([...messages].sort()).toEqual(["error", "linkPressed", "loadComplete", "pageChanged", "pageSingleTap", "scaleChanged"]);
  expect(view.match(/new TopChangeEvent\(/g)?.length).toBe(6);
  expect(readdirSync(resolve(directory, "events"))).toEqual(["TopChangeEvent.java"]);
  expect(event).toMatch(/getEventName\(\)\s*\{\s*return "topChange";\s*\}/);
  // ... so the event must not coalesce (React Native's `Event.canCoalesce()` is `true` unless a subclass overrides it).
  expect(neverCoalesces(event)).toBe(true);
  expect(pdfProblems(readerFor(libraryPath("react-native-pdf")))).toEqual([]);
});

// The same defect in three more libraries (SPEC.md, "Foreign views", "Events on Android"): Lottie, maps and video. `Event.canCoalesce()` is true unless a subclass overrides it, Fabric
// hands a coalescable event to C++ as a unique one, and the event queue replaces the unread unique event of the same name for the same view: with the JavaScript thread busy, two
// messages of one name reach JavaScript as the last one. Each library's Android events are pinned by what the library's source does now, so a version that adds an event class
// or a sender fails here until the new one is decided. Rive's events are patched for another reason (below). iOS cannot lose any of them: the
// codegen emitters (Lottie, maps, pdf) and React Native's legacy interop layer (RCTVideo, Rive) dispatch with `dispatchEvent`, never `dispatchUniqueEvent`.
// rive-react-native 9.7.1 sent its events through `getJSModule(RCTEventEmitter::class.java).receiveEvent(id, name, data)`, React Native's interop emitter. Its events did not coalesce
// (the emitter has no surface id, so React Native delivers each through the legacy path), but a bridgeless app reports every such call as a soft exception ("will stop working
// with interop disabled"), and a playing state machine makes several a second. The library's copy is patched (vendor-patches/rive-react-native): the seven events go through
// the view's event dispatcher, under their registered names, as an event class of its own that never coalesces. The test pins that shape in the copy.
test("rive-react-native's events go through the event dispatcher as events that cannot coalesce, under the names its view manager registers", async () => {
  const view = withoutComments("rive-react-native/android/src/main/java/com/rivereactnative/RiveReactNativeView.kt");
  const enumBody = /enum class Events\(private val mName: String\) \{([\s\S]*?);/.exec(view)?.[1] ?? "";
  const constants = [...enumBody.matchAll(/(\w+)\(\s*"(on\w+)"\s*\)/g)].map((match) => [match[1] as string, match[2] as string] as const);
  expect(constants.map(([, name]) => name).sort()).toEqual(["onError", "onLoopEnd", "onPause", "onPlay", "onRiveEventReceived", "onStateChanged", "onStop"]);
  for (const [constant] of constants) expect(view, constant).toMatch(new RegExp(`dispatch\\(Events\\.${constant}\\.toString\\(\\), \\w+\\)`));
  // No event of the old emitter is left, and the dispatcher is the view's own, with its surface.
  expect(view).not.toContain("RCTEventEmitter");
  expect(view).toMatch(/UIManagerHelper\.getEventDispatcherForReactTag\(reactContext, id\)/);
  expect(view).toMatch(/RiveViewEvent\(UIManagerHelper\.getSurfaceId\(reactContext\), id, name, data\)/);
  // The event class never coalesces, and its name is the one dispatched (the names the view manager exports as direct events).
  expect(view).toMatch(/private class RiveViewEvent\([^)]*\) : Event<RiveViewEvent>\(surfaceId, viewTag\) \{[\s\S]*?override fun getEventName\(\): String = name[\s\S]*?override fun canCoalesce\(\): Boolean = false/);
  const manager = withoutComments("rive-react-native/android/src/main/java/com/rivereactnative/RiveReactNativeViewManager.kt");
  expect(manager).toMatch(/builder\.put\(event\.toString\(\), MapBuilder\.of\("registrationName", event\.toString\(\)\)\)/);
});

test("react-native-maps' discrete events do not coalesce and its streams still do", () => {
  const directory = libraryPath("react-native-maps/android/src/main/java/com/rnmaps/fabric/event");
  // Streams: a position or a region per frame of a drag, a pan or a camera move, or per GPS fix, where the latest message replaces the earlier ones and coalescing is the saving.
  const streams = ["OnDragEvent", "OnMarkerDragEvent", "OnPanDragEvent", "OnRegionChangeEvent", "OnUserLocationChangeEvent"];
  expect([...mapsStreamEvents]).toEqual(streams);
  // Everything else is one message per user act, state change or load, and keeps its own payload (an `action`, a marker `id`, a region, a coordinate).
  const discrete = [
    "OnCalloutPressEvent", "OnDeselectEvent", "OnDoublePressEvent", "OnDragEndEvent", "OnDragStartEvent", "OnIndoorBuildingFocusedEvent", "OnIndoorLevelActivatedEvent", "OnKmlReadyEvent",
    "OnLongPressEvent", "OnMapLoadedEvent", "OnMapReadyEvent", "OnMarkerDeselectEvent", "OnMarkerDragEndEvent", "OnMarkerDragStartEvent", "OnMarkerPressEvent", "OnMarkerSelectEvent",
    "OnPoiClickEvent", "OnPressEvent", "OnRegionChangeCompleteEvent", "OnRegionChangeStartEvent", "OnSelectEvent",
  ];
  expect(readdirSync(directory).map((file) => file.replace(/\.java$/, "")).sort()).toEqual([...discrete, ...streams].sort());
  for (const name of discrete) expect(neverCoalesces(withoutComments(`react-native-maps/android/src/main/java/com/rnmaps/fabric/event/${name}.java`)), name).toBe(true);
  for (const name of streams) expect(withoutComments(`react-native-maps/android/src/main/java/com/rnmaps/fabric/event/${name}.java`), name).not.toContain("canCoalesce");
  // The same check over the whole directory, as `svelte-native doctor` makes it of an app's install.
  expect(mapsProblems(readerFor(libraryPath("react-native-maps")))).toEqual([]);
  // `topPress` of the map's tag is one event for several kinds of press, and the map attaches an `action` to every message of its press and selection events: these nine are what MapView.java sends.
  const view = withoutComments("react-native-maps/android/src/main/java/com/rnmaps/maps/MapView.java");
  const actions = new Set([...view.matchAll(/putString\("action", "([a-z-]+)"\)/g)].map((match) => match[1]));
  expect([...actions].sort()).toEqual(["callout-press", "long-press", "marker-deselect", "marker-press", "marker-select", "overlay-press", "polygon-press", "polyline-press", "press"]);
  expect(view.match(/OnPressEvent::new/g)?.length).toBeGreaterThan(8);
});

test("lottie-react-native's three events do not coalesce", () => {
  const directory = libraryPath("lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie");
  const events = readdirSync(directory).filter((file) => /^On\w+Event\.kt$/.test(file)).sort();
  expect(events).toEqual(["OnAnimationFailureEvent.kt", "OnAnimationFinishEvent.kt", "OnAnimationLoadedEvent.kt"]);
  for (const file of events) {
    const code = withoutComments(`lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie/${file}`);
    expect(code, file).toMatch(/Event<On\w+>\(surfaceId, viewId\)/);
    expect(neverCoalesces(code), file).toBe(true);
  }
  expect(lottieProblems(readerFor(libraryPath("lottie-react-native")))).toEqual([]);
  expect(events.map((file) => /EVENT_NAME = "(\w+)"/.exec(withoutComments(`lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie/${file}`))?.[1])).toEqual(["topAnimationFailure", "topAnimationFinish", "topAnimationLoaded"]);
});

test("react-native-video's one event class does not coalesce except for the progress and the bandwidth estimate", () => {
  const emitter = withoutComments("react-native-video/android/src/main/java/com/brentvatne/common/react/VideoEventEmitter.kt");
  // One class carries every event, so the class decides by a flag the sender gives; a sender that says nothing is a discrete event, and the two streams
  // (progress, bandwidth), whose latest message replaces the earlier ones, say so. Every other event (load, error, seek, end, playback state, buffer, ready, the
  // track lists, ...) is discrete. The shape is `videoEmitterProblems`, which `svelte-native doctor` asks of an app's install too.
  expect(videoEmitterProblems(emitter)).toEqual([]);
  expect(videoProblems(readerFor(libraryPath("react-native-video")))).toEqual([]);
  const senders = [...emitter.matchAll(/event\.dispatch\(EventTypes\.(\w+)/g)].map((match) => match[1] as string);
  expect(senders.length).toBeGreaterThan(25);
  for (const name of ["EVENT_LOAD", "EVENT_ERROR", "EVENT_SEEK", "EVENT_END", "EVENT_PLAYBACK_STATE_CHANGED", "EVENT_BUFFER", "EVENT_READY"]) expect(senders, name).toContain(name);
});
