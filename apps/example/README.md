# Svelte Native showcase

A tour of [`@rasheed/svelte-native`](../../packages/svelte-native/README.md): a small app where every feature of the library is its own screen with one short example. It is written the way an app that installs the library would be written, and it imports nothing but the library's public entries (`@rasheed/svelte-native`, `/animation`, `/gestures`, `/foreign`, `/svg`, ...). Read it with the library's [README](../../packages/svelte-native/README.md) and [REFERENCE](../../packages/svelte-native/REFERENCE.md) beside it.

The app id is `io.rasheed.sveltenative.example`, the name is "Svelte Native" and the link scheme is `svelte-native://`.

## Run it

You need the repository's tools (Node 25, pnpm, see the [root README](../../README.md)), and for a device the Android SDK or Xcode.

```sh
pnpm install --frozen-lockfile      # once, from the repository root
cd apps/example
pnpm android                        # svelte-native android: prebuild, build and install on a device or emulator
pnpm ios                            # svelte-native ios (a Mac with Xcode)
pnpm start                          # only the Metro server, for a build that is already installed
pnpm check-setup                    # svelte-native doctor: checks the app's setup (peer versions, patches, Metro and Expo wiring)
```

`pnpm android` and `pnpm ios` are the library's command line (`svelte-native android|ios`), which writes the route table into `.svelte-native/` and runs `expo run:android|ios`. A change to a native dependency or to `app.config.ts` needs a new native build; a change to a screen does not (a save remounts the app).

## How the app is put together

- `src/routes/` is the navigation: a folder with a `+mobile.svelte` file is a screen, so `src/routes/layout/+mobile.svelte` is the route `/layout`. `+layout.mobile.svelte` at the top is the app shell; one with `export const navigator = "tabs"` makes its folder a tab bar.
- `src/lib/features/` lists the features. The home screen reads `core.ts` and `native.ts` and shows their entries by group. A feature is a folder in `src/routes` and one entry in a registry; `test/routes.test.ts` fails when the two disagree.
- `src/lib/components/` holds three small shared pieces: `Page` (the frame of a feature screen: header, explanation, scrolling body), `Section` (a captioned example) and `Button`. `src/lib/theme.svelte.ts` has the colours for light and dark mode.
- Every screen starts with a comment that says what it shows and which API it uses, and stays short. Where a variant is interesting both versions are on the screen side by side.

## Features

| Feature | Route | What it shows |
| ------- | ----- | ------------- |
