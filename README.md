# Svelte Native

Svelte 5 components that run as native Android and iOS apps on React Native's Fabric, with no React reconciler and no WebView. The library compiles Svelte with a pinned custom-renderer build, runs it in Hermes and drives Fabric's shadow tree and Yoga directly. The build and release pipeline stays Expo.

## Layout

| Path | What it is |
| ---- | ---------- |
| `packages/svelte-native` | The library, `@rasheed/svelte-native`: renderer, router, Metro and Vite integration, Expo config plugin, gestures, view-library wrappers, updates client, remote functions, and its six native modules in `native/` (the Android engine, the iOS screens, insets, navigation and capture modules, the updates module), linked by the package's one `expo-module.config.json`. Apps install it as a git dependency of this repository ([its README](packages/svelte-native/README.md), "Install in an app"). Its tests are in `tests/`. Start with [its README](packages/svelte-native/README.md). |
| `apps/qa` | The QA app (the development lab) and the QA harness (`node qa/native-qa.ts`). It depends on the library through the workspace (`@rasheed/svelte-native`), as an app outside the repository would, and links its native modules from `node_modules/@rasheed/svelte-native`. It has the development lab (`src/lib/native/dev`, `src/routes/__dev`), the three QA-only local Expo modules in `modules/` (the touch injector, the iOS QA module, the view bench), and the QA harness in `qa/` (`node qa/native-qa.ts`, see [qa/README.md](apps/qa/qa/README.md)). |
| `patches/` | pnpm patches of the third-party libraries the QA app links (listed in `pnpm-workspace.yaml`). The SvelteKit patch is in `packages/svelte-native/patches/`. |
| `vendor/` | The Svelte build the library needs (an unmerged custom-renderer pull request, commit `216f258`, 5.56.7), vendored so installs do not depend on a preview registry. The package names `svelte` as a peer dependency; this repository's example and package install the tarball by `file:`. |

## Install and check

Node 25, pnpm 12.3.4 (the `packageManager` field) and Bun 1.3 (the tests run on Bun).

```sh
pnpm install --frozen-lockfile
pnpm lint         # biome, then eslint in the package and the apps
pnpm typecheck    # svelte-check in the package and the apps, tsc for the harness
pnpm test         # the package's tests, then the harness's
```

The Kotlin and C++ host checks (`packages/svelte-native/tests`, `packages/svelte-native/native/svelte-engine/android/src/test/run.sh`) need a JDK, `kotlinc` and `g++`, and skip themselves without them (they fail under `CI=1`). Building the apps and running the device suites additionally need the Android SDK or Xcode and a device; see the QA README.
