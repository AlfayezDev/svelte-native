# Agent guide

Svelte Native: the library and its native modules (`native/`) in `packages/svelte-native`, the QA app (the development lab), its QA-only Expo modules and the QA harness in `apps/qa`; the showcase app in `apps/example` (one readable route per feature). The layout and the install are in `README.md`; the library's own docs are `packages/svelte-native/README.md` and `REFERENCE.md`, the Android engine's spec is `packages/svelte-native/native/svelte-engine/SPEC.md`.

## Checks

- `pnpm install --frozen-lockfile`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` from the root.
- Package only: `cd packages/svelte-native && bun test --timeout 60000`, `pnpm lint`, `pnpm typecheck`.
- After changing Node-side code (what `scripts/build-node.ts` bundles: `cli.ts`, `build.ts`, `compile-options.ts`, `metro.ts`, `transformer.ts`, `expo.ts`, `vite.ts`, `lower.ts`, `doctor/`, `init-app.ts`, `remote/{transform,plugin,host}.ts`, `svelte-build.ts`, `package-root.ts`, `route-tree.ts`, `variant.ts`): `pnpm --dir packages/svelte-native build` and commit `packages/svelte-native/dist/node/`. Node cannot load the package's TypeScript from an app's `node_modules`, so those entries ship as JavaScript; `tests/dist.test.ts` fails on a stale `dist/node/`.
- Harness only: `cd apps/qa && bun test --timeout 120000 qa`, `pnpm native-qa:typecheck`, `pnpm lint`.
- CI (`.github/workflows/`, README "CI"): `ci.yml` runs the checks above on every push to main and every pull request with `CI=1` (the Kotlin and C++ host checks fail instead of skipping when kotlinc, a JDK or a jar is missing); `consumer.yml` is `scripts/consumer-check.sh` (its `starter` mode follows the guide: `sv create`, `pnpm add`, `svelte-native init`; after editing the script run `bash -n` and `shellcheck -x -S warning scripts/*.sh`); `native-qa.yml` is the emulator lane and stays off until the owner registers the runner and sets `QA_EMULATOR_RUNNER` (`apps/qa/qa/ci/RUNBOOK.md`); `release.yml` publishes a tag `v<version>` (README "Release"). After editing a workflow run `actionlint` (its config is `.github/actionlint.yaml`). Dispatching a workflow, setting a secret or variable, registering a runner and pushing a tag are the owner's, not an agent's.
- Heavy runs (full test suites, builds) on a shared machine: cap them, for example `systemd-run --user --scope -p CPUQuota=600% nice -n 19 ionice -c3 <command>`.

## QA harness

`node qa/native-qa.ts <command>` from `apps/qa` (commands and flags: `apps/qa/qa/README.md`; the pass/fail numbers are in `qa/gates.json`). Everything that needs a device takes `--device <serial>`; nothing defaults to a phone or a Mac.

## Devices

- The Samsung phone is shared. Install with `adb install -r` only; never clear an app's data, uninstall other apps or change settings. Touch only the QA apps (`io.rasheed.svelteqa*`).
- The harness holds a lock per emulator and per EAS channel (README "Devices and locks"); do not bypass it.
- Do not start device runs, builds or pushes unless asked.

## Rules

- Do not rewrite history or add a remote without the owner's OK.
- Keep the library generic: no product code, secrets or proprietary SDKs. The smoke app has no Samsung Pay module (`expo-samsung-pay` and its SDK jar are not part of this repository and are not added); `apps/qa/libs/` stays ignored so a proprietary jar put there is never committed.
- The library's native modules are `packages/svelte-native/native/<name>`, linked by the package's one `expo-module.config.json` (Gradle projects keep their names, `:svelte-engine`, `:svelte-updates`; the pods are listed in `podspecPath`). A new module is an entry there, not a config of its own: autolinking reads only the package root's. `apps/qa/modules/` holds QA-only modules (they are excluded from the product).
- The QA app and the showcase consume the library through its workspace dependency, as an app outside the repository does: no relative path into `packages/svelte-native` in its runtime or build code (tests may). What a dependent receives is what `files` in the package's `package.json` packs (`pnpm pack --dry-run`); `tests/packaging.test.ts` pins it.
- Components are compiled in runes mode unless a file opts out (`<svelte:options runes={false} />`), outside `node_modules` and in the library's own sources (`src/compile-options.ts`, README "Coming from Svelte on the web"). A test that compiles a `.svelte` fixture takes its options from `componentOptions`, as the transformer does, and does not write its own.
- `svelte` is a peer dependency naming the custom-renderer build; the repository installs `vendor/svelte-5.56.7-216f258.tgz` as a development dependency. Do not put a `file:`, `workspace:` or `catalog:` specifier in the package's `dependencies` (a dependent cannot resolve it).
