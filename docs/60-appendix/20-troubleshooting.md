---
title: Troubleshooting
---

Most problems in the first hour are one of a few. Start with the doctor: it finds many of them for you.

## Run the doctor

```sh
pnpm exec svelte-native doctor
```

`doctor` reads your project and prints one line per check, with the fix under each failure. It changes nothing. Use `pnpm exec`: a plain `pnpm doctor` is pnpm's own command. The failures you are most likely to see:

| It says | Do this |
| --- | --- |
| `node 25.0.0 does not satisfy ^22.17.0 \|\| ^24.3.0 \|\| >=26.0.0` | Switch to Node 24 LTS (24.3 or newer), Node 22.17 or newer, or Node 26 or newer. See [below](#pnpm-stops-during-install) for why not Node 25. |
| `svelte … is the stock Svelte: it has no ./renderer export` | You have the registry's Svelte. Run `pnpm exec svelte-native init`, which installs the build Svelte Native needs. |
| `react 19.2.6 does not satisfy 19.2.7`, or another version | Install the exact version it names. Each patch is made for one version. |
| `… is not applied` | Run `pnpm exec svelte-native init` again, which copies the current patches, then `pnpm install`. |
| `metro.config.cjs does not mention withSvelteNative` | Wrap your Metro config in `withSvelteNative` ([Configuration](configuration#metroconfigcjs)). |

## pnpm cannot read the repository

```
ERR_PNPM_GIT_RESOLVE_FAILED
… git ls-remote failed: fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

The repository is private, and pnpm fetches GitHub dependencies over HTTPS even when you give it an SSH address. Tell git to use SSH for this account, once:

```sh
git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"
```

Later installs need the same setting: without it, `pnpm install` fails with `ERR_PNPM_GIT_FETCH_FAILED`. If it still fails, check that `ssh -T git@github.com` greets you by name. If it doesn't, your SSH key isn't on your GitHub account, or you don't have access to the repository yet.

## pnpm stops during install

### ERR_PNPM_UNSUPPORTED_ENGINE

```
Unsupported engine for @react-native/babel-plugin-codegen@0.88.1: wanted: {"node":"^22.13.0 || ^24.3.0 || >= 26.0.0"} (current: {"node":"25.0.0"})
```

You are on Node 25. A fresh install takes React Native tools whose newest versions exclude Node 25, and the project created by `sv` tells pnpm to stop on that. It happens at the first `pnpm add`, before `svelte-native init` can pin those tools, so `init` can't prevent it. Switch to Node 24 LTS (24.3 or newer; `mise use node@24`, `nvm install 24`, or the installer from nodejs.org), Node 22.17 or newer, or Node 26 or newer, and run `pnpm add` again.

On Node 22 before 22.17, the package named is `@sveltejs/kit`. The fix is the same.

### ERR_PNPM_UNUSED_PATCH

A patch is declared for a package that isn't installed, or is installed at another version. Remove its line from `patchedDependencies` in `pnpm-workspace.yaml`, or install the package at the version in the patch's name. For `expo-modules-core`, the usual cause is a missing `overrides` entry ([Configuration](configuration#pnpm-workspaceyaml)).

### ERR_PNPM_IGNORED_BUILDS

esbuild's install script isn't allowed. Add this to `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```

### A frozen lockfile in CI

Declaring the patches changes the lockfile, and with `CI=1` pnpm refuses an install that would change it. Run `pnpm install --no-frozen-lockfile` once and commit `pnpm-lock.yaml`.

### Peer dependency warnings

pnpm reports `svelte` as an unmet peer. That's expected: the Svelte build Svelte Native needs is installed from a URL, outside the range the registry's packages ask for. It doesn't stop anything.

## init leaves something for you

`init` stops without writing anything when the project has no `package.json` (run it in your project's directory) or uses npm, Yarn or Bun (move it to pnpm).

It leaves a file alone, prints the change for you to make, and exits with status 1 when:

- `vite.config.ts` doesn't look like the one `sv` writes. Make the change it prints: [Configuration](configuration#viteconfigts) shows the result.
- `metro.config.cjs` exists and doesn't use `withSvelteNative`. Wrap the config you export.
- The app is configured in `app.config.ts`, or `pnpm-workspace.yaml` uses the inline style (`allowBuilds: { esbuild: true }`).

A warning about `"main"`, a script or a patch means `init` kept what you had. `--force` replaces the `"main"`.

## Unable to load script

The red screen says _Unable to load script. Make sure you're running Metro_. A debug build loads its JavaScript from Metro, and the app can't reach it:

- Check that Metro is running: `pnpm android` or `pnpm native` is still going in a terminal.
- A phone on USB needs the port forwarded: `adb reverse tcp:8081 tcp:8081`.
- An Android emulator on your computer reaches Metro by itself. One on another machine, reached over an `adb` tunnel, also needs the app's debug server set to `localhost:8081`: shake the device (or press <kbd>Ctrl</kbd>+<kbd>M</kbd>), open **Settings**, and set **Debug server host & port for device**.

A release build doesn't use Metro. If you see this on one, it was built without its bundle: build it again ([Release builds](release-builds)).

## expo prebuild asks about uncommitted changes

`expo prebuild` deletes `android/` and `ios/` and writes them again, so when git has uncommitted changes it asks _Continue with uncommitted changes?_ first. Answer yes, or commit first. It only touches the generated folders, never your own files.

## The Android build fails

Gradle needs a JDK 17 and the Android SDK packages the project asks for: platform 36, build-tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1. Install them from Android Studio's SDK Manager, set `ANDROID_HOME` to the SDK, and set `JAVA_HOME` to a JDK 17 if your default Java is another version. The first build downloads a lot.

## Still stuck?

[Open an issue](https://github.com/AlfayezDev/svelte-native/issues/new?template=bug.yml). The form asks for what makes it quick to fix: the output of `pnpm exec svelte-native doctor`, the library version, your device and the log. On Android, `adb logcat -d` right after the problem has the log.
