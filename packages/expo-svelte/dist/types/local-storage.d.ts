/// <reference path="./vendor-types.d.ts" />
/**
 * What `localStorage` is on the device: an MMKV instance (react-native-mmkv 4, a Nitro module, vendored: `vendor/react-native-mmkv`) with the id `svelte-native.local-storage`, which keeps its
 * data in the app's files for good. The library is required, and the instance created, when the global `localStorage` is first read (`loadLocalStorage`), so an app that never
 * touches `localStorage` neither loads MMKV nor creates a file for it. It is created then, and not at the first call that reads or writes an item, so that a binary
 * without the native module is found out by the read, which answers `undefined` (`defineLazyGlobal`): `typeof localStorage` is a feature probe that works.
 */
import type { MMKV } from "#vendor/react-native-mmkv";
import { type StorageBackend } from "./web-storage.js";
/** The id of the MMKV instance behind `localStorage`: the name of its files. It keeps the package's name before 0.4.0-rc.10, so an app's stored values survive the rename. */
export declare const LOCAL_STORAGE_ID = "svelte-native.local-storage";
/**
 * The MMKV instance behind `localStorage`, created on the first call. What `localStorage` stores is in it, key for key, so a screen that wants more than strings (numbers, booleans,
 * bytes, change listeners) can use it beside `localStorage` for the same data. `localStorage` reads and writes strings: a value stored here as another type reads as `null` there,
 * and the empty key and a key that begins with a NUL character are stored under another name (`encodeKey`).
 */
export declare function localStorageMMKV(): MMKV;
/**
 * MMKV refuses an empty key and a browser's storage does not, so the empty key is stored as a NUL character, and a key that begins with a NUL character gets one more in front of it
 * (a key of the app's own cannot be taken for the empty one). `decodeKey` is the inverse.
 */
export declare const encodeKey: (key: string) => string;
export declare const decodeKey: (key: string) => string;
/** The `localStorage` global's value: the instance is made here, so that a binary without react-native-mmkv's native module throws now (the read answers `undefined` and tries again on the next one). */
export declare function loadLocalStorage(): Storage;
/** The backend of `localStorage`: `localStorageMMKV()`, which is made on its first use and is the same one after. */
export declare function mmkvBackend(): StorageBackend;
