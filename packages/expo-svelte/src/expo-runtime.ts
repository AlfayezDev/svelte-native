// Expo's WinterCG runtime: a standard `URL` and `URLSearchParams` (and `fetch`, `TextDecoder`, ...) as globals. React Native's own `URL` takes
// only a string and lacks most of the standard, and the router builds every location as a `SvelteURL` (`new URL(url)` of a `URL`), so an app
// that never loaded Expo's runtime itself started with `TypeError: undefined is not a function` and a blank screen (the showcase, 9 Nov 2026).
// `expo` is a required peer. Its `exports` map (Expo SDK 58) serves `expo/src/winter` from `build/winter` (`src/winter` under the `expo-source` condition); Metro picks
// `runtime.native` on a device.
//
// A `require` in a module of its own (imported first by `polyfills.ts`, so it runs where the import used to) and not an `import` of `expo/src/winter`: that is
// TypeScript source in `node_modules`, and a type check that follows the import (the library's own, or an app's whose compiler options are not Expo's) checks all of it
// and fails in it (`window` declared twice, ...). A `require` call is not followed.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
require("expo/src/winter");
