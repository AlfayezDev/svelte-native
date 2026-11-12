---
title: Release builds
---

A _release build_ has your JavaScript bundled inside it, compiled to bytecode, so it runs without Metro. It's what you give to testers and publish to the stores.

## Before you publish

- **Identifiers.** `init` names the app `dev.example.<name>`, a placeholder. Set your own `android.package` and `ios.bundleIdentifier` in `app.json`. They can't change once the app is in a store.
- **Name, icon and version.** `name`, `icon`, `version` and the splash screen are in `app.json` too. See Expo's [app config reference](https://docs.expo.dev/versions/latest/config/app/).
- **Prebuild** after changing any of them ([When to run expo prebuild](development-builds#when-to-run-expo-prebuild)).

## Android

Build and install a release build on the connected device in one step:

```sh
pnpm android --variant release
```

To build an APK file to share, build the generated project with Gradle:

```sh
pnpm exec expo prebuild --platform android
cd android
./gradlew :app:assembleRelease
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`. Install it with `adb install -r app-release.apk`. For Google Play, build an app bundle with `./gradlew :app:bundleRelease` and sign it with your upload key; Android's guide to [signing your app](https://developer.android.com/studio/publish/app-signing) explains the keys.

## iOS

On a Mac:

```sh
pnpm ios --configuration Release
```

To publish, open `ios/<YourApp>.xcworkspace` in Xcode, choose your team under **Signing & Capabilities**, and use **Product › Archive**.

## Over-the-air updates

A release build can download new JavaScript without a new store release, from Expo's update service (`eas update`). Svelte Native has its own updates client for this: see [Updates](updates).

> **info** Building on Expo's servers with EAS Build hasn't been tried with Svelte Native yet. Local builds, as above, work.
