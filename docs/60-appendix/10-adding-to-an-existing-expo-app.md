---
title: Adding to an existing Expo app
---

[Creating a project](creating-a-project) starts from SvelteKit. This page is for the other direction: you have an Expo app, and you want its screens written in Svelte. The result is a native-only app, with no web app, and it doesn't need SvelteKit or Vite.

Your app must be on Expo SDK 58 (React Native 0.88) and use pnpm 12.3.4 or newer: Expo Svelte's patches are pnpm's, so a project on npm or Yarn moves to pnpm first. Use Node 24 LTS (24.3 or newer), Node 22.17 or newer, or Node 26 or newer, not Node 25 ([Troubleshooting](troubleshooting#pnpm-stops-during-install)).

## 1. Take the React app out of the way

Expo Svelte has its own entry point and router, and runs no React. Remove:

- the React entry: `App.tsx`, an `index.js` that calls `registerRootComponent`, or `expo-router/entry` as `"main"`
- expo-router: its `app/` directory, and `"expo-router"` in the `plugins` of `app.json`
- your React components and hooks

Keep `app.json` with its name, identifiers, icons, permissions and other plugins, your `assets/`, `eas.json`, your own Expo modules in `modules/`, and every library that doesn't need React ([Native libraries](native-libraries)).

## 2. Allow esbuild, pin two packages and shorten pnpm's store names

The first install already needs these settings. If your project isn't a pnpm workspace, `pnpm-workspace.yaml` holds just them:

```yaml
/// file: pnpm-workspace.yaml
allowBuilds:
  esbuild: true
overrides:
  expo-modules-core: 58.1.0
  "@react-native/metro-config": 0.88.1
virtualStoreDirMaxLength: 60
```

[Configuration](configuration#pnpm-workspaceyaml) says why each is there. A project that already has `node_modules` installs again after the new `virtualStoreDirMaxLength`: pnpm asks to remove it (`pnpm install --config.confirmModulesPurge=false` when there is no terminal to ask).

## 3. Install the library

```sh
pnpm add expo-svelte@next
```

## 4. Run init

`expo-svelte init` works in an Expo project as it does in a SvelteKit one. It sees there is no SvelteKit, leaves Vite alone and doesn't install SvelteKit:

```sh
pnpm exec expo-svelte init --dry-run    # see what it would change
pnpm exec expo-svelte init
```

It installs the Svelte build Expo Svelte needs and the native dependencies at the right versions, copies and declares the patches, writes `metro.config.cjs`, adds its plugin to your `app.json`, sets `"main"`, adds the scripts and writes a first screen. A `metro.config.cjs` or `"main"` of your own is left as it is, and the change is printed for you to make. [Configuration](configuration) shows every change, if you'd rather make them by hand.

## 5. Generate the native project and run

Your app may already have `android/` or `ios/` folders from before. Generate them again, so that Expo Svelte's plugin is applied:

```sh
pnpm exec expo prebuild
pnpm exec expo-svelte doctor
pnpm android        # or: pnpm ios
```

`doctor` should end with `0 failed`. Then write your screens: [Routing](routing) explains where they go.
