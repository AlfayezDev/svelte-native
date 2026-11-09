// Asset imports: Metro turns an imported image into a number the Image component understands.
declare module "*.png" {
  const asset: number;
  export default asset;
}

// The library has no Platform, Appearance or Dimensions of its own: those are React Native's JavaScript-only modules, imported by their
// path (the `react-native` index would load React's components too). React Native ships no types for these paths, so they are typed here.
declare module "react-native/Libraries/Utilities/Platform" {
  const Platform: {
    OS: "android" | "ios";
    Version: number | string;
    select<Value>(spec: { android?: Value; ios?: Value; default?: Value }): Value | undefined;
  };
  export default Platform;
}
declare module "react-native/Libraries/Utilities/Appearance" {
  type ColorScheme = "light" | "dark" | null | undefined;
  export function getColorScheme(): ColorScheme;
  export function addChangeListener(listener: (preferences: { colorScheme: ColorScheme }) => void): { remove(): void };
}
declare module "react-native/Libraries/Utilities/Dimensions" {
  type Size = { width: number; height: number; scale: number; fontScale: number };
  const Dimensions: { get(dimension: "window" | "screen"): Size };
  export default Dimensions;
}
declare module "react-native/Libraries/Linking/Linking" {
  const Linking: {
    getInitialURL(): Promise<string | null>;
    addEventListener(type: "url", handler: (event: { url: string }) => void): { remove(): void };
  };
  export default Linking;
}

// Two more that the library's own source imports. A workspace link is type-checked with the app (a copy in node_modules is not), and the
// library's declarations for them are not visible to the app's project, so the app declares them as well.
declare module "react-native/Libraries/Utilities/BackHandler" {
  const BackHandler: { addEventListener(event: "hardwareBackPress", handler: () => boolean | null | undefined): { remove(): void } };
  export default BackHandler;
}
declare module "react-native/Libraries/Image/resolveAssetSource" {
  const resolveAssetSource: (source: unknown) => { uri: string; width?: number; height?: number; scale: number } | null | undefined;
  export default resolveAssetSource;
}
