// The iOS wire is the shared one: the Fabric components of native/svelte-screens-ios read the same
// `nativeID` strings and records as the engine (SPEC.md, "Screen API contract"), so the encoders and the reference decoder
// are re-exported unchanged. What only iOS has is below: the Fabric component each tag mounts as, and their view configs.
export * from "./navigation.ts";

/** The Fabric component (registered by the module's `+load`) that each navigation tag mounts as on iOS; the other tags stay `RCTView`. */
const components = {
  "native-stack": "SvelteStack",
  "native-screen": "SvelteScreen",
  "native-header": "SvelteHeader",
  "native-header-left": "SvelteHeaderSlot",
  "native-header-center": "SvelteHeaderSlot",
  "native-header-right": "SvelteHeaderSlot",
  "native-header-search": "SvelteHeaderSlot",
  "native-tabs": "SvelteTabs",
  "native-tab": "SvelteTab",
  "native-toolbar": "SvelteToolbar",
  "native-toolbar-item": "SvelteToolbarItem",
  "native-toolbar-center": "SvelteToolbarCenter",
} as const satisfies Record<string, string>;

export type IosNavigationTag = keyof typeof components;

/** Events the components emit that React Native's base view config does not know (`topChange` and `topSubmitEditing` it does). */
const directEvents: Readonly<Record<string, readonly string[]>> = {
  SvelteScreen: ["topAppear", "topDisappear", "topDismissed", "topExited", "topDetentChange"],
  SvelteHeader: ["topMetrics"],
  SvelteHeaderSlot: ["topCancel"],
  SvelteTabs: ["topSelect", "topMetrics"],
  SvelteToolbar: ["topPress", "topMetrics"],
};

type ViewConfigRegistry = { register(name: string, config: () => unknown): string };
type ViewConfigFactory = { createViewConfig(partial: { uiViewClassName: string; directEventTypes: Record<string, { registrationName: string }>; validAttributes: Record<string, unknown> }): unknown };

let registered = false;
/**
 * Registers the view configs of the components with React Native's registry, as `codegenNativeComponent` does for a
 * component that has a spec: the base view attributes (style, `nativeID`, accessibility) plus the events above. The module
 * has no codegen spec because Expo autolinks local modules without running React Native's codegen; the components
 * are `ViewProps`-derived and read everything else from `nativeID`. The registry code loads here, on the first use.
 */
function registerViewConfigs(): void {
  registered = true;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const registry = require("react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry") as ViewConfigRegistry;
  const { createViewConfig } = require("react-native/Libraries/NativeComponent/ViewConfig") as ViewConfigFactory;
  /* eslint-enable @typescript-eslint/no-require-imports */
  for (const name of new Set<string>(Object.values(components))) {
    const events = Object.fromEntries((directEvents[name] ?? []).map((type) => [type, { registrationName: `on${type.slice(3)}` }]));
    registry.register(name, () => createViewConfig({ uiViewClassName: name, directEventTypes: events, validAttributes: {} }));
  }
}

/** The Fabric component name of a navigation tag on iOS. The view configs of all of them are registered with the first call. */
export function iosNavigationViewName(tag: IosNavigationTag): string {
  if (!registered) registerViewConfigs();
  return components[tag];
}
