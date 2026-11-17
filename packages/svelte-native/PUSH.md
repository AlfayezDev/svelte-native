# Push notifications: design

Status: proposed, 17 November 2026, for review before any code. The plan it belongs to is at the end ("Phases").

## The model

Svelte Native push is a direct line to Google and Apple. The app's developer brings their own Firebase project and Apple key; Svelte Native does the device's side (permission, token, receiving, showing, taps, background messages) and gives the server a sender that talks to Firebase Cloud Messaging (FCM) and the Apple Push Notification service (APNs) itself. Nothing passes through a service of ours or of Expo's.

What it does not do is the infrastructure around a send. The sender sends one message to one device and says what happened; the queue, the retries, where the tokens are kept, fan-out to many devices and the providers' rate limits are the app's own ("What the app owns" below). An app that would rather hand all of that to a service uses `expo-notifications` and Expo's push service instead, and not this. One app has one push library ("One push library per app").

Three rules shape the rest:

1. **A tapped notification is a link.** Its `url` opens a screen the way any link to the app does, from a cold start or a running app, through the router's existing link path. Nothing new to learn, and the router does not change.
2. **A push that wakes the app mounts no screen.** The background hook and `init` run; the first screen waits until the user opens the app.
3. **Secrets never go in the app.** The app's config holds identifiers only. The keys that can send to every user (the FCM service account, the APNs key) live in the server's environment, and the config plugin refuses a build that contains one.

## What the developer does

### Once: the accounts

- **Android:** a Firebase project with the app's Android package added; its `google-services.json` goes in the app's repository (it holds identifiers, not secrets). For the server, a service account key with the "Firebase Cloud Messaging API Admin" role, kept in the server's secrets.
- **iOS:** a paid Apple Developer team (a Personal Team cannot sign the push entitlement), an APNs authentication key (`.p8`, with its key id and the team id) for the server. No Firebase on iOS: iOS goes to APNs directly.
- `svelte-native doctor` says what is missing (below).

### The config

```ts
// app.config.ts
plugins: [["@alfayez/svelte-native", {
  capabilities: {
    push: {
      android: { googleServicesFile: "./google-services.json", icon: "./assets/notify.png", color: "#0a7f5a", channel: { name: "Updates" } },
      ios: { mode: "production" }, // the aps-environment entitlement: "development" for builds signed for development
    },
  },
}]]
```

and the native package: `npx expo install @alfayez/svelte-native-push` (see "Packages").

### Turning it on

```svelte
<script lang="ts">
  import { push } from "@alfayez/svelte-native/push";
  import { savePushToken } from "./push.remote"; // a remote function of the app's: stores the token for the signed-in user
</script>

{#if push.permission === "prompt"}
  <Button onPress={() => push.subscribe({ save: savePushToken })}>Turn on notifications</Button>
{/if}
```

- `push.permission` is `"granted"`, `"denied"` or `"prompt"`, reactive, and read again when the app returns to the foreground (the user may change it in the settings).
- `push.subscribe({ save })` asks for the permission when it is `"prompt"`, registers with FCM or APNs, and calls `save(token)` with a `PushToken`. Call it on every start where the user is signed in: it asks only once, and it calls `save` when the token is new, changed since the last successful `save`, or rotated by the system while the app runs. It resolves with the token, or `null` when the permission is denied.
- `push.unsubscribe()` deletes the device's token with the provider and forgets the saved one (sign-out). The app removes it from its server.
- `push.token` is the current `PushToken` or `null`.
- `push.on("message", (message) => …)` in a component: the messages that arrive while the app is in the foreground (after the foreground hook decided how to show them), for example to refresh a list. It returns the function that stops listening, so `$effect(() => push.on("message", refresh))` works.

```ts
type PushToken = {
  provider: "fcm" | "apns";
  token: string;
  /** APNs only: which APNs the token belongs to, from the build's entitlement. The sender picks the endpoint with it. */
  environment?: "development" | "production";
  /** The app's package (Android) or bundle id (iOS): the APNs topic, and a check that a token goes to the right project. */
  app: string;
};
```

### Receiving: `src/hooks.mobile.ts`

```ts
import type { PushHooks } from "@alfayez/svelte-native/push";

export const push: PushHooks = {
  /** A message while the app is in the foreground: how to show it. The default shows it as when the app is in the background. */
  foreground: (message) => ({ banner: true, sound: true }),
  /** A data message (`silent`) with the app in the background or not running. No screen is mounted. */
  background: async (message) => { await syncInbox(message.data.inbox); },
  /** A notification was tapped. Return `false` to stop its `url` from opening; the default opens it. */
  opened: (message) => {},
};
```

```ts
type PushMessage = {
  id: string;
  title?: string;
  body?: string;
  /** The link a tap opens: a path of the app ("/orders/42") or a full link ("myapp://orders/42", or an https link the app handles). */
  url?: string;
  /** The sender's `data`: strings only, as both providers carry them. */
  data: Record<string, string>;
  provider: "fcm" | "apns";
};
```

The hooks run where `init` runs: in a launch without a screen too. Android gives a background message about 20 seconds; the native side waits for `background`'s promise on FCM's worker thread for at most 18 s and then lets the process go. iOS gives 30 seconds and decides itself how often to wake an app for silent pushes (it delays and drops them as it sees fit); `background` is for keeping data fresh, never for anything that must happen.

### Sending: the server

```ts
// src/lib/server/push.ts (SvelteKit, Node)
import { createPush } from "@alfayez/svelte-native/push/server";
import { env } from "$env/dynamic/private";

export const push = createPush({
  fcm: { serviceAccount: env.FCM_SERVICE_ACCOUNT },                                   // the key's JSON
  apns: { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID },      // the .p8's contents
});

const result = await push.send(token, { title: "Order ready", body: "Pickup at gate 3", url: "/orders/42" });
if (!result.ok && result.reason === "gone") await deleteToken(token);
```

`send(token, message)` sends one message to one device and resolves with what happened. It never queues, retries or waits; it never throws for a provider's answer (only for a programming error: a token or message that is not of the type).

```ts
type PushSend = {
  title?: string;
  body?: string;
  url?: string;
  data?: Record<string, string>;
  /** A data message: no notification is shown; the app's `background` hook gets it (see the limits above). */
  silent?: boolean;
  badge?: number;              // iOS
  sound?: "default" | null;    // default "default" for a notification
  channel?: string;            // Android: the channel id (default: the config's channel)
  collapseKey?: string;        // a newer message with the same key replaces the older one
  priority?: "high" | "normal";
  ttl?: number;                // seconds the provider keeps it for a device that is offline
};

type SendResult =
  | { ok: true; id: string }
  | {
      ok: false;
      /**
       * gone: the token will never work again (uninstalled, expired, unregistered): delete it.
       * invalid-token / invalid-message: a fault of the request; do not retry it as it is.
       * rate-limited / unavailable: try again later, after `retryAfter` when the provider gave one.
       * auth: the server's credentials are wrong or revoked.
       */
      reason: "gone" | "invalid-token" | "invalid-message" | "rate-limited" | "unavailable" | "auth" | "error";
      retryAfter?: number; // milliseconds
      status?: number;
      detail: string;
    };
```

How it talks to the providers, with nothing but Node's own `crypto` and `http2` (no dependencies):

- **FCM:** HTTP v1 (`POST https://fcm.googleapis.com/v1/projects/<project>/messages:send`). An OAuth access token from the service account (an RS256 JWT exchanged at Google's token endpoint), cached until shortly before it expires.
- **APNs:** HTTP/2 to `api.push.apple.com`, or `api.sandbox.push.apple.com` for a token whose `environment` is `development`. An ES256 provider token signed with the `.p8`, renewed every 50 minutes (Apple refuses tokens older than an hour, and renewing more often than every 20 minutes). One connection per endpoint, reused for every send.

How a message maps:

| `PushSend` | FCM (Android) | APNs |
| --- | --- | --- |
| `title`, `body` | `android.notification` | `aps.alert` |
| `url`, `data` | `data` (`url` among them) | custom keys beside `aps` |
| `silent` | data only, no `notification` | `aps.content-available: 1`, `apns-push-type: background`, priority 5 |
| `badge` | not sent (Android has no reliable count) | `aps.badge` |
| `sound` | `android.notification.sound` | `aps.sound` |
| `channel` | `android.notification.channel_id` | not sent |
| `collapseKey` | `android.collapse_key` | `apns-collapse-id` |
| `priority` | `android.priority` `HIGH` / `NORMAL` | `apns-priority` 10 / 5 |
| `ttl` | `android.ttl` | `apns-expiration` |

## What the app owns

The guide's page says this first, with a reference recipe:

- **A queue.** Send from a job, not from the request that caused it: a send can take seconds or fail, and the user's request should not wait for it or lose it.
- **Retries.** On `rate-limited` and `unavailable`, retry with backoff (and `retryAfter` when given), a bounded number of times. Never retry `invalid-*`, `auth` or `gone`.
- **Tokens.** Store them per user and device, upsert on every `save`, delete on `gone` and on sign-out, and prune the ones not saved for months.
- **Fan-out.** Sending to many devices is many `send`s; run them concurrently with a limit (one HTTP/2 connection carries many). FCM topics and APNs broadcast are out of v1.
- **Rate limits.** FCM and APNs throttle a sender that sends too much too fast, and a device that gets too many messages.
- **Idempotency.** A retried job may send twice; `collapseKey` makes the second replace the first instead of showing two.
- **Watching it.** Log every result's `reason`; a rise in `auth` or `invalid-message` is a bug, not noise.

## Packages and native code

- **`@alfayez/svelte-native-push`** (new, `packages/svelte-native-push`): the native code only, an Expo module `SveltePush`. Android on Firebase Messaging, iOS on APNs and `UNUserNotificationCenter`. It is a package of its own so that Firebase is in the build of the apps that use push and of no other app, and so that installing it is what links it, as for any native library. It is released with `@alfayez/svelte-native`, at the same version.
- **`@alfayez/svelte-native/push`**: the API above (`push`, `PushHooks`, the types), in the main package, because it works with the router and the hooks. Without the native package installed, `push` exists and `push.permission` reads `"denied"`, with one warning that says what to install.
- **`@alfayez/svelte-native/push/server`**: the sender, in the main package, for Node (no native code, nothing it imports runs on the device).

### The native module's contract

What the JavaScript side calls, the same on both platforms:

| Call or event | What it does |
| --- | --- |
| `permission(): Promise<"granted" \| "denied" \| "prompt">` | the system's state, without asking |
| `requestPermission(): Promise<…>` | asks (Android 13+: `POST_NOTIFICATIONS`; iOS: alert, sound, badge) |
| `register(): Promise<PushToken>` | FCM's token / APNs's device token, as hex |
| `unregister(): Promise<void>` | `FirebaseMessaging.deleteToken()` / `unregisterForRemoteNotifications()` |
| `show(message, presentation): Promise<void>` | shows a notification now (the foreground hook's answer on Android; iOS presents through `willPresent`) |
| `takeLaunchMessage(): PushMessage \| null` | the message whose tap launched the process, once |
| event `token` | the provider rotated the token |
| event `message` | a message in the foreground, before it shows (the native side waits for the foreground hook's answer, at most 1 s, then shows it by default) |
| event `opened` | a tap with the app running |
| event `background` with a completion id; `backgroundDone(id)` | a data message in the background; the native side holds the process until `backgroundDone` or its limit |

### Android

- `SveltePushMessagingService` (a `FirebaseMessagingService`) in the app's manifest, written by the config plugin. `onNewToken` emits `token`; `onMessageReceived` emits `message` in the foreground or `background` otherwise, and waits for the hook (18 s at most) on FCM's worker thread, which keeps the process alive meanwhile.
- A process started by a message has no Activity, so no surface starts and no screen mounts: rule 2 holds already (the React host starts from `Application.onCreate`, and `init` runs).
- A notification the system shows (the app in the background) puts the message's `data` in the launch intent's extras; one the module shows itself carries them in its `PendingIntent`. An Activity lifecycle listener (Expo's `ReactActivityLifecycleListener`, which `MainActivity`'s delegate wrapper still calls) reads the extras in `onCreate` and `onNewIntent`: the launch message for `takeLaunchMessage`, or `opened`.
- The default channel is made from the config's `channel` at the first `register`; the small icon and color are the manifest's `com.google.firebase.messaging.default_notification_icon` and `_color`.

### iOS

- An `ExpoAppDelegateSubscriber` forwards `didRegisterForRemoteNotificationsWithDeviceToken` / `didFailToRegister…` and `didReceiveRemoteNotification:fetchCompletionHandler:` (silent pushes, with the completion called from `backgroundDone` or at 25 s).
- The module becomes `UNUserNotificationCenter`'s delegate in `didFinishLaunching`, so it sees the tap that launched the app: `willPresent` asks the foreground hook, `didReceive response` is the launch message or `opened`.
- **Rule 2 on iOS** is the open part of the design. An app the system launches for a silent push is in the background, but Expo's `AppDelegate` creates the window and starts React Native's surface at once, so the first screen mounts. The fix: when `applicationState` is `background` at launch, start the React host (JavaScript runs, the hooks see the message) and start the surface at the first `didBecomeActive`. It touches the `AppDelegate` the config plugin already edits (`applyAppDelegate`), and it helps any library's background launch, not only this one's. Phase 3 proves it on the simulator before anything depends on it.

## The config plugin

`capabilities.push`, beside `location`, following the same rule: on without its library, or its library installed while off, stops the prebuild.

- **Android:** applies the `com.google.gms.google-services` Gradle plugin, copies `googleServicesFile` into `android/app`, declares the messaging service, writes the icon and color into the manifest and the `POST_NOTIFICATIONS` permission.
- **iOS:** the `aps-environment` entitlement from `mode`, and `remote-notification` in `UIBackgroundModes`.
- **It refuses** (each with a message that says what to do):
  - `push` on without `@alfayez/svelte-native-push` installed, or the package installed with `push` off;
  - `expo-notifications` or `@react-native-firebase/messaging` installed beside it (Android delivers to one `FirebaseMessagingService`, iOS has one notification center delegate);
  - a `googleServicesFile` that is missing, or has no client for the app's `android.package`;
  - anything in the config that is a server secret: a service account (`"type": "service_account"`, a `private_key`), a PEM private key, or a `.p8` file.

## `svelte-native doctor`

The existing `doctor` gains a push section: the Firebase file and its package; the entitlement in the last iOS build and whether its signing team can carry it (a Personal Team cannot); for the server, with `--server`, whether `FCM_SERVICE_ACCOUNT` and the APNs variables are set and parse, and one dry-run token request to each provider. And `svelte-native push send --token <token> --title … --url …` sends one message with the server's credentials, for trying a device.

## Testing

- **Unit:** the config transforms and every refusal; the JavaScript API against a stand-in of the native module (as the geolocation tests do); the sender against local mock FCM and APNs servers (HTTP/2), every `reason` included.
- **Native host checks:** the Kotlin parts that need no device (the extras ↔ message mapping, the background wait).
- **Devices** (`native-qa push`, gates `push.*` in `gates.json`): the harness sends through the sender with the test project's credentials and checks the token reaches `save`, a foreground message, a background data message running the hook with no screen mounted, a tap from a killed app opening the route, a tap from a running app, a token rotation, and the denied path. On the OVH emulator (its image has Google Play services) and the Samsung A16. The killed-app tap is informational on the Samsung (its battery management may hold a message for an app the user swiped away), and the background message is informational on iOS.
- **iOS:** the simulator (`xcrun simctl push` delivers a payload to the app: the hooks, taps and rule 2) until the QA app is signed with a paid team; then the same gates on the iPhone. Until then the iPhone's `push.*` gates read "not measured".

## Not in v1

Scheduled local notifications (v1 shows a notification now, which it needs for the foreground, but schedules nothing), action buttons and categories, images (an iOS notification service extension), FCM topics, web push (the same `push.subscribe` on a `+page.svelte`, over the browser's Push API), Huawei phones without Google services (HMS), iOS provisional and critical alerts, Live Activities.

## Decisions

Taken (say if any should change):

1. Our own native package, not a wrapper of `expo-notifications`; `expo-notifications` stays the choice for apps that want Expo's service, and the two exclude each other.
2. iOS goes to APNs directly, without the Firebase SDK on iOS.
3. v1 shows notifications and does not schedule them.
4. The sender is in the library; the infrastructure around it is the app's, and the guide says so.

Open:

1. The native package's name: `@alfayez/svelte-native-push`.
2. The default foreground presentation: shown (as written above), or not shown unless the hook says so (iOS's own default).

## Phases

One branch, `feat/push`, one pull request at the end, merged after the usual checks (OVH, emulator lane, consumer check) and a device round.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | This document | approved |
| 1 | The package skeleton and `capabilities.push` | unit tests for every transform and refusal |
| 2 | Android native | Kotlin host checks; a push received on the emulator |
| 3 | iOS native, rule 2 on iOS | builds; `simctl push` payloads handled on the simulator, a silent launch mounts no screen |
| 4 | `@alfayez/svelte-native/push` and the hooks | unit tests against the native stand-in |
| 5 | `@alfayez/svelte-native/push/server` | mock-provider tests; one real send to the test Firebase project |
| 6 | `native-qa push` and the `push.*` gates | green on the emulator and the Samsung |
| 7 | The guide page, `doctor`, `push send` | checked against the code |
| 8 | Changelog, pull request, checks, device round | merged |

Needed from the owner: a test Firebase project (its `google-services.json` for the QA app's package, and a service account key, kept in the secrets directory, never in the repository); for the iPhone, signing the QA app with the paid team and an APNs key.
