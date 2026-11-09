import { expect, test } from "bun:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { mapsProblems, mapsStreamEvents, neverCoalesces, pdfProblems, lottieProblems, stripComments, videoEmitterProblems, videoProblems } from "../src/doctor/shapes.ts";
import { readerFor } from "../src/doctor/resolve.ts";
import { createHarness } from "./foreign-harness.ts";

/**
 * The twelve native-view libraries (expo-image, expo-blur, expo-linear-gradient, react-native-video, @react-native-community/datetimepicker,
 * lottie-react-native, react-native-pdf with react-native-blob-util, react-native-view-shot, rive-react-native, expo-conic-gradient,
 * react-native-fast-shadow, react-native-animateable-text; SPEC.md, "Foreign views"): what the entry `@example/svelte-native/foreign`
 * pulls into a bundle, and the static view configs that are not compared with a TypeScript spec in `foreign.test.ts`. React must stay
 * out: the components mount the native views by name and port the libraries' prop handling, so nothing of the libraries' JavaScript
 * (which imports React) is bundled.
 */
const modules = resolve(import.meta.dirname, "../../../node_modules");
const libraries = [
  "expo-image", "expo-blur", "expo-linear-gradient", "expo-video", "react-native-video", "@react-native-community/datetimepicker", "lottie-react-native", "react-native-webview", "react-native-maps",
  "react-native-pdf", "react-native-blob-util", "react-native-view-shot", "rive-react-native", "expo-conic-gradient", "react-native-fast-shadow", "react-native-animateable-text",
];
const components = ["ExpoImage", "BlurView", "BlurTargetView", "LinearGradient", "Video", "DateTimePicker", "LottieView", "Pdf", "ViewShot", "Rive", "ConicGradient", "ShadowedView", "AnimateableText"];
const helpers = ["image", "gradient", "video", "datetime", "lottie", "pdf", "capture", "rive", "shadow"];

type Bundle = { externals: string[]; inputs: string[] };
async function bundleForeignEntry(): Promise<Bundle> {
  const externals = new Set<string>();
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../src/foreign.ts")],
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false, metafile: true, logLevel: "silent",
    plugins: [{
      name: "foreign-entry",
      setup(builder) {
        // Everything the app's bundler resolves from React Native or Expo is external here, and recorded: a library or React among them fails the test below.
        builder.onResolve({ filter: /^(react|react-dom|react-native|expo|@react-native|@react-native-community|lottie-react-native|react-native-[\w-]+|expo-[\w-]+)(\/|$)/ }, (args) => {
          externals.add(args.path);
          return { path: args.path, external: true };
        });
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@example/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  return { externals: [...externals].sort(), inputs: Object.keys(result.metafile.inputs) };
}

test("the foreign entry bundles no React and none of the libraries' JavaScript, and reaches React Native only by deep paths", async () => {
  const { externals, inputs } = await bundleForeignEntry();
  // Nothing of React, React Native's index (which loads every component) or a library's package is imported.
  expect(externals.filter((path) => !path.startsWith("react-native/Libraries/")), "imports that are not React Native deep paths").toEqual([]);
  for (const path of inputs) {
    for (const library of ["react", "react-dom", "scheduler", ...libraries]) expect(path.includes(`node_modules/${library}/`), `${path} is part of the bundle`).toBe(false);
  }
  // The deep modules are native module accessors, `Platform`, the converters and the host's own registry code: no component that renders through React.
  const allowed = new Set([
    "react-native/Libraries/BatchedBridge/NativeModules",
    // The gesture host's JS receiver (`deviceEventEmitter` in `deps-rn.ts`): required with the first gesture, never at boot.
    "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter",
    "react-native/Libraries/Image/resolveAssetSource",
    "react-native/Libraries/Linking/Linking",
    // Right-to-left layouts (`ShadowedView`'s corner radii).
    "react-native/Libraries/ReactNative/I18nManager",
    // The host's lazy requires for a name its static tables do not list (`view-configs.ts`).
    "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload",
    "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry",
    "react-native/Libraries/StyleSheet/processColor",
    "react-native/Libraries/TurboModule/TurboModuleRegistry",
    "react-native/Libraries/Utilities/Platform",
  ]);
  for (const path of externals) {
    if (!path.startsWith("react-native/Libraries/StyleSheet/process")) expect(allowed.has(path), `${path} is not an allowed deep import`).toBe(true);
  }
  // The twelve libraries' components and helpers are part of the entry.
  for (const file of components) expect(inputs.some((path) => path.endsWith(`components/${file}.svelte`)), file).toBe(true);
  for (const file of helpers) expect(inputs.some((path) => path.endsWith(`fabric/foreign-${file}.ts`)), file).toBe(true);
});

test("no source of the package imports one of the libraries or React", () => {
  const sources = ["src/foreign.ts", "src/fabric/foreign.ts", ...helpers.map((name) => `src/fabric/foreign-${name}.ts`), ...components.map((name) => `src/components/${name}.svelte`)];
  for (const file of sources) {
    const text = readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
    for (const specifier of text.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      const path = specifier[1] ?? "";
      expect(/^(react|react\/.*|react-dom.*)$/.test(path) || libraries.some((library) => path === library || path.startsWith(`${library}/`)), `${file} imports ${path}`).toBe(false);
    }
  }
});

// The datetimepicker spec is Flow, which the TypeScript reader of `foreign.test.ts` cannot parse: its props are read from the source text.
function flowSpec(file: string): { props: string[]; colors: string[]; handlers: string[] } {
  const text = readFileSync(resolve(modules, file), "utf8");
  const body = /type NativeProps = \$ReadOnly<\{\|([\s\S]*?)\|\}>;/.exec(text)?.[1] ?? "";
  const props: string[] = [];
  const colors: string[] = [];
  const handlers: string[] = [];
  const members = [...body.matchAll(/^ {2}(\w+)\?: ([\s\S]*?),\n(?= {2}\w+\?:|$)/gm)];
  for (const [, name = "", type = ""] of members) {
    if (/EventHandler/.test(type)) handlers.push(name);
    else {
      props.push(name);
      if (/ColorValue/.test(type)) colors.push(name);
    }
  }
  return { props, colors, handlers };
}

test("the static config of RNDateTimePicker lists the props, colours and events of the library's Flow spec", async () => {
  const spec = flowSpec("@react-native-community/datetimepicker/src/specs/DateTimePickerNativeComponent.js");
  expect(spec.props.length).toBeGreaterThan(8);
  const loaded = await createHarness("ios").load("foreign-datetime-fixture.svelte");
  const config = loaded.configs.viewConfigFor("RNDateTimePicker", "ios");
  const base = loaded.configs.viewConfigFor("RCTView", "ios");
  const own = Object.keys(config.attributes).filter((key) => !(key in base.attributes)).sort();
  expect(own).toEqual([...spec.props].sort());
  expect(Object.keys(config.attributes).filter((key) => typeof config.attributes[key] === "function" && typeof base.attributes[key] !== "function").sort()).toEqual([...spec.colors].sort());
  const events = [...config.events.values()];
  for (const handler of spec.handlers) expect(events, handler).toContain(handler);
  // Android has no view: the config is the same table, and the component does not mount the name there (`foreign-datetime.test.ts`).
});

test("every prop and event the Android RCTVideo manager reads or emits is in the static config", async () => {
  const directory = resolve(modules, "react-native-video/android/src/main/java/com/brentvatne");
  const manager = readFileSync(resolve(directory, "exoplayer/ReactExoplayerViewManager.kt"), "utf8");
  const emitter = readFileSync(resolve(directory, "common/react/VideoEventEmitter.kt"), "utf8");
  const props = [...manager.matchAll(/@ReactProp\(name = (\w+)/g)].map((match) => new RegExp(`const val ${match[1]} =\\s*"(\\w+)"`).exec(manager)?.[1] ?? "");
  expect(props.length).toBeGreaterThan(20);
  const events = [...emitter.matchAll(/EVENT_\w+\("(on\w+)"\)/g)].map((match) => `top${(match[1] ?? "").slice(2)}`);
  expect(events.length).toBeGreaterThan(20);
  const loaded = await createHarness("android").load("foreign-video-fixture.svelte");
  const config = loaded.configs.viewConfigFor("RCTVideo", "android");
  for (const prop of props) expect(prop in config.attributes, `prop ${prop}`).toBe(true);
  for (const event of events) expect(config.events.has(event), `event ${event}`).toBe(true);
  // The shutter colour is the one colour prop.
  expect(typeof config.attributes.shutterColor).toBe("function");
});

// iOS mounts a view manager without codegen through React Native's interop layer, which builds the native view's event blocks from the props it is sent
// (`RCTComponentData`'s event setter: an event prop that is `true` becomes a block that sends `topX`, any other leaves the block nil, and an event the view
// raises with no block is dropped). React Native's own config for such a view lists each event as a `true` prop on iOS and none on Android.
const legacyManagers: [name: string, file: string][] = [
  ["RCTVideo", "react-native-video/ios/Video/RCTVideoManager.m"],
  ["RiveReactNativeView", "rive-react-native/ios/RiveReactNativeViewManager.m"],
];
// react-native-video's iOS manager also exports `onPlaybackStalled` and `onPlaybackResume`, which neither its JavaScript spec nor its component declare: nothing in JavaScript can ask for them.
const undeclaredEvents = new Set(["onPlaybackStalled", "onPlaybackResume"]);
const exportedEvents = (file: string): string[] =>
  [...readFileSync(resolve(modules, file), "utf8").matchAll(/RCT_EXPORT_VIEW_PROPERTY\(\s*(on\w+)\s*,\s*RCT(?:Direct|Bubbling)EventBlock\s*\)/g)].map((match) => match[1] as string).filter((event) => !undeclaredEvents.has(event));

for (const [name, file] of legacyManagers) {
  test(`the iOS config of ${name} sends every event its view manager exports as a handler prop, and Android's sends none`, async () => {
    const events = exportedEvents(file);
    expect(events.length).toBeGreaterThan(5);
    const ios = (await createHarness("ios").load("foreign-video-fixture.svelte")).configs;
    const android = (await createHarness("android").load("foreign-video-fixture.svelte")).configs;
    const config = ios.viewConfigFor(name, "ios");
    const registrations = new Set(config.events.values());
    for (const event of events) {
      expect(registrations.has(event), `${name} ${event} is an event of the config`).toBe(true);
      expect(config.attributes[event], `${name} ${event} is an iOS attribute`).toBe(true);
      // The handler a component gives is `true` in the payload; no handler leaves the prop out.
      expect(ios.createPayload({ [event]: true }, config)).toEqual({ [event]: true });
      expect(ios.createPayload({}, config)).toBeNull();
      expect(ios.diffPayload({ [event]: true }, {}, config)).toEqual({ [event]: null });
      expect(event in android.viewConfigFor(name, "android").attributes, `${name} ${event} on Android`).toBe(false);
      expect(android.createPayload({ [event]: true }, android.viewConfigFor(name, "android"))).toBeNull();
    }
    // A codegen component's emitter is created with its view, so the other libraries' iOS configs do not carry their own events as props.
    // (react-native-animateable-text's `JBAnimatedText` is codegen on iOS too, but its own hand-written view config, `AnimateableText.tsx`, lists
    // `onTextLayout` and `onInlineViewLayout` among its props on both platforms, so its table does and is not compared here.)
    const base = ios.viewConfigFor("RCTView", "ios");
    for (const other of ["LottieAnimationView", "RNDateTimePicker", "RNPDFPdfView", "RNCWebView", "RNMapsMapView", "RNMapsMarker"]) {
      const view = ios.viewConfigFor(other, "ios");
      for (const registration of view.events.values()) if (!base.events.has(`top${registration.slice(2)}`)) expect(registration in view.attributes, `${other} ${registration}`).toBe(false);
    }
  });
}

// react-native-pdf's spec is Flow too, with its members written `name: ?type,`.
function pdfSpec(file: string): { props: string[]; handlers: string[] } {
  const text = readFileSync(resolve(modules, file), "utf8");
  const body = /export type NativeProps = \$ReadOnly<\{\|([\s\S]*?)\|\}>;/.exec(text)?.[1] ?? "";
  const props: string[] = [];
  const handlers: string[] = [];
  for (const [, name = "", type = ""] of body.matchAll(/^\s+(\w+): (.*?),$/gm)) (/EventHandler/.test(type) ? handlers : props).push(name);
  return { props, handlers };
}

test("the static config of RNPDFPdfView lists the props of the library's Flow spec, the one bubbling event and the Android manager's props", async () => {
  const spec = pdfSpec("react-native-pdf/fabric/RNPDFPdfNativeComponent.js");
  expect(spec.props.length).toBeGreaterThan(15);
  expect(spec.handlers).toEqual(["onChange"]);
  const loaded = await createHarness("android").load("foreign-pdf-fixture.svelte");
  for (const platform of ["android", "ios"] as const) {
    const config = loaded.configs.viewConfigFor("RNPDFPdfView", platform);
    const base = loaded.configs.viewConfigFor("RCTView", platform);
    expect(Object.keys(config.attributes).filter((key) => !(key in base.attributes)).sort(), platform).toEqual(spec.props.filter((key) => !(key in base.attributes)).sort());
    expect(config.events.get("topChange")).toBe("onChange");
  }
  // The Android manager sets exactly these (its `@ReactProp`s and the delegate's two no-ops).
  const manager = readFileSync(resolve(modules, "react-native-pdf/android/src/main/java/org/wonday/pdf/PdfManager.java"), "utf8");
  const set = [...manager.matchAll(/@ReactProp\(name = "(\w+)"\)/g)].map((match) => match[1] as string);
  for (const prop of set) expect(spec.props, prop).toContain(prop);
  expect(/REACT_CLASS = "(\w+)"/.exec(manager)?.[1]).toBe("RNPDFPdfView");
});

// Every message of react-native-pdf's Android view (loadComplete, pageChanged, scaleChanged, error, linkPressed, pageSingleTap) is the one Fabric event
// `topChange`. An event that can coalesce is dispatched as a unique one, and React Native's C++ event queue (`EventQueue::enqueueEvent`) replaces
// the unread unique event of the same type for the same view, so with the JavaScript thread busy the `loadComplete` of a document was overwritten by
// the `pageChanged` the view posts 10 ms later (28 of 182 emulator row mounts, 10 of 130 Samsung row mounts lost `onLoadComplete`). The patch
// (`react-native-pdf@7.0.3.patch` in the package's `patches/`) makes the event non-coalescable. iOS is not affected: its codegen emitter's `onChange` is a plain `dispatchEvent`.
test("react-native-pdf's topChange event, which carries every message of the Android view, does not coalesce", () => {
  const directory = resolve(modules, "react-native-pdf/android/src/main/java/org/wonday/pdf");
  const code = (file: string) => stripComments(readFileSync(resolve(directory, file), "utf8"));
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
const withoutComments = (file: string): string => stripComments(readFileSync(resolve(modules, file), "utf8"));

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
  const rule = readFileSync(resolve(modules, "react-native/ReactCommon/react/renderer/core/EventEmitter.cpp"), "utf8");
  expect(rule).toMatch(/hasPrefix\(prefixedType, "on"\)\)\s*\{\s*return "top" \+ prefixedType\.substr\(2\);/);
  const config = (await createHarness("android").load("foreign-video-fixture.svelte")).configs.viewConfigFor("RiveReactNativeView", "android");
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

test("the static config of FastShadowView lists the props the Android manager reads, the colour converted", async () => {
  const manager = readFileSync(resolve(modules, "react-native-fast-shadow/android/src/main/java/com/reactnativefastshadow/FastShadowViewManager.java"), "utf8");
  const props = [...manager.matchAll(/@ReactProp\(name = "(\w+)"/g)].map((match) => match[1] as string).sort();
  expect(props).toEqual(["cornerRadii", "shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"]);
  const loaded = await createHarness("android").load("foreign-shadow-fixture.svelte");
  const config = loaded.configs.viewConfigFor("FastShadowView", "android");
  for (const prop of props) expect(prop in config.attributes, prop).toBe(true);
  expect(typeof config.attributes.shadowColor).toBe("function");
});
