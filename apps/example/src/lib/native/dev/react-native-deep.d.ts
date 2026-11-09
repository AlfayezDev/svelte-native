// Deep React Native imports used by the lab (the package's own declarations are not visible to the app project).
declare module "react-native/Libraries/Utilities/Dimensions" {
  const Dimensions: { get(dimension: "window" | "screen"): { width: number; height: number; scale: number; fontScale: number } };
  export default Dimensions;
}
declare module "react-native/Libraries/Utilities/Platform" {
  const Platform: { OS: "android" | "ios"; Version: number | string; select<T>(spec: Record<string, T>): T | undefined; constants: { Manufacturer?: string; Model?: string } };
  export default Platform;
}
declare module "react-native/Libraries/Linking/Linking" {
  const Linking: {
    addEventListener(type: "url", handler: (event: { url: string }) => void): { remove(): void };
    getInitialURL(): Promise<string | null>;
  };
  export default Linking;
}
declare module "react-native/Libraries/AppState/AppState" {
  const AppState: { readonly currentState: string; addEventListener(type: "change", listener: (state: string) => void): { remove(): void } };
  export default AppState;
}
declare module "react-native/Libraries/Utilities/Appearance" {
  type ColorScheme = "light" | "dark" | null | undefined;
  export function getColorScheme(): ColorScheme;
  export function setColorScheme(scheme: "light" | "dark" | null): void;
  export function addChangeListener(listener: (preferences: { colorScheme: ColorScheme }) => void): { remove(): void };
}
declare module "react-native/Libraries/Utilities/BackHandler" {
  const BackHandler: { addEventListener(event: "hardwareBackPress", handler: () => boolean | null | undefined): { remove(): void } };
  export default BackHandler;
}
declare module "react-native/Libraries/Image/resolveAssetSource" {
  const resolveAssetSource: (source: unknown) => { uri: string; width?: number; height?: number; scale: number } | null | undefined;
  export default resolveAssetSource;
}
declare module "react-native/Libraries/TurboModule/TurboModuleRegistry" {
  export function get<T>(name: string): T | null;
  export function getEnforcing<T>(name: string): T;
}
