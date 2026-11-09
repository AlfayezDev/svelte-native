# Development builds

A web app runs in a browser that already exists. A native app has to be built: compiled, packaged and installed on a device. This page explains how that works for a Svelte Native app, and what a normal day of development looks like once you've done it.

## Why not Expo Go?

If you've used Expo before, you may have opened a project in the Expo Go app. Expo Go is a prebuilt app with a fixed set of native modules. Svelte Native ships native code of its own (the Android renderer, the iOS navigation, and more), and Expo Go can't load it.

So you build your own app. While you develop it's a _debug build_, which doesn't contain your JavaScript: it asks a development server for it. Because of that, a change to a Svelte file shows up on the device without a rebuild.

> [!NOTE] Expo also has a thing called the _dev client_, a debug build with extra tooling. Svelte Native doesn't support it. You'll see Expo print a link like `my-app://expo-development-client/…` when it opens your app. That's how Expo opens a debug build, and it works.

## Continuous Native Generation

An Expo app doesn't keep its `android/` and `ios/` folders in git. It describes the native project, and Expo generates it. Expo calls this _Continuous Native Generation_, and the command that does it is `expo prebuild`.

The inputs are:

- `app.json` (or `app.config.ts`): the app's name, identifiers, icons, permissions
- the _config plugins_ listed in it (Svelte Native's is one)
- the packages you've installed, which carry native code of their own

The output is the `android/` and `ios/` folders. They're build output, like `.svelte-kit`. Your `.gitignore` leaves them out, and when you want to change something about the native project, you change one of the inputs and run prebuild again. Edits made inside `android/` or `ios/` are replaced the next time.

By default `expo prebuild` starts from nothing: it deletes the platform folders and writes them again. If git has uncommitted changes, it asks before it does. `--no-clean` applies the changes to the existing folders instead.

## When to run expo prebuild

`pnpm android` and `pnpm ios` run prebuild for you when the platform's folder doesn't exist. After that they build what is there. Nothing notices that `app.json` or a package changed, so after a change that affects the native project, run it yourself:

```sh
pnpm exec expo prebuild --platform android
```

Run it:

- the first time (the commands above do this one for you)
- after you add or remove a package with native code, for example `npx expo install expo-camera`
- after you change a config plugin or its options, or the native keys of `app.json`: the identifiers, permissions, icons, splash screen, `scheme`
- after you upgrade `@rasheed/svelte-native`, because its plugin writes into the generated project

You don't need it for:

- a change to a Svelte or TypeScript file. Metro reloads it
- a new or removed route. The command line regenerates `.svelte-native/` itself
- a change to a patch. That changes what is compiled, not the project: install, then build again

Prebuild makes the project. It doesn't build it. `pnpm android` and `pnpm ios` do that.

## The daily loop

Build and install once:

```sh
pnpm android        # or: pnpm ios
```

This generates the project if needed, builds it with Gradle (or Xcode), installs it, starts Metro and opens the app. Metro stays running in that terminal. Edit a file, save, and the app reloads.

Next time, you don't need to rebuild. Start the development server and open the app that's already installed:

```sh
pnpm native
```

If you use a phone over USB, it needs to reach your computer's port 8081: `adb reverse tcp:8081 tcp:8081`.

What happens when you save:

- A change to a Svelte or TypeScript file re-runs the changed module and the app's entry, and remounts the app on the same root. Navigation state and native state are kept. Component state is not: Svelte Native has no state-preserving hot reload yet.
- A new or removed route file is picked up by `pnpm native`.
- An uncaught error shows a red error screen, with a Reload button.

A change to anything native needs a build: a package with native code, a plugin, the native keys of `app.json`, the library's version. Prebuild first, then `pnpm android`.

> [!NOTE] Don't start Metro with `CI=1` in the environment. It turns the file watcher off, and your bundles go stale.

## Debug and release builds

`pnpm android` and `pnpm ios` make a debug build. A _release build_ has your JavaScript bundled into the app, so it runs without Metro. It's what you'd hand to a tester.

For Android, build a release APK from the generated project:

```sh
pnpm exec expo prebuild --platform android
cd android
./gradlew :app:assembleRelease
```

The APK is in `android/app/build/outputs/apk/release/app-release.apk`. Expo's `pnpm android --variant release` builds and installs one in a single step. For iOS, `pnpm ios --configuration Release` is Expo's way; the library's own checks build the Release configuration with `xcodebuild` on a Mac and sign it for a device.

> [!NOTE] Building on Expo's servers with EAS Build hasn't been tried with Svelte Native. The library does include an updates client that works with `eas update`.

## Further reading

- Expo's [prebuild](https://docs.expo.dev/workflow/prebuild/) and [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/) pages.
- [Native libraries](06-native-libraries.md) for what happens when you add a package with native code.
- [Troubleshooting](08-troubleshooting.md) if the app can't reach Metro.
