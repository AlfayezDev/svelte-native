/**
 * What `expo-svelte` stopped exporting in 0.4.0-rc.7: the entries 0.4.0-rc.6 deprecated, and every name each of them exported (as `src/deprecated/*.ts` listed
 * them), by the entry that exports it now. `package/exports.test.ts` checks the names in the sources and `package/exports-runtime.test.ts` in the loaded entries; neither can lose a name
 * without a line here changing.
 */

/** The paths removed from the `exports` map, in the order the changelog names them. */
export const removedEntries = ["./animation", "./gestures", "./svg", "./native-modules", "./expo", "./init", "./polyfills", "./fabric"] as const;

/** The same paths as an app wrote them. */
export const removedSpecifiers = removedEntries.map((entry) => `expo-svelte/${entry.slice(2)}`);

/** The entries that stay, which the removed ones' names moved to or were already part of. */
export const keptEntries = [".", "./platform", "./app", "./app.plugin", "./remote/runtime", "./remote/globals"] as const;

type Moved = { values: readonly string[]; types: readonly string[] };

/** `/animation`: the main entry has every name, under the same name. */
export const animation: Moved = {
  values: ["AnimatedView", "Easing", "ReduceMotion", "cancelAnimation", "createSharedValue", "runOnJS", "runOnUIAsync", "runOnUISync", "scheduleOnRN", "withDelay", "withRepeat", "withSequence", "withSpring", "withTiming"],
  types: ["SharedValue"],
};

/** `/gestures`: the main entry has every name, under the same name. */
export const gestures: Moved = {
  values: ["ActionType", "Directions", "Gesture", "GestureDetector", "GestureStateManager", "PointerType", "State", "TouchEventType", "gesture", "runOnJS", "scheduleOnRN"],
  types: [
    "ComposedGesture", "GestureAttribute", "GestureEventPayload", "GestureProps", "GestureRef", "GestureStateChangeEvent", "GestureStateManagerType", "GestureTouchEvent", "GestureType",
    "GestureUpdateEvent", "HandlerStateChangeEventPayload", "HitSlop", "FlingGestureHandlerEventPayload", "LongPressGestureHandlerEventPayload", "NativeViewGestureHandlerPayload",
    "PanGestureHandlerEventPayload", "PinchGestureHandlerEventPayload", "RotationGestureHandlerEventPayload", "TapGestureHandlerEventPayload", "TouchData",
  ],
};

/** `/svg` under the names the main entry keeps: react-native-svg's own. */
export const svg: Moved = {
  values: [
    "Svg", "G", "Path", "Rect", "Circle", "Ellipse", "Line", "Polygon", "Polyline", "TSpan", "TextPath", "Use", "Defs", "ClipPath", "RadialGradient", "Stop", "Pattern", "Mask", "Symbol",
    "ForeignObject", "Filter", "FeBlend", "FeColorMatrix", "FeComposite", "FeDropShadow", "FeFlood", "FeGaussianBlur", "FeMerge", "FeMergeNode", "FeOffset", "SvgXml", "SvgUri",
  ],
  types: ["SvgHandle", "SvgRootHandle", "SvgBoundingBoxOptions", "SvgMatrix", "SvgPoint", "SvgRect", "SvgRef", "SvgExtras"],
};

/** The four elements of `/svg` that the main entry names differently (its `Text` and `Image` are the views; `/foreign` has a `LinearGradient` and a `Marker`), and `/svg`'s default export. */
export const svgRenamed = { Text: "SvgText", Image: "SvgImage", LinearGradient: "SvgLinearGradient", Marker: "SvgMarker", default: "Svg" } as const;

/** `/native-modules`: `/platform` has both. */
export const nativeModules: Moved = { values: ["nativeModule", "turboModule"], types: [] };

/** `/fabric`: `/app` has all five (the generated entry imports two of them). */
export const fabric: Moved = { values: ["createFabricApp", "fabricStats", "flush", "remountSurfaces", "showError"], types: [] };
