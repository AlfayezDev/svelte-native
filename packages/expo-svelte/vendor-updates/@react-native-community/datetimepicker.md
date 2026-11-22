# @react-native-community/datetimepicker

- **Current**: 9.2.1
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/react-native-datetimepicker/datetimepicker
- **Copy**: `vendor/@react-native-community/datetimepicker/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `DateTimePicker` and `openDatePicker`; its config plugin runs from the copy.

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

None. The copy leaves out `jest` and `windows`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-datetime.ts`, `src/components/DateTimePicker.svelte`; the Android dialog module's function names.

## What to look at in its source

- The Android dialog API (`open`/`dismiss`) the library calls by name.
- 9.2's config plugin requires `expo/config-plugins` (not `@expo/config-plugins`) and has the style `numbersInnerTextColor`; `DateTimePickerAndroid.dismiss(mode, design)` takes the design.

## Native dependencies downloaded at build time

`com.google.android.material:material:1.12.0`.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/date-time-picker`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
