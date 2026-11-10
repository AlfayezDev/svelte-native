---
title: Creating a project
---

You start where every SvelteKit app starts, with `npx sv create`. Then you install Svelte Native and run one command that sets the project up:

```sh
npx sv create my-app
cd my-app
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#v0.4.0-rc.3&path:packages/svelte-native"
pnpm exec svelte-native init
pnpm android        # or: pnpm ios
```

The first `pnpm android` builds the native app, installs it on your phone or emulator and opens it. Edit `src/routes/+mobile.svelte`, save, and the app reloads with your change.

`v0.4.0-rc.3` is a release tag. The [releases page](https://github.com/AlfayezDev/svelte-native/releases) lists newer ones.

## Requirements

- **Node 24 LTS (24.3 or newer)**, Node 22.17 or newer, or Node 26 or newer. Not Node 25: React Native's tools refuse it, and `pnpm add` stops with `ERR_PNPM_UNSUPPORTED_ENGINE` ([Troubleshooting](troubleshooting#pnpm-stops-during-install)).
- **pnpm 12.3.4 or newer.** Svelte Native's patches are applied by pnpm, so npm, Yarn and Bun won't do.
- **Access to the repository.** It's private: you need to be a collaborator, with your SSH key on your GitHub account. `ssh -T git@github.com` should greet you by name.
- **For Android:** [Android Studio](https://developer.android.com/studio) with the Android SDK, a JDK 17, `ANDROID_HOME` set, and a phone with USB debugging or an emulator.
- **For iOS:** a Mac with Xcode and CocoaPods, and a simulator or an iPhone.

pnpm fetches GitHub dependencies over HTTPS, even when you give it an SSH address. If you reach GitHub with an SSH key only, tell git once to use SSH for this account:

```sh
git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"
```

## The commands

### npx sv create

Creates a SvelteKit project. Choose the **minimal** template, **TypeScript**, no add-ons, and **pnpm**. To skip the questions:

```sh
npx sv create my-app --template minimal --types ts --no-add-ons --install pnpm
```

### pnpm add

Installs the library from the repository. pnpm prints a few warnings about peer dependencies, which the next command takes care of.

### svelte-native init

Turns the SvelteKit project into a Svelte Native one. It prints a plan, makes the changes, runs `pnpm install`, and then runs [`svelte-native doctor`](cli#doctor) to check the result:

```
svelte-native init: /home/you/my-app

  edit    package.json                       "main", svelte (the custom-renderer build), @sveltejs/kit 3.1.1 (exact: …), 8 dependencies, scripts, …
  edit    pnpm-workspace.yaml                overrides: expo-modules-core, @react-native/metro-config; patchedDependencies: @sveltejs/kit@3.1.1, …
  create  patches/svelte-native/             5 patch files from the installed library
  create  metro.config.cjs                   withSvelteNative(getDefaultConfig(__dirname))
  create  app.json                           my-app, dev.example.myapp
  edit    vite.config.ts                     svelteNative() around SvelteKit's plugin, as a function of the mode
  create  src/lib/theme.ts                   light and dark colours for the native screens
  create  src/routes/+layout.mobile.svelte   the app shell
  create  src/routes/+mobile.svelte          a home screen
  create  src/routes/details/+mobile.svelte  a second screen
  edit    .gitignore                         .svelte-native, .expo, /android, /ios
```

Run it as often as you like: a project that is set up gets `Nothing to change`. It never overwrites something you changed. When a file has a shape it can't edit safely, it leaves the file alone and prints the change for you to make. `--dry-run` shows the plan without writing anything. [Project structure](project-structure) explains the files, and [Configuration](configuration) shows each change in full.

`dev.example.myapp` is a placeholder for the app's identifier. Pass `--android-package` and `--ios-bundle-id`, or edit `app.json`, before you publish.

### pnpm android

Builds the native app, installs it on the connected phone or emulator, starts the development server ([Metro](https://metrobundler.dev)) and opens the app. On a Mac, `pnpm ios` does the same for iOS.

The first build takes a while, because it compiles React Native and the library's native code. Later runs are faster, and most days you don't rebuild at all: [Development builds](development-builds) explains when you need to.

When more than one device is connected, pick one with `pnpm android --device <name>`.

## The web app

The web app is still there, and works as before:

```sh
pnpm dev
```

It now compiles with the same Svelte build as the native app, and runs on SvelteKit 3.1.1.

## Next steps

- [Project structure](project-structure) explains the files in your project.
- [Routing](routing) shows how `+mobile.svelte` files become screens.
- [Components](view) documents the building blocks of a screen.
