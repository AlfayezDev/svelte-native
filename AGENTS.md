# Agent guide

Svelte Native: the library and its native modules (`native/`) in `packages/svelte-native`, the example app, its QA-only Expo modules and the QA harness in `apps/example`. The layout and the install are in `README.md`; the library's own docs are `packages/svelte-native/README.md` and `REFERENCE.md`, the Android engine's spec is `packages/svelte-native/native/svelte-engine/SPEC.md`.

## Checks

- `pnpm install --frozen-lockfile`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` from the root.
- Package only: `cd packages/svelte-native && bun test --timeout 60000`, `pnpm lint`, `pnpm typecheck`.
- Harness only: `cd apps/example && bun test --timeout 120000 qa`, `pnpm native-qa:typecheck`, `pnpm lint`.
- Heavy runs (full test suites, builds) on a shared machine: cap them, for example `systemd-run --user --scope -p CPUQuota=600% nice -n 19 ionice -c3 <command>`.

## QA harness

`node qa/native-qa.ts <command>` from `apps/example` (commands and flags: `apps/example/qa/README.md`; the pass/fail numbers are in `qa/gates.json`). Everything that needs a device takes `--device <serial>`; nothing defaults to a phone or a Mac.

## Devices

- The Samsung phone is shared. Install with `adb install -r` only; never clear an app's data, uninstall other apps or change settings. Touch only the example app (`io.rasheed.svelteqa*`).
- The harness holds a lock per emulator and per EAS channel (README "Devices and locks"); do not bypass it.
- Do not start device runs, builds or pushes unless asked.

## Rules

- Do not rewrite history or add a remote without the owner's OK.
- Keep the library generic: no product code, secrets or proprietary SDKs. The smoke app has no Samsung Pay module (`expo-samsung-pay` and its SDK jar are not part of this repository and are not added); `apps/example/libs/` stays ignored so a proprietary jar put there is never committed.
- The library's native modules are `packages/svelte-native/native/<name>`, linked by the package's one `expo-module.config.json` (Gradle projects keep their names, `:svelte-engine`, `:svelte-updates`; the pods are listed in `podspecPath`). A new module is an entry there, not a config of its own: autolinking reads only the package root's. `apps/example/modules/` holds QA-only modules (they are excluded from the product).
- The example consumes the library through its workspace dependency, as an app outside the repository does: no relative path into `packages/svelte-native` in its runtime or build code (tests may). What a dependent receives is what `files` in the package's `package.json` packs (`pnpm pack --dry-run`); `tests/packaging.test.ts` pins it.
- `svelte` is a peer dependency naming the custom-renderer build; the repository installs `vendor/svelte-5.56.7-216f258.tgz` as a development dependency. Do not put a `file:`, `workspace:` or `catalog:` specifier in the package's `dependencies` (a dependent cannot resolve it).
