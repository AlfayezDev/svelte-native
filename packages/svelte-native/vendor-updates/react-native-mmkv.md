# react-native-mmkv

- **Current**: 4.3.1
- **Linked**: every app
- **Upstream**: https://github.com/mrousavy/react-native-mmkv
- **Copy**: `vendor/react-native-mmkv/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

`localStorage` and `sessionStorage` (`src/local-storage.ts`), and `@alfayez/svelte-native/mmkv` (`createMMKV`, `localStorageMMKV()`, the types).

## Coupled with

react-native-nitro-modules (see its file).

## Version policy

The newest 4.x that supports the runtime version of the group; a major version is a project of its own (its API is re-exported by `/mmkv`).

## Local changes

None.

## What the library relies on

- `src/local-storage.ts`: the MMKV instance behind `localStorage` (its id and path) and the calls it makes.
- `src/mmkv.ts`: what `/mmkv` re-exports; a renamed export breaks apps.
- `src/autolinking.ts`: `DeferredNitroPackage("NitroMmkv")` names the package's native library.

## What to look at in its source

- The storage format: an app updated to the new library must read what the current one wrote. A change to MMKV core's file format or to how the instance is created (id, path, encryption) is a red flag for the report.
- MMKV core's version (below): a native dependency with its own source and releases (Tencent/MMKV).

## Native dependencies downloaded at build time

The pod `MMKVCore` 2.4.0 and the Maven artifact `io.github.zhongwuzw:mmkv:2.4.0` (MMKV core, built from Tencent/MMKV): check the version the podspec and `android/build.gradle` ask for, and that release's notes.

## Proof

- `localStorage` round trip on both platforms (the Web APIs screen's checks).
- Data written by the current version survives: install the current example build, write keys, install the new build over it (`adb install -r`, or `simctl install` without uninstalling), read them back.
