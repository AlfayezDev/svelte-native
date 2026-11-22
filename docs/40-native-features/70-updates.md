---
title: Updates
video: updates
---

An over-the-air update replaces your app's JavaScript without a new build from the store. Expo Svelte has its own updates client, `expo-svelte/updates`, which speaks the same protocol as `expo-updates`. You publish with `eas update` as you would for any Expo app, and an installed release build downloads the update.

An update can change JavaScript and assets only. A change to native code (a new library, a plugin, a new version of Expo Svelte) needs a new build.

## Setting up

Updates are configured in the app config, with the same keys `expo-updates` uses. `eas update:configure` writes them for you:

```ts
/// file: app.config.ts
export default {
	expo: {
		// ...
		runtimeVersion: { policy: 'appVersion' },
		updates: {
			url: 'https://u.expo.dev/<your EAS project id>',
			checkAutomatically: 'ON_LOAD',
			fallbackToCacheTimeout: 0,
			requestHeaders: { 'expo-channel-name': 'production' }
		},
		extra: { eas: { projectId: '<your EAS project id>' } }
	}
};
```

- `url` is where the app asks for updates.
- `runtimeVersion` names the native build an update is for: an update only reaches builds with the same runtime version.
- `requestHeaders['expo-channel-name']` is the build's channel. A build only gets updates published to its channel.
- `checkAutomatically: 'ON_LOAD'` checks at every start. `'NEVER'` leaves checking to your code.

Then prebuild and make a release build. Publish an update to the channel:

```sh
eas update --channel production --message "Fix the settings screen"
```

Development builds never check for updates: they load JavaScript from Metro. A build without `updates.url` or a runtime version doesn't either.

## What happens at launch

With `checkAutomatically: 'ON_LOAD'`, a release build asks the server once, shortly after its first screen appears. If there's a newer update, it downloads it in the background, and the app keeps running its current JavaScript. The update runs from the next start. So after you publish, the first start downloads the update and the second runs it.

An update can be bad. A start counts as healthy once the app has run for three seconds after its first screen without a fatal error. If an update crashes before that, the next start (on iOS, the second) marks it as failed and runs the previous update, or the JavaScript built into the app. The app won't download a failed update again. A start the user simply closes within those seconds isn't held against the update the first time.

## Checking from your code

To control when the app checks, use the module's functions. This checks, downloads and restarts into the new update at once:

```ts
import { checkForUpdateAsync, fetchUpdateAsync, isEnabled, reloadAsync } from 'expo-svelte/updates';

export async function updateNow() {
	if (!isEnabled) return;
	const check = await checkForUpdateAsync();
	if (!check.isAvailable) return;
	await fetchUpdateAsync();
	await reloadAsync();
}
```

Restarting while the user is in the middle of something is abrupt. A gentler pattern is to download in the background and apply the update the next time the app starts, which is what `checkAutomatically: 'ON_LOAD'` already does.

| Export | Description |
| --- | --- |
| `isEnabled` | Whether this build checks for updates. `false` in development builds and builds without updates configured. |
| `updateId` | The id of the update running now, or `null` for the JavaScript built into the app. |
| `channel` | The build's channel, or `null`. |
| `runtimeVersion` | The build's runtime version, or `null`. |
| `checkForUpdateAsync()` | Asks the server. Resolves with `{ isAvailable, manifest, isRollBackToEmbedded, reason }`; `reason` says why nothing is available (`noUpdateAvailableOnServer`, `updatePreviouslyFailed`, `updatesDisabled`, ...). |
| `fetchUpdateAsync()` | Downloads the newest update. Resolves with `{ isNew, manifest, isRollBackToEmbedded }`. The update runs from the next start. |
| `reloadAsync()` | Restarts the app's JavaScript now, on the newest downloaded update. |
| `checkOnLaunch()` | The check `checkAutomatically: 'ON_LOAD'` runs at launch: check and download, logging the outcome and never throwing. |

## Rolling back

`eas update:rollback` publishes a rollback for a channel. A build that receives it goes back to the JavaScript built into the app at its next start (`isRollBackToEmbedded` is `true`).

## Not supported

`checkAutomatically: 'WIFI_ONLY'` and `'ON_ERROR_RECOVERY'` don't check at launch; the functions above still work in those builds. The `expo-updates` package itself, and its React hooks, aren't used: import from `expo-svelte/updates` instead.
