/**
 * expo-video's `build/resolveAssetSource.js` as expo-video 57 had it: React Native's `resolveAssetSource`, from its own module. Version 58 takes it from the whole of `react-native`
 * (`Image.resolveAssetSource`, the same function), which bundled React Native's index into every app that turns expo-video on; Metro resolves that file here (`LEAN_IMPORTS`, `metro.ts`).
 */
import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";

export default resolveAssetSource;
