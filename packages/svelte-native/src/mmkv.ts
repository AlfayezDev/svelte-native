/**
 * `@alfayez/svelte-native/mmkv`: react-native-mmkv's `createMMKV` and its types, for storage of the app's own (typed values, encryption, several instances), and
 * `localStorageMMKV()`, the instance `localStorage` keeps its data in. Importing this entry loads react-native-mmkv: `localStorage` itself needs none of it
 * until it is used.
 */
export { createMMKV } from "react-native-mmkv";
export type { Configuration, MMKV, Mode } from "react-native-mmkv";
export { localStorageMMKV } from "./local-storage.ts";
