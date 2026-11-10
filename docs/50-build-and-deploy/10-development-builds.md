---
title: Development builds
---

A web app runs in a browser that already exists. A native app has to be built: compiled, packaged and installed on a device. This page explains how that works, and what a normal day of development looks like once the app is installed.

## A build of your own

While you develop, your app is a _debug build_. It doesn't contain your JavaScript: it asks the development server, Metro, for it each time it starts. That is why a change to a Svelte file shows up without a rebuild.

You build your own app because Svelte Native has native code of its own. The Expo Go app can only load the native code it was built with, so it can't run a Svelte Native app.

## The daily loop

Build and install the app once:

```sh
pnpm android        # or: pnpm ios
```

This generates the native project if it doesn't exist yet, builds it, installs it, starts Metro and opens the app. Metro keeps running in that terminal. Edit a file, save, and the app reloads.

The next day there is nothing to build. Start Metro and open the app that is already installed:

```sh
pnpm native
```

A phone connected over USB reaches Metro through a forwarded port: `adb reverse tcp:8081 tcp:8081` on Android. An emulator or simulator on the same computer needs nothing.

When you save:

- A change to a `.svelte` or `.ts` file reloads the app's root. You stay on the same screen, but component state is lost: there is no Fast Refresh yet.
- A new or deleted route file is picked up as well.
- An uncaught error shows a red error screen with a **Reload** button.

> [!NOTE] Don't start Metro with `CI=1` in the environment. It turns the file watcher off, and the app keeps loading old code.

## Continuous Native Generation

Your project has no hand-written Android or iOS project. The `android/` and `ios/` folders are generated from your configuration by `expo prebuild`, which Expo calls _Continuous Native Generation_. The inputs are:

- `app.json` (or `app.config.ts`): the app's name, identifiers, icon, splash screen, permissions
- the config plugins listed in it, Svelte Native's among them
- the packages you installed that have native code

The folders are build output, like `.svelte-kit`, and git ignores them. To change the native project, change one of the inputs and generate it again. Edits made inside `android/` or `ios/` are lost the next time.

`expo prebuild` deletes the folders and writes them from scratch. When git has uncommitted changes it asks first. `--no-clean` updates the existing folders instead.

## When to run expo prebuild

`pnpm android` and `pnpm ios` run prebuild when the platform's folder is missing. After that they build what is there, and don't notice that the configuration changed. Run it yourself after a change to the native side:

```sh
pnpm exec expo prebuild --platform android
pnpm android
```

Run it after you:

- add or remove a package with native code, such as `npx expo install expo-camera`
- change a config plugin or its options, or the native parts of `app.json`: identifiers, permissions, icon, splash screen, `scheme`
- upgrade `@example/svelte-native`, whose plugin writes into the native project

You don't need it for:

- a change to a `.svelte` or `.ts` file: Metro reloads it
- a new or deleted route
- an updated patch: run `pnpm install`, then build again

## Checking the setup

`pnpm check-setup` runs [`svelte-native doctor`](cli), which checks the versions, the patches and the configuration, and prints how to fix what is wrong. Run it after an upgrade, or when a build fails in a way you don't understand.
