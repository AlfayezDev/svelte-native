import { expect, test } from "bun:test";
import { viewConfigs } from "./support/configs.ts";
import { expoViewConfigs, flowSpec, libraryFile, pdfSpec, specOf } from "./support/specs.ts";

/**
 * What the native-view libraries declare in their own sources (SPEC.md, "Foreign views"), compared with the static view configs the host keeps for them
 * (`src/fabric/view-configs.ts`). These are pins of third-party code: they read the installed libraries' codegen specs, Kotlin, Java and Objective-C and fail when a library's
 * upgrade changes a prop or an event, whatever this package did. Each table of the host is checked against the library's own text, by the reader that fits the library's language.
 */
const android = await viewConfigs("android");
const ios = await viewConfigs("ios");

/** The attributes a view's config adds to a plain view's. */
const own = (configs: typeof android, name: string, platform: "android" | "ios"): string[] => {
  const base = configs.viewConfigFor("RCTView", platform).attributes;
  return Object.keys(configs.viewConfigFor(name, platform).attributes).filter((key) => !(key in base)).sort();
};

// The attribute tables are what each library's codegen spec declares: every prop of the spec that is not an event handler
// is an attribute, every handler is an event of the same name, and nothing else is in the table.
const kinds: [string, string, string][] = [
  ["RNCWebView", "react-native-webview/src/RNCWebViewNativeComponent.ts", "NativeProps"],
  ["RNMapsMapView", "react-native-maps/src/specs/NativeComponentMapView.ts", "MapFabricNativeProps"],
  ["RNMapsMarker", "react-native-maps/src/specs/NativeComponentMarker.ts", "MarkerFabricNativeProps"],
  ["RCTVideo", "react-native-video/src/specs/VideoNativeComponent.ts", "VideoNativeProps"],
  ["LottieAnimationView", "lottie-react-native/src/specs/LottieAnimationViewNativeComponent.ts", "NativeProps"],
];
for (const [name, file, interfaceName] of kinds) {
  test(`the static config of ${name} lists exactly the props and events its spec declares`, () => {
    const spec = specOf(file, interfaceName);
    expect(spec.viewProps).toBe(true);
    const config = android.viewConfigFor(name, "android");
    expect(config.foreign).toBe(false);
    const base = Object.keys(android.viewConfigFor("RCTView", "android").attributes);
    // What the config adds to a view's attributes is the spec's non-handler props (a handler prop is sent only by the view's own list when it is in the generated config, which Android's is not).
    expect(own(android, name, "android")).toEqual(spec.props.filter((key) => !base.includes(key)).sort());
    const events = [...config.events.values()].filter((registration) => spec.handlers.includes(registration)).sort();
    const declared = spec.handlers.filter((handlerName) => [...config.events.values()].includes(handlerName)).sort();
    expect(events).toEqual(declared);
    // Every event the config knows (beyond the view's own) is a handler of the spec.
    const viewEvents = new Set(android.viewConfigFor("RCTView", "android").events.values());
    for (const registration of config.events.values()) if (!viewEvents.has(registration)) expect(spec.handlers, `${name} ${registration}`).toContain(registration);
    // And every handler of the spec is an event of the config.
    const known = new Set(config.events.values());
    expect(spec.handlers.filter((handlerName) => !known.has(handlerName)), `${name} handlers without an event`).toEqual([]);
  });
}

test("the static config of RNDateTimePicker lists the props, colours and events of the library's Flow spec", () => {
  const spec = flowSpec("@react-native-community/datetimepicker/src/specs/DateTimePickerNativeComponent.js");
  expect(spec.props.length).toBeGreaterThan(8);
  const config = ios.viewConfigFor("RNDateTimePicker", "ios");
  const base = ios.viewConfigFor("RCTView", "ios");
  expect(own(ios, "RNDateTimePicker", "ios")).toEqual([...spec.props].sort());
  expect(Object.keys(config.attributes).filter((key) => typeof config.attributes[key] === "function" && typeof base.attributes[key] !== "function").sort()).toEqual([...spec.colors].sort());
  const events = [...config.events.values()];
  for (const handler of spec.handlers) expect(events, handler).toContain(handler);
  // Android has no view: the config is the same table, and the component does not mount the name there (`foreign/datetime.test.ts`).
});

test("every prop and event the Android RCTVideo manager reads or emits is in the static config", () => {
  const directory = "react-native-video/android/src/main/java/com/brentvatne";
  const manager = libraryFile(`${directory}/exoplayer/ReactExoplayerViewManager.kt`);
  const emitter = libraryFile(`${directory}/common/react/VideoEventEmitter.kt`);
  const props = [...manager.matchAll(/@ReactProp\(name = (\w+)/g)].map((match) => new RegExp(`const val ${match[1]} =\\s*"(\\w+)"`).exec(manager)?.[1] ?? "");
  expect(props.length).toBeGreaterThan(20);
  const events = [...emitter.matchAll(/EVENT_\w+\("(on\w+)"\)/g)].map((match) => `top${(match[1] ?? "").slice(2)}`);
  expect(events.length).toBeGreaterThan(20);
  const config = android.viewConfigFor("RCTVideo", "android");
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
  [...libraryFile(file).matchAll(/RCT_EXPORT_VIEW_PROPERTY\(\s*(on\w+)\s*,\s*RCT(?:Direct|Bubbling)EventBlock\s*\)/g)].map((match) => match[1] as string).filter((event) => !undeclaredEvents.has(event));

for (const [name, file] of legacyManagers) {
  test(`the iOS config of ${name} sends every event its view manager exports as a handler prop, and Android's sends none`, () => {
    const events = exportedEvents(file);
    expect(events.length).toBeGreaterThan(5);
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

test("the static config of RNPDFPdfView lists the props of the library's Flow spec, the one bubbling event and the Android manager's props", () => {
  const spec = pdfSpec("react-native-pdf/fabric/RNPDFPdfNativeComponent.js");
  expect(spec.props.length).toBeGreaterThan(15);
  expect(spec.handlers).toEqual(["onChange"]);
  for (const platform of ["android", "ios"] as const) {
    const base = android.viewConfigFor("RCTView", platform);
    expect(own(android, "RNPDFPdfView", platform), platform).toEqual(spec.props.filter((key) => !(key in base.attributes)).sort());
    expect(android.viewConfigFor("RNPDFPdfView", platform).events.get("topChange")).toBe("onChange");
  }
  // The Android manager sets exactly these (its `@ReactProp`s and the delegate's two no-ops).
  const manager = libraryFile("react-native-pdf/android/src/main/java/org/wonday/pdf/PdfManager.java");
  const set = [...manager.matchAll(/@ReactProp\(name = "(\w+)"\)/g)].map((match) => match[1] as string);
  for (const prop of set) expect(spec.props, prop).toContain(prop);
  expect(/REACT_CLASS = "(\w+)"/.exec(manager)?.[1]).toBe("RNPDFPdfView");
});

test("the static config of FastShadowView lists the props the Android manager reads, the colour converted", () => {
  const manager = libraryFile("react-native-fast-shadow/android/src/main/java/com/reactnativefastshadow/FastShadowViewManager.java");
  const props = [...manager.matchAll(/@ReactProp\(name = "(\w+)"/g)].map((match) => match[1] as string).sort();
  expect(props).toEqual(["cornerRadii", "shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"]);
  const config = android.viewConfigFor("FastShadowView", "android");
  for (const prop of props) expect(prop in config.attributes, prop).toBe(true);
  expect(typeof config.attributes.shadowColor).toBe("function");
});

test("the static config of RiveReactNativeView lists the props the Android manager sets and the events it sends, and the iOS manager's exported properties", () => {
  const rive = "rive-react-native";
  const manager = libraryFile(`${rive}/android/src/main/java/com/rivereactnative/RiveReactNativeViewManager.kt`);
  const view = libraryFile(`${rive}/android/src/main/java/com/rivereactnative/RiveReactNativeView.kt`);
  const manager_ios = libraryFile(`${rive}/ios/RiveReactNativeViewManager.m`);
  const props = [...manager.matchAll(/@ReactProp\(name = "(\w+)"\)/g)].map((match) => match[1] as string).sort();
  const iosProps = [...manager_ios.matchAll(/RCT_EXPORT_VIEW_PROPERTY\((\w+), (?!RCTDirectEventBlock)/g)].map((match) => match[1] as string).sort();
  const events = [...(/enum class Events[\s\S]*?;\n/.exec(view)?.[0] ?? "").matchAll(/"(on\w+)"/g)].map((match) => `top${(match[1] as string).slice(2)}`).sort();
  const iosEvents = [...manager_ios.matchAll(/RCT_EXPORT_VIEW_PROPERTY\(on(\w+), RCTDirectEventBlock\)/g)].map((match) => `top${match[1]}`).sort();
  expect(props.length).toBeGreaterThan(10);
  expect(iosProps).toEqual(props);
  expect(iosEvents).toEqual(events);
  expect(events.length).toBe(7);
  for (const platform of ["android", "ios"] as const) {
    const config = android.viewConfigFor("RiveReactNativeView", platform);
    // The view manager's events are props on iOS only (the interop layer builds a native event block for each handler prop it is sent).
    const handlers = platform === "ios" ? events.map((type) => `on${type.slice(3)}`) : [];
    expect(own(android, "RiveReactNativeView", platform), platform).toEqual([...props, ...handlers].sort());
    const viewEvents = new Set(android.viewConfigFor("RCTView", platform).events.keys());
    expect([...config.events.keys()].filter((type) => !viewEvents.has(type)).sort(), platform).toEqual(events);
  }
});

test("the static config of JBAnimatedText is the library's own view config, with the events it declares", () => {
  const source = libraryFile("react-native-animateable-text/src/AnimateableText.tsx");
  const attributes = [...(/validAttributes: \{([\s\S]*?)\},/.exec(source)?.[1] ?? "").matchAll(/(\w+): true/g)].map((match) => match[1] as string).sort();
  const events = [...source.matchAll(/(top\w+): \{ registrationName: "(\w+)" \}/g)].map((match) => [match[1], match[2]]);
  expect(attributes.length).toBeGreaterThan(15);
  expect(attributes).toContain("text");
  expect(events).toEqual([["topTextLayout", "onTextLayout"], ["topInlineViewLayout", "onInlineViewLayout"]]);
  expect(/uiViewClassName: "(\w+)"/.exec(source)?.[1]).toBe("JBAnimatedText");
  for (const platform of ["android", "ios"] as const) {
    const config = android.viewConfigFor("JBAnimatedText", platform);
    const base = android.viewConfigFor("RCTView", platform);
    expect(own(android, "JBAnimatedText", platform), platform).toEqual(attributes.filter((key) => !(key in base.attributes)));
    for (const [type, registration] of events) expect(config.events.get(type as string), `${platform} ${type}`).toBe(registration);
  }
  // The library converts `selectionColor` itself; the host's config does it for the component.
  expect(typeof android.viewConfigFor("JBAnimatedText", "android").attributes.selectionColor).toBe("function");
});

// The Expo modules' views, whose props and events the host's components send: read from each module's Kotlin (`View(X::class) { Name("..."); Events(...); Prop("...") }`).
const expoViews: {
  library: string; file: string; view: string; props: string[];
  /** The views of the module, when the test says which they are. */
  views?: string[];
  /** Only these props are listed (else the prop list is a subset of the view's). */
  exact: boolean;
  /** The registration names of the view's events, or null for none; unset when the test does not look. */
  events?: string[] | null;
}[] = [
  { library: "expo-blur", views: ["ExpoBlurTargetView", "ExpoBlurView"], file: "expo-blur/android/src/main/java/expo/modules/blur/BlurModule.kt", view: "ExpoBlurView", props: ["blurMethod", "blurReductionFactor", "blurTargetId", "intensity", "tint"], exact: true },
  { library: "expo-conic-gradient", file: "expo-conic-gradient/android/src/main/java/expo/modules/conicgradient/ConicGradientModule.kt", view: "", props: ["angle", "center", "colors", "locations"], exact: true, events: null },
  { library: "expo-linear-gradient", file: "expo-linear-gradient/android/src/main/java/expo/modules/lineargradient/LinearGradientModule.kt", view: "", props: ["borderRadii", "colors", "dither", "endPoint", "locations", "startPoint"], exact: true, events: null },
  {
    library: "expo-image", file: "expo-image/android/src/main/java/expo/modules/image/ExpoImageModule.kt", view: "",
    props: ["source", "placeholder", "contentFit", "contentPosition", "transition", "tintColor", "cachePolicy", "priority", "recyclingKey", "blurRadius", "autoplay", "allowDownscaling", "decodeFormat"], exact: false,
    events: ["onLoadStart", "onProgress", "onError", "onLoad", "onDisplay"],
  },
  { library: "the library's own SvelteBlur", views: ["SvelteBlurView"], file: "../packages/expo-svelte/native/svelte-core/android/src/main/java/expo/modules/svelteblur/SvelteBlurModule.kt", view: "SvelteBlurView", props: ["intensity", "tint"], exact: true, events: null },
];
for (const { library, file, views, view, props, exact, events } of expoViews) {
  test(`${library}: the module declares the views and the props the component sends`, () => {
    const configs = expoViewConfigs(file);
    if (views) expect(Object.keys(configs).sort()).toEqual(views);
    const declared = Object.keys(configs[view].validAttributes);
    if (exact) expect(declared.sort()).toEqual(props);
    else expect(declared).toEqual(expect.arrayContaining(props));
    if (events !== undefined) expect(events === null ? configs[view].directEventTypes ?? null : Object.values(configs[view].directEventTypes ?? {}).map((event) => event.registrationName)).toEqual(events);
  });
}

test("the tint type lists every name expo-blur takes, so a screen can move from one to the other", () => {
  const tints = libraryFile("expo-blur/android/src/main/java/expo/modules/blur/enums/TintStyle.kt");
  const names = [...tints.matchAll(/\w+\("(\w+)"\)/g)].map((match) => match[1] as string).sort();
  const declared = libraryFile("../packages/expo-svelte/src/fabric/foreign-blur.ts");
  const ours = [...declared.matchAll(/\| "(\w+)"/g)].map((match) => match[1] as string).sort();
  expect(names.length).toBeGreaterThan(15);
  expect(ours).toEqual(names);
});

// The view managers React Native creates on demand are listed by name in `app.config.ts`; a name that drifts from the
// package's own would leave a component without a manager, so the names are read back from the packages' sources.
test("the on-demand view manager names are the ones the packages register", async () => {
  const source = (path: string): string => libraryFile(path);
  const { default: config } = await import("../../../../apps/qa/app.config.ts");
  const entry = config.plugins.find((plugin): plugin is [string, { androidOnDemandViewManagers: Record<string, string[]> }] => Array.isArray(plugin) && plugin[0] === "expo-svelte");
  const listed = entry?.[1].androidOnDemandViewManagers ?? {};
  expect(Object.keys(listed).sort()).toEqual([
    "com.airbnb.android.react.lottie.LottiePackage", "com.brentvatne.react.ReactVideoPackage", "com.horcrux.svg.SvgPackage", "com.reactnativecommunity.webview.RNCWebViewPackage", "com.reactnativefastshadow.FastShadowPackage",
    "com.reactnativereanimatedtext.ReanimatedTextPackage", "com.rivereactnative.RiveReactNativePackage", "com.rnmaps.maps.MapsPackage", "com.swmansion.gesturehandler.RNGestureHandlerPackage", "org.wonday.pdf.RNPDFPackage",
  ]);

  const maps = "react-native-maps/android/src/main/java/com/rnmaps";
  const mapsSource = source(`${maps}/maps/MapsPackage.java`);
  const created = [...new Set([...mapsSource.matchAll(/new (\w+Manager)\(/g)].map((match) => match[1]))];
  const fabricNames = created.flatMap((manager) => {
    try {
      return [...source(`${maps}/fabric/${manager}.java`).matchAll(/String REACT_CLASS = "(\w+)"/g)].map((match) => match[1]);
    } catch {
      return [];
    }
  });
  // Fabric components only: the old architecture managers (`maps/*Manager.java`) have no component descriptor.
  expect([...listed["com.rnmaps.maps.MapsPackage"]].sort()).toEqual([...fabricNames].sort());
  expect(fabricNames).toContain("RNMapsMapView");

  const webview = source("react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt");
  expect(listed["com.reactnativecommunity.webview.RNCWebViewPackage"]).toEqual([/const val NAME = "(\w+)"/.exec(webview)?.[1]]);

  // react-native-video and lottie-react-native: one view manager each, and the package kind decides which wrapper React Native gets.
  const video = "react-native-video/android/src/main/java/com/brentvatne";
  expect(listed["com.brentvatne.react.ReactVideoPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(source(`${video}/exoplayer/ReactExoplayerViewManager.kt`))?.[1]]);
  // Plain packages (`ReactPackage`), whose modules come from `createNativeModules`: the video package's `VideoManager` is one of them.
  const videoPackage = source(`${video}/react/ReactVideoPackage.kt`);
  expect(videoPackage).toMatch(/class ReactVideoPackage\([^)]*\) : ReactPackage\b/);
  expect(videoPackage).toContain("VideoManagerModule(reactContext)");
  const lottie = "lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie";
  expect(listed["com.airbnb.android.react.lottie.LottiePackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(source(`${lottie}/LottieAnimationViewManagerImpl.kt`))?.[1]]);
  expect(source(`${lottie}/LottiePackage.kt`)).toMatch(/class LottiePackage : ReactPackage\b/);
  expect(source("react-native-pdf/android/src/main/java/org/wonday/pdf/RNPDFPackage.java")).toMatch(/class RNPDFPackage implements ReactPackage\b/);

  // The four packages after them: plain `ReactPackage`s too (Rive's native modules come from `createNativeModules`), one view manager each.
  const pdf = source("react-native-pdf/android/src/main/java/org/wonday/pdf/PdfManager.java");
  expect(listed["org.wonday.pdf.RNPDFPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(pdf)?.[1]]);
  const rive = "rive-react-native/android/src/main/java/com/rivereactnative";
  expect(listed["com.rivereactnative.RiveReactNativePackage"]).toEqual([/override fun getName\(\) = "(\w+)"/.exec(source(`${rive}/RiveReactNativeViewManager.kt`))?.[1]]);
  const rivePackage = source(`${rive}/RiveReactNativePackage.kt`);
  expect(rivePackage).toMatch(/class RiveReactNativePackage : ReactPackage\b/);
  expect(rivePackage).toContain("RiveReactNativeRendererModule(reactContext), RiveReactNativeModule(reactContext)");
  const shadow = "react-native-fast-shadow/android/src/main/java/com/reactnativefastshadow";
  expect(listed["com.reactnativefastshadow.FastShadowPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(source(`${shadow}/FastShadowViewManager.java`))?.[1]]);
  expect(source(`${shadow}/FastShadowPackage.java`)).toMatch(/class FastShadowPackage implements ReactPackage\b/);
  const text = "react-native-animateable-text/android/src/main/java/com/reactnativereanimatedtext";
  expect(listed["com.reactnativereanimatedtext.ReanimatedTextPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(source(`${text}/JBAnimatedTextViewManager.java`))?.[1]]);
  expect(source(`${text}/ReanimatedTextPackage.kt`)).toMatch(/class ReanimatedTextPackage : ReactPackage\b/);
  // react-native-svg: a `BaseReactPackage` (the wrapper serves its two TurboModules as before) with one view manager per Fabric component; the names are the
  // `REACT_CLASS` of each manager in `RenderableViewManager` and `SvgViewManager`.
  const svg = "react-native-svg/android/src/main/java/com/horcrux/svg";
  const svgManagers = [...source(`${svg}/RenderableViewManager.java`).matchAll(/REACT_CLASS = "(\w+)"/g), ...source(`${svg}/SvgViewManager.java`).matchAll(/REACT_CLASS = "(\w+)"/g)].map((match) => match[1]);
  expect(svgManagers.length).toBe(29);
  expect([...listed["com.horcrux.svg.SvgPackage"]].sort()).toEqual([...svgManagers].sort());
  expect(source(`${svg}/SvgPackage.java`)).toMatch(/class SvgPackage extends BaseReactPackage implements ViewManagerOnDemandReactPackage/);
  // The gesture handler's package creates both of its managers as a set (`createViewManagers`); the names are the ones its sources declare.
  const handler = "react-native-gesture-handler/android/src/main/java/com/swmansion/gesturehandler";
  const handlerManagers = ["RNGestureHandlerRootViewManager", "RNGestureHandlerButtonViewManager"].map((manager) => /const val REACT_CLASS = "(\w+)"/.exec(source(`${handler}/react/${manager}.kt`))?.[1]);
  expect(handlerManagers.every((name) => name !== undefined)).toBe(true);
  expect([...listed["com.swmansion.gesturehandler.RNGestureHandlerPackage"]].sort()).toEqual([...handlerManagers].sort());
  expect(source(`${handler}/RNGestureHandlerPackage.kt`)).toContain("RNGestureHandlerRootViewManager(), RNGestureHandlerButtonViewManager()");
  // react-native-view-shot and react-native-blob-util have no view, so nothing of theirs is deferred.
  for (const key of Object.keys(listed)) expect(key).not.toMatch(/viewshot|ReactNativeBlobUtil/);
});
