# Troubleshooting

Most problems in the first hour are one of a few. This page lists them with their fixes, and starts with the tool that finds many of them for you.

## svelte-native doctor

```sh
pnpm exec svelte-native doctor
```

`doctor` reads your project and prints one line per check: `pass`, `FAIL`, `skip` (an optional library you haven't installed) or `????` (it couldn't tell). Under a failure it prints the fix. It exits 1 when a check failed, and it changes nothing.

> [!NOTE] Use `pnpm exec`. A plain `pnpm doctor` is pnpm's own command, and it checks pnpm, not your app.

The failures you're likely to see:

- **`node 25.0.0 does not satisfy ^22.17.0 || ^24.3.0 || >=26.0.0`.** Use Node 24 LTS (24.3 or newer), Node 22.17 or newer, or Node 26 or newer; see `ERR_PNPM_UNSUPPORTED_ENGINE` under [pnpm stops during install](#pnpm-stops-during-install) for why not 25.
- **`svelte … is the stock Svelte: it has no ./renderer export`.** You have the registry's Svelte. Install the pinned build: `"svelte": "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5"`.
- **`react 19.2.6 does not satisfy 19.2.7`**, or any other peer. The versions are exact, because each patch is for one version. Set the version it asks for.
- **`… is not applied`** for a patch. Copy the patch files from `node_modules/@rasheed/svelte-native/patches/` into `patches/svelte-native/` again and run `pnpm install`. A copy from an older release applies cleanly but doesn't have the fix.
- **`metro.config.cjs does not mention withSvelteNative`**. See [Creating a project](02-creating-a-project.md#metroconfigcjs-and-appjson).

[The package README](../packages/svelte-native/README.md) shows a full example of its output, in the section "Check an app with `svelte-native doctor`".

## pnpm cannot read the repository

```
ERR_PNPM_GIT_RESOLVE_FAILED
… git ls-remote failed: fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

The repository is private. pnpm fetches a GitHub dependency over HTTPS even when you gave it an SSH address, so a machine that can read the repository only with an SSH key fails. Tell git to use SSH for this account's repositories, once:

```sh
git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"
```

You need the setting for later installs, too. A fresh `pnpm install` of the project fails with `ERR_PNPM_GIT_FETCH_FAILED` without it.

If it still fails, `ssh -T git@github.com` should greet you by name. If it doesn't, your key isn't on your GitHub account, or you haven't been added to the repository.

## svelte-native init stops or leaves something for you

`init` prints a plan before it writes anything (`--dry-run` stops there). It stops without writing when:

- **The project has no `package.json`.** Run it in the directory of your project, after `npx sv create`.
- **The project uses npm, Yarn or Bun.** The library's patches are pnpm's. Create the project again with pnpm, or move it to pnpm.

It leaves a file alone, prints the change for you to make and exits with status 1 when:

- **`vite.config.ts` isn't the shape `sv` writes.** It prints the three lines to change. Wrap your options as `kit` and make the config a function of the mode, as in [Creating a project](02-creating-a-project.md#viteconfigts).
- **`metro.config.cjs` exists and doesn't use `withSvelteNative`.** Wrap the config you export.
- **The app is configured in `app.config.ts`**, or a block of `pnpm-workspace.yaml` is written in flow style (`allowBuilds: { esbuild: true }`).

A warning about a `main`, a script or a patch for a library at another version means `init` kept what you had; `--force` replaces the `main`.

## pnpm stops during install

- **`ERR_PNPM_UNSUPPORTED_ENGINE`**, as in `Unsupported engine for @react-native/babel-plugin-codegen@0.88.1: wanted: {"node":"^22.13.0 || ^24.3.0 || >= 26.0.0"} (current: {"node":"25.0.0"})` (the package named can be another `@react-native` or `metro` package). You are on Node 25. React Native 0.86.3 allows it, but asks for `@react-native/metro-config` by a range, so a fresh install takes 0.88, whose tools (and Metro 0.87) exclude Node 25, and `sv` writes `engineStrict: true`, so pnpm stops. It stops at the first `pnpm add`, before `svelte-native init` has pinned `@react-native/metro-config` to React Native's version, so `init` cannot fix it. Switch to Node 24 LTS (24.3 or newer; `mise use node@24`, `nvm install 24` or the installer from nodejs.org), Node 22.17 or newer, or Node 26 or newer, and run `pnpm add` again. On Node 22 before 22.17 the package named is `@sveltejs/kit` (`wanted: {"node":">=22.17"}`). Once the library is installed, `svelte-native doctor` fails Node 25 too, with the same advice.
- **`ERR_PNPM_UNUSED_PATCH`.** A patch is declared for a package that isn't installed, or at another version. Remove the entry, or install the package at the version in the patch's file name. For `expo-modules-core` the usual cause is the missing `overrides` entry: `expo` asks for it by a range, so a fresh install takes a newer one.
- **`ERR_PNPM_IGNORED_BUILDS`.** esbuild's install script isn't allowed. `sv` writes that setting for pnpm; if your project doesn't have it, add `allowBuilds: { esbuild: true }` to `pnpm-workspace.yaml`, or run `pnpm add --allow-build=esbuild <the library>` for the first install.
- **A frozen lockfile in CI.** Declaring the patches changes the lockfile, and with `CI=1` pnpm refuses an install it would have to change. Run `pnpm install --no-frozen-lockfile` once, and commit `pnpm-lock.yaml`.
- **Peer warnings.** `pnpm peers check` lists one unmet peer, `svelte`, and it stops nothing: the build from a URL is not in the range the registry's packages ask for. It's expected. (`@react-native/metro-config` 0.88 beside React Native 0.86.3 was listed too before `init` pinned it in `overrides`; a project set up by an older `init` still lists it, and `svelte-native init` again fixes it.)

## The app says "Unable to load script"

The red screen reads _Unable to load script. Make sure you're running Metro_. A debug build gets its JavaScript from Metro, and the app can't reach it. Check:

- Metro is running: `pnpm android` or `pnpm native` is still going in a terminal.
- A phone on USB needs a tunnel to Metro's port: `adb reverse tcp:8081 tcp:8081`.
- An emulator on your own machine reaches Metro at `10.0.2.2:8081` by default. If the emulator is on another machine and you reach it through an `adb` tunnel, that address is wrong, and the app loaded only after its debug server host was set to `localhost:8081` (React Native keeps it in the app's `debug_http_host` preference) together with the `adb reverse` above.

A release build doesn't ask Metro at all. If you see this on one, the bundle wasn't packaged: build it again ([Development builds](05-development-builds.md#debug-and-release-builds)).

## expo prebuild asks about uncommitted changes

`expo prebuild` deletes `android/` and `ios/` and writes them again, so when git has uncommitted changes it asks first: _Continue with uncommitted changes?_ Answer yes, or commit first. It never touches your own files, only the generated folders.

## The Android build fails

Gradle needs a JDK 17, an Android SDK with the packages the project asks for (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1), and `ANDROID_HOME` pointing at it. Set `JAVA_HOME` to a JDK 17 if your default is another version. The first build downloads a lot.

## Still stuck?

Open an [issue](https://github.com/AlfayezDev/svelte-native/issues/new?template=bug.yml). The form asks for what makes it fast to fix: the output of `pnpm exec svelte-native doctor`, the library version, your device, and the log. On Android, `adb logcat -d` right after the problem has it.
