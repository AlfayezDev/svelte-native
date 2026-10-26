import { register } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";

/** React Native's `createReactNativeComponentClass` without `ReactNativePrivateInterface` (public instances, DOM nodes, the renderer). */
export default function createReactNativeComponentClass(name: string, callback: () => object): string {
  return register(name, callback);
}
