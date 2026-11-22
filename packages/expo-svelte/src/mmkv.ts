/**
 * `expo-svelte/mmkv`: react-native-mmkv's `createMMKV` and its types, for storage of the app's own (typed values, encryption, several instances), and
 * `localStorageMMKV()`, the instance `localStorage` keeps its data in. Importing this entry loads react-native-mmkv: `localStorage` itself needs none of it
 * until it is used. react-native-mmkv is not an app's dependency: the library carries it (`vendor/react-native-mmkv`, VENDORING.md), and `#vendor/react-native-mmkv` is the copy.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s: it cannot be imported, only referenced
/// <reference path="./vendor-types.d.ts" />
export { createMMKV } from "#vendor/react-native-mmkv";
export type { Configuration, MMKV, Mode } from "#vendor/react-native-mmkv";
export { localStorageMMKV } from "./local-storage.ts";
