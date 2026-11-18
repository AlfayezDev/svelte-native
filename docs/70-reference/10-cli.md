---
title: Command line
description: The svelte-native command, with init, doctor, push, android, ios, dev, build, sync and css.
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

> **warning** Don't name a script `doctor`, and don't run `pnpm doctor`: that is pnpm's own command, which checks pnpm, not your app. Use `pnpm exec svelte-native doctor` or `pnpm check-setup`.

## init

```sh
pnpm exec svelte-native init [options]
```

Turns a SvelteKit project (from `npx sv create`) into a Svelte Native app. Run it after installing the library. It prints its plan, then:

- adds the dependencies, `main` and the scripts to `package.json`, and pins Svelte and SvelteKit to the builds Svelte Native needs;
- adds pnpm's `overrides` and `patchedDependencies` to `pnpm-workspace.yaml`, and copies the patches into `patches/svelte-native/`;
- creates `metro.config.cjs` and `app.json`, or adds the library's plugin to the `app.json` you have (a `@alfayez/svelte-native/expo` entry, which no longer resolves, becomes the package's name);
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
pnpm exec svelte-native doctor --server [--app <bundle id>] [--json]
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

vendored packages
  pass  react-native-svg 15.15.4 comes with @alfayez/svelte-native (vendor/react-native-svg); the app does not list it
  …

patches
  pass  expo-modules-core@57.0.23 applied: Expo modules register lazily and the common ones are prewarmed (Android start)
  …

build integration
  pass  @alfayez/svelte-native 0.4.0-rc.8 is a dependency of the app
  pass  metro.config.cjs uses withSvelteNative
  pass  app.json lists the @alfayez/svelte-native plugin

21 passed, 1 failed, 0 could not tell, 1 skipped
```

| Status | Meaning |
| --- | --- |
| `pass` | The check passed. |
| `FAIL` | The check failed. The line below it says how to fix it. |
| `skip` | Nothing to check, such as an optional library you haven't installed. |
| `????` | It couldn't tell, such as a Metro config that applies the library from another file. |

It checks Node and pnpm; that Svelte is the custom-renderer build; the versions of the peer dependencies; that each patch is applied to the installed package (not just declared); that the packages the library carries itself are there, patched and not listed by the app; that Metro and Expo are wired up; and, for an app that has push, its push setup (below). It exits with status 1 when a check failed, and 0 otherwise. `--json` prints the same checks as JSON.

Run it after an install that went wrong, after an upgrade, and before you report a bug. [Troubleshooting](troubleshooting) explains the failures you're likely to see.

### The push section

An app has push when its `app.json` turns `capabilities.push` on, or, for an app whose config is code, when the last prebuild turned push on (the flags it writes in the Android manifest and the iOS `Info.plist`). For any other app the doctor prints no push lines at all. The section reads files and runs nothing, like the rest of the doctor:

```
push
  pass  no other push library (expo-notifications, @react-native-firebase/messaging) is installed
  pass  app.json turns capabilities.push on (android, ios)
  pass  google-services.json is JSON and holds no server secret (Firebase project my-app)
  pass  google-services.json has a client for the app's package "dev.example.app"
  pass  ios/App/App.entitlements has aps-environment production
  pass  ios/App/Info.plist lists remote-notification in UIBackgroundModes
  pass  the last prebuild turned push on for android: android/app/src/main/AndroidManifest.xml (expo.modules.sveltepush.enabled)
  pass  the last prebuild turned push on for ios: ios/…/Info.plist (SveltePushEnabled)
```

| Check | Fails when |
| --- | --- |
| One push library | `expo-notifications` or `@react-native-firebase/messaging` is installed while `capabilities.push` is on. |
| The capability | `capabilities.push` in `app.json` is what the config plugin refuses (a secret, no platform named, a malformed `android` or `ios`), with the plugin's own message; `????` when an `app.config.*` may change it. |
| The Google services file | It's a server secret (`"type": "service_account"`, a `private_key`, a PEM key): the fix says to delete it, revoke the key, and keep it in the server's environment. Or it isn't JSON, or isn't where the config says. |
| Its client | It has no client for the app's Android package (`android.package` in `app.json`, else `applicationId` in `android/app/build.gradle` after a prebuild). |
| The entitlement | After a prebuild (an `ios/` folder), the app's `.entitlements` has no `aps-environment`, or has another mode from `capabilities.push.ios.mode`: the prebuild is older than the config. |
| The background mode | After a prebuild, `Info.plist` has no `remote-notification` in `UIBackgroundModes`. |
| The prebuild | A platform `capabilities.push` names whose native project the last prebuild wrote without push (no `expo.modules.sveltepush.enabled` in the Android manifest, or no `SveltePushEnabled` in `Info.plist`): prebuild again. |

The doctor can't run `app.config.ts`. It finds the Google services file the way it can: the one `app.json` names (`capabilities.push.android.googleServicesFile`, or `android.googleServicesFile`), else a `google-services*.json` in the app's directory, else the prebuild's copy in `android/app/`. When the config is code and there is no such file, the line is `????` (it couldn't tell) with the fix. With no `ios/` folder yet, the iOS checks are `skip`.

### doctor --server

```sh
pnpm exec svelte-native doctor --server [--app <bundle id>] [--json]
```

Checks the push sender's environment on the machine you run it on, which is normally the server (or a shell with the server's variables). It checks only that, not the app: run it without `--server` for the app. It reads the variables `createPush` is given in the guide's example, and then makes one real request to each provider you've set up:

| Variable | What it is |
| --- | --- |
| `FCM_SERVICE_ACCOUNT` | The service account key's JSON, or the path of its file. It needs `project_id`, `client_email` and an RSA `private_key`. |
| `APNS_KEY` | The `.p8` key's PEM, or the path of its file. A PEM with its line breaks written as `\n` is accepted. It must be a P-256 key. |
| `APNS_KEY_ID` | The key's id: 10 letters and digits. |
| `APNS_TEAM_ID` | The Apple Developer team's id: 10 letters and digits. |
| `FCM_BASE_URL`, `FCM_TOKEN_URL`, `APNS_PRODUCTION_URL`, `APNS_SANDBOX_URL` | Optional. Replace the provider's endpoint, as the sender's `baseUrl`, `tokenUrl`, `productionUrl` and `sandboxUrl` options do (tests and proxies). |

```
svelte-native doctor --server

push server
  pass  FCM_SERVICE_ACCOUNT is a service account key for project my-app (push@my-app.iam.gserviceaccount.com) with a private key that loads as RSA
        read from the variable's text
  pass  oauth2.googleapis.com gave an access token for push@my-app.iam.gserviceaccount.com (valid 3599 s): Google accepts the key
  pass  APNS_KEY loads as a P-256 key; key id ABC123DEFG, team id TEAM123456
        read from the variable's text
  pass  api.sandbox.push.apple.com accepted the credentials: it signed in the provider token and then answered BadDeviceToken to a device token that cannot exist
```

- **FCM:** the variable must parse as a service account key and its private key must load. Then the doctor makes the OAuth token request that every send starts with, to the key's `token_uri`. Google's refusal says why: `invalid_grant` is a key that was deleted or disabled, a service account that is gone, or a clock that is off, and the fix names which.
- **APNs:** the three variables must be set together and the key must load as an ES256 key. APNs has no token endpoint, so the doctor signs a provider token and sends one request to the sandbox host (`api.sandbox.push.apple.com`) with a device token that can't exist. `BadDeviceToken` means APNs accepted the credentials (it read the provider token before it judged the device). `InvalidProviderToken`, `ExpiredProviderToken` and the other 403s mean it didn't, and the fix says what to check. Nothing is delivered.
- `--app` is the app's bundle id, which is the request's APNs topic. Without it the topic is a placeholder, and if APNs answers `TopicDisallowed` or `BadTopic` the line is `????`, because it didn't get as far as the credentials. With `--app`, the same answer is a failure.
- A provider whose variables are unset is `skip`. If neither is set, the doctor fails: a server that can't send is not fine. A provider that can't be reached is a failure. A rate limit is `????`.
- A variable that is a path loads, but the sender in your server's code takes the contents, not the path (`createPush({ fcm: { serviceAccount: env.FCM_SERVICE_ACCOUNT } })`). The line says so: the server's own variable must hold the text.
- Nothing is written, and no key or token is printed in full. A line names a project, an email, an id or a host, and a variable that doesn't load is named, never quoted.

The exit status is 1 when a check failed, and 2 for an argument it doesn't know. `--json` prints `{ ok, server: true, checks }`.

## push

```sh
pnpm exec svelte-native push send --token <token> [options]
```

Sends one message to one device with the server's credentials, to try a device before the server's own code does it. It's `createPush(...).send(...)` from `@alfayez/svelte-native/push/server` and nothing else, and it prints what the provider answered. It needs no routes, and writes nothing into the app. Run it from any directory, with the variables of `doctor --server` set (the sender's endpoints included).

```sh
export FCM_SERVICE_ACCOUNT=./secrets/firebase-service-account.json
svelte-native push send --token '{"provider":"fcm","token":"…","app":"dev.example.app"}' \
  --title "Order ready" --body "Pickup at gate 3" --url /orders/42
```

```
sent to fcm (dev.example.app): 0:1700000000%31bd1c96
```

The credentials come from the environment and never from the command line, so no key lands in a shell history. An FCM token needs `FCM_SERVICE_ACCOUNT`; an APNs token needs `APNS_KEY`, `APNS_KEY_ID` and `APNS_TEAM_ID`. They're read as `doctor --server` reads them, a path or the text. The variables of the other provider aren't looked at.

| Option | Description |
| --- | --- |
| `--token <token>` | The device. Either the JSON of a `PushToken` exactly as `push.subscribe`'s `save` received it, or a raw token string with the three options below. |
| `--provider fcm\|apns` | A raw token's provider. |
| `--app <id>` | A raw token's app: the Android package, or the iOS bundle id (the APNs topic). |
| `--environment development\|production` | A raw APNs token's environment, which picks the APNs host. It's needed for an APNs token: the other host answers `BadDeviceToken`. |
| `--title <text>`, `--body <text>` | The notification's text. It needs one of them, unless it is `--silent`. |
| `--url <link>` | The link a tap opens: a path of the app (`/orders/42`) or a full link. |
| `--data <key=value>` | A data entry. Repeat it for more. Strings only. |
| `--silent` | A data message: nothing is shown, the app's `background` hook gets it. It takes no title, body, badge, sound or channel. |
| `--badge <n>` | iOS: the badge number. |
| `--sound default\|none` | `none` sends no sound. |
| `--channel <id>` | Android: the notification channel's id. |
| `--collapse-key <key>` | A newer message with the same key replaces the older one. |
| `--priority high\|normal` | The provider's priority. |
| `--ttl <seconds>` | How long the provider keeps the message for a device that is offline. |
| `--json` | Print the result as JSON: `{ "ok": true, "id": … }`, or `{ "ok": false, "reason": …, "detail": …, "status": … }`. |

A flag takes its value as `--title "Order ready"` or `--title="Order ready"`; a value that starts with `--` needs the second form.

On a failure it prints the result's `reason` and `detail` with what to do about it (`gone`: delete the token; `auth`: run `doctor --server`; `rate-limited`: when to retry). The reasons are the sender's.

| Exit status | Meaning |
| --- | --- |
| 0 | The provider accepted the message. |
| 1 | The provider didn't: the result's `reason` says why (`gone`, `invalid-token`, `invalid-message`, `rate-limited`, `unavailable`, `auth` or `error`). |
| 2 | Nothing was sent, because the command or its environment isn't usable: an argument is wrong, the sender refuses the message (a notification with neither title nor body, a `--silent` message with a title, `url` also given in `--data`), or the credentials aren't set or don't load. |

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

## css

```sh
pnpm exec svelte-native css src/global.css
```

Compiles the CSS file the way Metro's `css` option does (Tailwind 4, then React Native styles) and writes the class table to `.svelte-native/classes.<variant>.ts`. Metro already runs it when it starts and when a file changes, so you need it only to see what a file compiles to.

| Option | What it does |
| --- | --- |
| `--variant <name>` | The variant to write the table for (`APP_VARIANT`; `app` when unset). |
| `--json` | Print what happened as JSON: the file written, whether it changed, the classes that aren't supported and the stylesheets read. The file is written either way. |

