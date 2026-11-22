/**
 * What `localStorage` is on the device: an MMKV instance (react-native-mmkv 4, a Nitro module, vendored: `vendor/react-native-mmkv`) with the id `expo-svelte.local-storage`, which keeps its
 * data in the app's files for good. The library is required, and the instance created, when the global `localStorage` is first read (`loadLocalStorage`), so an app that never
 * touches `localStorage` neither loads MMKV nor creates a file for it. It is created then, and not at the first call that reads or writes an item, so that a binary
 * without the native module is found out by the read, which answers `undefined` (`defineLazyGlobal`): `typeof localStorage` is a feature probe that works.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s: it cannot be imported, only referenced
/// <reference path="./vendor-types.d.ts" />
import type { MMKV } from "#vendor/react-native-mmkv";
import { mark } from "./boot-marks.ts";
import { createStorage, type StorageBackend } from "./web-storage.ts";

/** The id of the MMKV instance behind `localStorage`: the name of its files. */
export const LOCAL_STORAGE_ID = "expo-svelte.local-storage";

let instance: MMKV | undefined;

/**
 * The MMKV instance behind `localStorage`, created on the first call. What `localStorage` stores is in it, key for key, so a screen that wants more than strings (numbers, booleans,
 * bytes, change listeners) can use it beside `localStorage` for the same data. `localStorage` reads and writes strings: a value stored here as another type reads as `null` there,
 * and the empty key and a key that begins with a NUL character are stored under another name (`encodeKey`).
 */
export function localStorageMMKV(): MMKV {
  if (instance === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first call
    const { createMMKV } = require("#vendor/react-native-mmkv") as typeof import("#vendor/react-native-mmkv");
    instance = createMMKV({ id: LOCAL_STORAGE_ID });
    mark("mmkv");
  }
  return instance;
}

/**
 * MMKV refuses an empty key and a browser's storage does not, so the empty key is stored as a NUL character, and a key that begins with a NUL character gets one more in front of it
 * (a key of the app's own cannot be taken for the empty one). `decodeKey` is the inverse.
 */
export const encodeKey = (key: string): string => (key === "" ? "\0" : key.startsWith("\0") ? `\0${key}` : key);
export const decodeKey = (key: string): string => (key === "\0" ? "" : key.startsWith("\0") ? key.slice(1) : key);

/** The `localStorage` global's value: the instance is made here, so that a binary without react-native-mmkv's native module throws now (the read answers `undefined` and tries again on the next one). */
export function loadLocalStorage(): Storage {
  localStorageMMKV();
  return createStorage(mmkvBackend());
}

/** The backend of `localStorage`: `localStorageMMKV()`, which is made on its first use and is the same one after. */
export function mmkvBackend(): StorageBackend {
  return {
    get length() { return localStorageMMKV().length; },
    get: (key) => localStorageMMKV().getString(encodeKey(key)),
    set: (key, value) => { localStorageMMKV().set(encodeKey(key), value); },
    remove: (key) => { localStorageMMKV().remove(encodeKey(key)); },
    clear: () => { localStorageMMKV().clearAll(); },
    keys: () => localStorageMMKV().getAllKeys().map(decodeKey),
  };
}
