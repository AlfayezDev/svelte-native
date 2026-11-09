# Agent guide

Svelte Native: the library in `packages/svelte-native`, the example app, Expo modules and QA harness in `apps/example`. The layout and the install are in `README.md`; the library's own docs are `packages/svelte-native/README.md` and `REFERENCE.md`, the Android engine's spec is `apps/example/modules/svelte-engine/SPEC.md`.

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
- Keep the library generic: no product code, secrets or proprietary SDKs. The Samsung Pay SDK jar (`apps/example/libs/samsungpay.jar`) is never committed.
