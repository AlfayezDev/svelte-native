import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { mapsProblems, mapsStreamEvents, neverCoalesces, pdfProblems, lottieProblems, stripComments, videoEmitterProblems, videoProblems } from "../../src/doctor/shapes.ts";
import { readerFor } from "../../src/doctor/resolve.ts";
import { nodeModules as modules } from "../support/paths.ts";
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
  const directory = resolve(modules, "react-native-pdf/android/src/main/java/org/wonday/pdf");
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
  expect(pdfProblems(readerFor(resolve(modules, "react-native-pdf")))).toEqual([]);
});

// The same defect in three more libraries (SPEC.md, "Foreign views", "Events on Android"): Lottie, maps and video. `Event.canCoalesce()` is true unless a subclass overrides it, Fabric
// hands a coalescable event to C++ as a unique one, and the event queue replaces the unread unique event of the same name for the same view: with the JavaScript thread busy, two
// messages of one name reach JavaScript as the last one. Each library's Android events are pinned by what the library's source does now, so a version that adds an event class
// or a sender fails here until the new one is decided. Rive needs no patch (its events go through React Native's interop emitter, pinned below). iOS cannot lose any of them: the
// codegen emitters (Lottie, maps, pdf) and React Native's legacy interop layer (RCTVideo, Rive) dispatch with `dispatchEvent`, never `dispatchUniqueEvent`.
// rive-react-native sends its events through `getJSModule(RCTEventEmitter::class.java).receiveEvent(id, name, data)`, and under Fabric that is React Native's `InteropEventEmitter`, which
// builds an `InteropEvent`. A first reading took that for a coalescable event (the class does not override `canCoalesce()`) and patched the library; it is not one: the emitter is made
// with the application context, which is not a `ThemedReactContext`, so its surface id is -1, and `Event.dispatchModern` sends an event with surface id -1 through the legacy `dispatch`,
// which ends in `receiveEvent(-1, ...)` of `RCTModernEventEmitter` with `canCoalesce` false. The test pins each link of that chain in the installed React Native, so an upgrade that
// changes one fails here and sends whoever upgrades back to the Rive events (the lab's check "two animations played in turn raise both onPlay" is the guard on a device).
test("rive-react-native's events reach JavaScript as events that cannot coalesce, because React Native's interop emitter has no surface id", async () => {
  const react = (file: string) => withoutComments(`react-native/ReactAndroid/src/main/java/com/facebook/react/${file}`);
  // The library: seven direct events, each sent through the interop emitter (no event class of its own, no dispatcher), by the view's id, under its registered name.
  const view = withoutComments("rive-react-native/android/src/main/java/com/rivereactnative/RiveReactNativeView.kt");
  const enumBody = /enum class Events\(private val mName: String\) \{([\s\S]*?);/.exec(view)?.[1] ?? "";
  const constants = [...enumBody.matchAll(/(\w+)\(\s*"(on\w+)"\s*\)/g)].map((match) => [match[1] as string, match[2] as string] as const);
  expect(constants.map(([, name]) => name).sort()).toEqual(["onError", "onLoopEnd", "onPause", "onPlay", "onRiveEventReceived", "onStateChanged", "onStop"]);
  for (const [constant] of constants) {
    expect(view, constant).toMatch(new RegExp(`getJSModule\\(RCTEventEmitter::class\\.java\\)\\s*\\.receiveEvent\\(id, Events\\.${constant}\\.toString\\(\\), `));
  }
  expect(view.match(/RCTEventEmitter::class\.java/g)?.length).toBe(constants.length);
  expect(view).not.toMatch(/Event<|getEventDispatcher|dispatchEvent|canCoalesce/);
  // `ThemedReactContext.getJSModule` is the application context's, and the application context answers `RCTEventEmitter` with the registered interop module.
  expect(react("uimanager/ThemedReactContext.kt")).toMatch(/override fun <T : JavaScriptModule> getJSModule\(jsInterface: Class<T>\): T =\s*reactApplicationContext\.getJSModule<T>\(jsInterface\)/);
  expect(react("runtime/BridgelessReactContext.kt")).toMatch(/mInteropModuleRegistry\?\.getInteropModule\(jsInterface\)\?\.let \{ interopModule ->[\s\S]*?return interopModule/);
  // React Native: Fabric registers `InteropEventEmitter(mReactApplicationContext)` for `RCTEventEmitter` ...
  expect(react("fabric/FabricUIManager.java")).toMatch(/new InteropEventEmitter\(mReactApplicationContext\);\s*mReactApplicationContext\.internal_registerInteropModule\(\s*RCTEventEmitter\.class, interopEventEmitter\)/);
  // ... whose events take their surface id from that context ...
  const emitter = react("internal/interop/InteropEventEmitter.kt");
  expect(emitter).toMatch(/class InteropEventEmitter\(private val reactContext: ReactContext\) : RCTEventEmitter/);
  expect(emitter).toMatch(/val surfaceId = UIManagerHelper\.getSurfaceId\(reactContext\)\s*dispatcher\?\.dispatchEvent\(InteropEvent\(eventName, params, surfaceId, targetTag\)\)/);
  // ... which is -1 for anything but a `ThemedReactContext` ...
  expect(react("uimanager/UIManagerHelper.kt")).toMatch(/fun getSurfaceId\(context: Context\?\): Int =\s*if \(context is ThemedReactContext\) \{\s*context\.surfaceId\s*\} else \{\s*-1\s*\}/);
  // ... and an event with surface id -1 skips `canCoalesce()`: `dispatchModern` hands it to `dispatch`, which calls the old-style `receiveEvent(viewTag, name, data)`, and the modern emitter's
  // default for that is `receiveEvent(-1, ...)` with `canCoalesceEvent` false, which `FabricEventEmitter` does not override (it implements only the two full overloads).
  const event = react("uimanager/events/Event.kt");
  expect(event).toMatch(/fun dispatchModern\(rctEventEmitter: RCTModernEventEmitter\) \{\s*if \(surfaceId != -1\) \{[\s\S]*?canCoalesce\(\),[\s\S]*?\} else \{\s*dispatch\(rctEventEmitter\)\s*\}/);
  expect(event).toMatch(/open fun dispatch\(rctEventEmitter: RCTEventEmitter\) \{\s*rctEventEmitter\.receiveEvent\(viewTag, eventName, getEventData\(\)\)/);
  const modern = react("uimanager/events/RCTModernEventEmitter.kt");
  expect(modern).toMatch(/override fun receiveEvent\(targetTag: Int, eventName: String, params: WritableMap\?\) \{\s*receiveEvent\(-1, targetTag, eventName, params\)/);
  expect(modern).toMatch(/fun receiveEvent\(surfaceId: Int, targetTag: Int, eventName: String, params: WritableMap\?\) \{\s*receiveEvent\(surfaceId, targetTag, eventName, false, 0, params, EventCategoryDef\.UNSPECIFIED\)/);
  const fabricEmitter = react("fabric/events/FabricEventEmitter.kt");
  expect([...fabricEmitter.matchAll(/override fun receiveEvent\(\s*surfaceId: Int,\s*targetTag: Int,\s*eventName: String,\s*canCoalesceEvent: Boolean,/g)].length).toBe(2);
  expect(fabricEmitter.match(/override fun receiveEvent\(/g)?.length).toBe(2);
  // `InteropEvent` sets nothing that would change that: it is the plain event with the surface id it is given.
  expect(react("internal/interop/InteropEvent.kt")).not.toMatch(/canCoalesce|dispatchModern/);
  // The coalescing itself, for the events that do have a surface id: `canCoalesceEvent` chooses the unique dispatch.
  expect(react("fabric/FabricUIManager.java")).toMatch(/if \(canCoalesceEvent\) \{\s*eventEmitter\.dispatchUnique\(eventName, params, eventTimestamp\);\s*\} else \{\s*eventEmitter\.dispatch\(eventName, params, eventCategory, eventTimestamp\);/);
  // Fabric routes an event by its normalised name: C++ turns `onPlay` into `topPlay`, and the view config registers `topPlay` as `onPlay`.
  const rule = libraryFile("react-native/ReactCommon/react/renderer/core/EventEmitter.cpp");
  expect(rule).toMatch(/hasPrefix\(prefixedType, "on"\)\)\s*\{\s*return "top" \+ prefixedType\.substr\(2\);/);
  const config = (await viewConfigs("android")).viewConfigFor("RiveReactNativeView", "android");
  for (const [, name] of constants) expect(config.events.get(`top${name.slice(2)}`), name).toBe(name);
});

test("react-native-maps' discrete events do not coalesce and its streams still do", () => {
  const directory = resolve(modules, "react-native-maps/android/src/main/java/com/rnmaps/fabric/event");
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
  expect(mapsProblems(readerFor(resolve(modules, "react-native-maps")))).toEqual([]);
  // `topPress` of the map's tag is one event for several kinds of press, and the map attaches an `action` to every message of its press and selection events: these nine are what MapView.java sends.
  const view = withoutComments("react-native-maps/android/src/main/java/com/rnmaps/maps/MapView.java");
  const actions = new Set([...view.matchAll(/putString\("action", "([a-z-]+)"\)/g)].map((match) => match[1]));
  expect([...actions].sort()).toEqual(["callout-press", "long-press", "marker-deselect", "marker-press", "marker-select", "overlay-press", "polygon-press", "polyline-press", "press"]);
  expect(view.match(/OnPressEvent::new/g)?.length).toBeGreaterThan(8);
});

test("lottie-react-native's three events do not coalesce", () => {
  const directory = resolve(modules, "lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie");
  const events = readdirSync(directory).filter((file) => /^On\w+Event\.kt$/.test(file)).sort();
  expect(events).toEqual(["OnAnimationFailureEvent.kt", "OnAnimationFinishEvent.kt", "OnAnimationLoadedEvent.kt"]);
  for (const file of events) {
    const code = withoutComments(`lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie/${file}`);
    expect(code, file).toMatch(/Event<On\w+>\(surfaceId, viewId\)/);
    expect(neverCoalesces(code), file).toBe(true);
  }
  expect(lottieProblems(readerFor(resolve(modules, "lottie-react-native")))).toEqual([]);
  expect(events.map((file) => /EVENT_NAME = "(\w+)"/.exec(withoutComments(`lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie/${file}`))?.[1])).toEqual(["topAnimationFailure", "topAnimationFinish", "topAnimationLoaded"]);
});

test("react-native-video's one event class does not coalesce except for the progress and the bandwidth estimate", () => {
  const emitter = withoutComments("react-native-video/android/src/main/java/com/brentvatne/common/react/VideoEventEmitter.kt");
  // One class carries every event, so the class decides by a flag the sender gives; a sender that says nothing is a discrete event, and the two streams
  // (progress, bandwidth), whose latest message replaces the earlier ones, say so. Every other event (load, error, seek, end, playback state, buffer, ready, the
  // track lists, ...) is discrete. The shape is `videoEmitterProblems`, which `svelte-native doctor` asks of an app's install too.
  expect(videoEmitterProblems(emitter)).toEqual([]);
  expect(videoProblems(readerFor(resolve(modules, "react-native-video")))).toEqual([]);
  const senders = [...emitter.matchAll(/event\.dispatch\(EventTypes\.(\w+)/g)].map((match) => match[1] as string);
  expect(senders.length).toBeGreaterThan(25);
  for (const name of ["EVENT_LOAD", "EVENT_ERROR", "EVENT_SEEK", "EVENT_END", "EVENT_PLAYBACK_STATE_CHANGED", "EVENT_BUFFER", "EVENT_READY"]) expect(senders, name).toContain(name);
});
