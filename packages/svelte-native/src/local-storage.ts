/**
 * What `localStorage` is on the device: an MMKV instance (react-native-mmkv 4, a Nitro module) with the id `svelte-native.local-storage`, which keeps its
 * data in the app's files for good. The library is required, and the instance created, on the first call that reads or writes it, so an app that never
 * touches `localStorage` neither loads MMKV nor creates a file for it.
 */
import type { MMKV } from "react-native-mmkv";
import { mark } from "./boot-marks.ts";
import type { StorageBackend } from "./web-storage.ts";

/** The id of the MMKV instance behind `localStorage`: the name of its files. */
export const LOCAL_STORAGE_ID = "svelte-native.local-storage";

let instance: MMKV | undefined;

/**
 * The MMKV instance behind `localStorage`, created on the first call. What `localStorage` stores is in it, key for key, so a screen that wants more than strings (numbers, booleans,
 * bytes, change listeners) can use it beside `localStorage` for the same data. `localStorage` reads and writes strings: a value stored here as another type reads as `null` there,
 * and the empty key and a key that begins with a NUL character are stored under another name (`encodeKey`).
 */
export function localStorageMMKV(): MMKV {
  if (instance === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first call
    const { createMMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
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

/** The backend of `localStorage`: `localStorageMMKV()`, reached on each call so nothing is created before the first one. */
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
