---
title: Command line
---

Svelte Native's command line is `svelte-native`. Run it from your app's directory, through pnpm:

```sh
pnpm exec svelte-native <command> [options]
```

`svelte-native init` adds four scripts to `package.json`, so the common commands are shorter:

```json
/// file: package.json
{
	"scripts": {
		"native": "svelte-native dev",
		"android": "svelte-native android",
		"ios": "svelte-native ios",
		"check-setup": "svelte-native doctor"
	}
}
```

`pnpm android`, `pnpm ios`, `pnpm native` and `pnpm check-setup` run them. The web app's scripts (`dev`, `build`, `preview`, `check`) are left alone, so `pnpm dev` is still `vite dev`.

> [!NOTE] Don't name a script `doctor`, and don't run `pnpm doctor`: that is pnpm's own command, which checks pnpm, not your app. Use `pnpm exec svelte-native doctor` or `pnpm check-setup`.

## init

```sh
pnpm exec svelte-native init [options]
```

Turns a SvelteKit project (from `npx sv create`) into a Svelte Native app. Run it after installing the library. It prints its plan, then:

- adds the dependencies, `main` and the scripts to `package.json`, and pins Svelte and SvelteKit to the builds Svelte Native needs;
- adds pnpm's `overrides` and `patchedDependencies` to `pnpm-workspace.yaml`, and copies the patches into `patches/svelte-native/`;
- creates `metro.config.cjs` and `app.json`, or adds the library's plugin to the `app.json` you have;
- wraps SvelteKit's plugin in `vite.config.ts` with `svelteNative()`;
- creates a first app if `src/routes` has no native routes: a root layout, a home screen, a details screen and `src/lib/theme.ts`;
- adds the generated folders to `.gitignore`;
- runs `pnpm install` and then `svelte-native doctor`.

[Configuration](configuration) shows each of these changes.

| Option | Description |
| --- | --- |
| `--dry-run` | Print the plan and write nothing. |
| `--name <name>` | The app's display name. Default: the package name. |
| `--android-package <id>` | The Android application id. Default: `dev.example.<package name>`. |
| `--ios-bundle-id <id>` | The iOS bundle identifier. Default: the same as the Android one. |
| `--no-install` | Write the files, but don't run `pnpm install` and the doctor. |
| `--force` | Replace a `main` field that `init` would have written differently. |

`dev.example.…` is a placeholder: set your own identifiers before you publish the app.

Run `init` again whenever you like. In a project that's set up it prints `Nothing to change`. After an upgrade of Svelte Native it copies the new patches and versions in. It never overwrites a change of yours without saying so: when a file has a shape it can't edit safely (a `vite.config.ts` that isn't what `sv` writes, an `app.config.ts`), it leaves the file alone, prints the exact change for you to make, and exits with status 1.

`init` also works in an existing Expo app, without SvelteKit: see [Adding to an existing Expo app](adding-to-an-existing-expo-app).

## doctor

```sh
pnpm exec svelte-native doctor [--json]
```

Checks that the app is set up as Svelte Native needs, and changes nothing. It prints one line per check, grouped:

```
svelte-native doctor: /home/you/my-app

environment
  pass  node 24.18.1 (needs ^22.17.0 || ^24.3.0 || >=26.0.0)
  pass  pnpm 12.3.4 (needs >=12.3.4)

svelte
  pass  svelte 5.56.7 has the ./renderer export and the customRenderer compiler option

peer dependencies
  pass  react-native 0.86.3 satisfies 0.86.3
  …
  FAIL  react 19.2.6 does not satisfy 19.2.7
        fix: pnpm add react@19.2.7
  skip  optional view libraries not installed, nothing to check: lottie-react-native, react-native-maps

patches
  pass  react-native-reanimated@4.5.1 applied: the engine's views are written natively and opacity/translate/scale skip React Native's prop path (Android)
  …

build integration
  pass  @rasheed/svelte-native 0.4.0-rc.3 is a dependency of the app
  pass  metro.config.cjs uses withSvelteNative
  pass  app.json lists the @rasheed/svelte-native/expo plugin

21 passed, 1 failed, 0 could not tell, 1 skipped
```

| Status | Meaning |
| --- | --- |
| `pass` | The check passed. |
| `FAIL` | The check failed. The line below it says how to fix it. |
| `skip` | Nothing to check, such as an optional library you haven't installed. |
| `????` | It couldn't tell, such as a Metro config that applies the library from another file. |

It checks Node and pnpm; that Svelte is the custom-renderer build; the versions of the peer dependencies; that each patch is applied to the installed package (not just declared); and that Metro and Expo are wired up. It exits with status 1 when a check failed, and 0 otherwise. `--json` prints the same checks as JSON.

Run it after an install that went wrong, after an upgrade, and before you report a bug. [Troubleshooting](troubleshooting) explains the failures you're likely to see.

## android

```sh
pnpm exec svelte-native android [expo run:android options]
```

Builds the app and runs it on an Android device or emulator:

1. Regenerates `.svelte-native/` (see [sync](#sync)).
2. Runs `expo run:android`, which prebuilds `android/` if it doesn't exist, compiles the app with Gradle, installs it, starts Metro and opens the app.

Every option goes to `expo run:android`. The useful ones:

| Option | Description |
| --- | --- |
| `--device [name]` | Pick a device. Without a name, it lists them. |
| `--variant release` | Build a release build, with the JavaScript inside. |
| `--port <port>` | Metro's port. Default 8081. |
| `--no-bundler` | Don't start Metro. |

It only prebuilds when `android/` is missing. After a change to native configuration, run `pnpm exec expo prebuild` yourself: see [Development builds](development-builds#when-to-run-expo-prebuild).

## ios

```sh
pnpm exec svelte-native ios [expo run:ios options]
```

The same as `android`, for iOS, on a Mac with Xcode. Every option goes to `expo run:ios`: `--device [name]` picks a simulator or a connected iPhone, and `--configuration Release` makes a release build.

## dev

```sh
pnpm exec svelte-native dev [expo start options]
```

Starts Metro, the development server, for an app that's already installed. Open the app and it loads its JavaScript from Metro. A save reloads the app.

`dev` regenerates `.svelte-native/` first, and again whenever a `+mobile.svelte` or `+layout.mobile.svelte` file is added, removed or renamed, so new routes appear without a restart. Every option goes to `expo start`: `--port <port>` sets the port, and `--clear` starts with empty caches.

A phone on USB needs a tunnel to Metro's port: `adb reverse tcp:8081 tcp:8081`.

## build

```sh
pnpm exec svelte-native build --platform android|ios
```

Bundles the app's JavaScript for release, as Hermes bytecode, without building the native app. The output goes to `.svelte-native/dist/<platform>/`: `index.hbc`, its source map `index.hbc.map`, and the `assets/` folder. `--platform` defaults to `android`.

A release build made with Gradle or Xcode bundles the JavaScript itself, so you don't need this command for that. Use it to look at the bundle, or to check that it builds.

## sync

```sh
pnpm exec svelte-native sync
```

Only regenerates `.svelte-native/`:

- `entry.ts`, the app's entry point, which `main` in `package.json` names;
- `routes.app.ts`, the route table: every `+mobile.svelte` and `+layout.mobile.svelte` under `src/routes`, with the `presentation` and `navigator` they export.

The other commands, and Metro itself, do this for you. Run `sync` when a tool reads `.svelte-native/` without going through them, such as a type check in CI. A route tree that breaks a rule (a page next to a navigator layout, a tab bar inside a tab bar, ...) fails here with the file's name.
