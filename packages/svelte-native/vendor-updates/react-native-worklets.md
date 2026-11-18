# react-native-worklets

- **Current**: 0.10.1
- **Linked**: every app
- **Upstream**: https://github.com/software-mansion/react-native-reanimated
- **Copy**: `vendor/react-native-worklets/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The worklet runtime (the UI thread's JavaScript) and the Babel plugin that turns `"worklet"` functions into worklets.

## Coupled with

react-native-reanimated (see its file). Published from the Reanimated repository.

## Version policy

Only with Reanimated, to a version Reanimated's compatibility table names.

## Local changes

`0001-ui-frame-only-on-demand.patch`: the UI runtime asks for a frame only while a callback waits, with no idle per-frame loop. Doctor shape: `workletsProblems`.

## What the library relies on

- `src/transformer.ts`: `react-native-worklets/plugin` (and `react-native-reanimated/plugin`) resolve to the copy's plugin; Metro's cache key hashes the plugin file.
- The plugin's own `require`s (`@babel/*`, `convert-source-map`) are the library's `dependencies` (`tests/compiler/worklets-plugin.test.ts`).
- `src/fabric/reanimated-load.ts`, `src/fabric/transitions.ts`.

## What to look at in its source

- The plugin's output for a worklet (closures, hashes): the transformer tests compare it.
- The frame loop the patch changes.

## Native dependencies downloaded at build time

None of its own.

## Proof

- `tests/compiler/worklets-plugin.test.ts`, `tests/upstream/worklets-frame-loop.test.ts`.
- An idle screen asks for no frames (the patch), and animations run, on both platforms.
