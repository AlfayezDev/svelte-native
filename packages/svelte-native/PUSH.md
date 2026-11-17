# Push notifications: design

Status: proposed, 17 November 2026, for review before any code. The plan it belongs to is at the end ("Phases").

## The model

Svelte Native push is a direct line to Google and Apple. The app's developer brings their own Firebase project and Apple key; Svelte Native does the device's side (permission, token, receiving, showing, taps, background messages) and gives the server a sender that talks to Firebase Cloud Messaging (FCM) and the Apple Push Notification service (APNs) itself. Nothing passes through a service of ours or of Expo's.

What it does not do is the infrastructure around a send. The sender sends one message to one device and says what happened; the queue, the retries, where the tokens are kept, fan-out to many devices and the providers' rate limits are the app's own ("What the app owns" below). An app that would rather hand all of that to a service uses `expo-notifications` and Expo's push service instead, and not this. One app has one push library ("One push library per app").

Three rules shape the rest:

1. **A tapped notification is a link.** Its `url` opens a screen the way any link to the app does, from a cold start or a running app, through the router's existing link path: `Linking.getInitialURL()` answers with the launch message's link, and a tap while the app runs reaches the `url` listeners. Nothing new to learn, and the router does not change. A path (`/orders/42`) becomes `https://app.invalid/orders/42`, which the router reads by its path (an app that reads `Linking` itself sees that host); a full link is kept as it is.
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

and the native package, from the same tag as the library (see "Packages"):

```sh
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native-push"
```

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

- `push.permission` is `"granted"`, `"denied"` or `"prompt"`, reactive, and read again when the app returns to the foreground (the user may change it in the settings). It starts from the last value the system reported (kept in `localStorage`), so a user who already answered never sees `"prompt"` for a moment; only an app that has never asked starts at `"prompt"`.
- `push.subscribe({ save })` asks for the permission when it is `"prompt"`, registers with FCM or APNs, and calls `save(token)` with a `PushToken`. Call it on every start where the user is signed in: it asks only once, and it calls `save` when the token is new, changed since the last successful `save`, or rotated by the system while the app runs. It resolves with the token, or `null` when the permission is denied, and rejects with `save`'s error when `save` fails (the token is then not remembered, so the next `subscribe` saves again).
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

The hooks run where `init` runs, in a launch without a screen too, and wait for `init` to settle. The foreground hook has 900 ms to answer; one that throws or takes longer gets the default. Android gives a background message about 20 seconds; the native side waits for `background`'s promise on FCM's worker thread for at most 18 s and then lets the process go. iOS gives about 30 seconds (the native side calls the system's completion at 25 s at most) and decides itself how often to wake an app for silent pushes (it delays and drops them as it sees fit); `background` is for keeping data fresh, never for anything that must happen.

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

`send(token, message)` sends one message to one device and resolves with what happened. It never queues or retries (but for one APNs re-sign, below), each request to a provider waits at most `timeout` (a first FCM send makes two: the access token, then the message), and it never throws for a provider's answer. It throws a `TypeError` only for a programming error: a token or message that is not of the type, a notification with neither `title` nor `body`, a `silent` message with `title`, `body`, `badge`, `sound` or `channel`, `url` also given in `data`, a `data.aps` or a collapse id that is not printable ASCII without spaces on APNs (`order 42` is one), or a send to a provider that is not configured.

- A provider with none of its options set (SvelteKit's `env.X` may be `undefined`) is not configured: the module loads without secrets, and the first send to it throws. A provider that is set but wrong (JSON that does not parse, a key of the wrong type or curve, two of the three APNs values) throws at `createPush`, without quoting the secret. A `.p8` with literal `\n` is accepted.
- `close()` waits for the sends in flight and ends the APNs connections; a send after it is `unavailable`.
- `timeout` (default 30 s) makes a provider that does not answer `unavailable` and drops its connection.
- `fcm.baseUrl`, `fcm.tokenUrl`, `apns.productionUrl` and `apns.sandboxUrl` replace the endpoints (tests, proxies).
- The one retry it does make is its own: APNs's `ExpiredProviderToken` is answered by signing a new provider token and sending once more (only when the current one is at least 20 minutes old). A 401 from FCM drops the cached access token so that the next send gets a new one.
- `gone` and `invalid-token` tell the app to delete a token, so only the provider's own word decides them: FCM's `UNREGISTERED`, APNs's `Unregistered` and `ExpiredToken` (410), `BadDeviceToken` and `DeviceTokenNotForTopic`. A bare 404 or 410 is `error` (a wrong `project_id` answers 404 too). FCM's `SENDER_ID_MISMATCH` is `auth`, not `invalid-token`: it is what every token answers when the server has another Firebase project's credentials, and a device does not save an unchanged token again, so deleting on it would silence every Android device until its token rotates. APNs's `IdleTimeout` (400) is `unavailable`: a new connection takes the same request.
- `sound: null` sends no sound; a `silent` message goes to APNs at priority 5 whatever `priority` says.

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
- **Tokens.** Store them per user and device, upsert on every `save`, and delete on `gone` and on sign-out. Do not prune by the date of the last `save`: `subscribe` calls `save` only for a new or rotated token, so a device in daily use may not have saved for months.
- **Fan-out.** Sending to many devices is many `send`s; run them concurrently with a limit (one HTTP/2 connection carries many). FCM topics and APNs broadcast are out of v1.
- **Rate limits.** FCM and APNs throttle a sender that sends too much too fast, and a device that gets too many messages.
- **Idempotency.** A retried job may send twice. On iOS, `collapseKey` (`apns-collapse-id`) shows the two as one; on Android it only keeps an older copy that is not delivered yet from being delivered, and a notification already shown stays. Where showing a message twice matters, give it an id in `data` that the app checks.
- **Watching it.** Log every result's `reason`; a rise in `auth` or `invalid-message` is a bug, not noise.

## Packages and native code

- **`@alfayez/svelte-native-push`** (new, `packages/svelte-native-push`): the native code only, an Expo module `SveltePush`. Android on Firebase Messaging, iOS on APNs and `UNUserNotificationCenter`. It is a package of its own so that Firebase is in the build of the apps that use push and of no other app, and so that installing it is what links it, as for any native library. It is released with `@alfayez/svelte-native`, at the same version.
- **`@alfayez/svelte-native/push`**: the API above (`push`, `PushHooks`, the types), in the main package, because it works with the router and the hooks. Without the native package installed, `push` exists and `push.permission` reads `"denied"`, with one warning that says what to install. The library's Metro config bundles a stand-in of a few lines in the client's place then (`push/absent.ts`), so an app without push carries none of its code.
- **`@alfayez/svelte-native/push/server`**: the sender, in the main package, for Node (no native code, nothing it imports runs on the device).

### The native module's contract

What the JavaScript side calls, the same on both platforms:

| Call or event | What it does |
| --- | --- |
| `permission(): Promise<"granted" \| "denied" \| "prompt">` | the system's state, without asking |
| `requestPermission(): Promise<…>` | asks (Android 13+: `POST_NOTIFICATIONS`; iOS: alert, sound, badge) |
| `register(): Promise<PushToken>` | FCM's token / APNs's device token, as hex |
| `unregister(): Promise<void>` | `FirebaseMessaging.deleteToken()` / `unregisterForRemoteNotifications()` |
| `show(message, { banner, sound, badge }): Promise<void>` | the foreground hook's answer for a `message` event: `message` is that event's payload, matched by `message.id`; all three booleans are given (JavaScript fills the defaults, `true`). Android shows the notification; iOS answers `willPresent`. Idempotent per id. JavaScript answers within 900 ms |
| `takeLaunchMessage(): PushMessage \| null` (synchronous) | the message whose tap launched the screen. JavaScript calls it once per root router, at that router's first `Linking.getInitialURL()` (its mount), not at start: until that call a tap is the launch message, after it a tap is an `opened` event; it answers `null` when no tap launched that router. So a process that started without a screen (a background message) and shows it later still opens the tap's link, and so does an Android Activity made again while JavaScript lives (a new surface, a new root router). A tap that arrives as `opened` while no router has read yet is held by JavaScript, after its `opened` hook, and is the next router's launch; the platform's link still wins |
| `backgroundDone(id: string): void` (synchronous) | the background hook settled (or threw, or there is none): let the process go |
| event `token`: `PushToken` | the provider rotated the token |
| event `message`: `PushMessage` | a message in the foreground, before it shows: the native side waits for `show` at most 1 s, then shows it with all three `true` |
| event `opened`: `PushMessage` | a tap with the app running |
| event `background`: `{ id, message: PushMessage }` | a data message in the background; `id` is a completion id of the native side's (not `message.id`). The native side holds the process until `backgroundDone(id)` or its limit |

The native side keeps the events that come before JavaScript listens (a message that started the process) and delivers them when the first listener is added; JavaScript adds all four at start. The JavaScript side is loaded at start when the build has the native module (`requireOptionalNativeModule("SveltePush")`) or the hooks export `push`; an app without the package pays nothing.

### Android

- `SveltePushMessagingService` (a `FirebaseMessagingService`) in the native package's own manifest (the app's, merged). `onNewToken` emits `token`; `onMessageReceived` emits `message` in the foreground or `background` otherwise, and waits for the hook (18 s at most) on FCM's worker thread, which keeps the process alive meanwhile. A notification message that Firebase hands to `onMessageReceived` while this side finds the app away (Firebase's own check is a little different) is shown at once, and runs no hook.
- **Foreground** is decided by the count of started Activities of the process (`Application.ActivityLifecycleCallbacks`, registered at `Application.onCreate`), with a one second gap for an Activity that is made again (a rotation). It is exact from the first Activity and zero in a process a message started. `ProcessLifecycleOwner` would say the same and need a library of its own.
- A process started by a message has no Activity, so no surface starts and no screen mounts: rule 2 holds already (the React host starts from `Application.onCreate`, and `init` runs). The events that come before JavaScript exists (Expo registers its modules lazily, so even the module may not) belong to the process, not to the module: they are kept, at most 64 a name, and delivered in order when the first listener of the name is added; only the newest `token` is kept.
- A notification the system shows (the app in the background) puts the message's `data` and Firebase's `google.message_id` in the launch intent's extras; one the module shows itself carries the whole message in its `PendingIntent`. Firebase removes the notification's own title and body from those extras, so a tap on a notification the system showed has an `id`, a `url` and `data`, and no `title` or `body`. Expo's `ReactActivityLifecycleListener` (`SveltePushPackage`, which autolinking finds by its name and its `Package` import; the app's `MainActivity` delegate wrapper calls it) reads the extras in `onCreate` and `onNewIntent`: the launch message for `takeLaunchMessage`, or `opened`. The process's `ActivityLifecycleCallbacks` reads the creation intent too, inside `Activity.onCreate` and before React's delegate starts the surface, so that a cold start's tap is the launch message before JavaScript can ask for it; the second read of it is refused (below). A tap is delivered once: an Activity that is made again or restored, and an intent that is read again, are told apart by the message id, kept in a small ledger in `SharedPreferences`.
- A tap's extras are not authenticated: the launcher Activity is exported, so another app (or `adb`) can start it with the extras a tap carries, and the `opened` hook gets that message. Its `url` can only reach the router, which opens routes of the app; the guide tells apps to treat `opened` as untrusted input. Firebase hands `onMessageReceived` one message at a time on its worker thread, so a background hook that runs long delays the next message, whose own time limit is already running.
- A notification the module shows in the foreground goes to the channel its message names (FCM's `channel_id`) when the app has that channel, else to the default one, as the system does with the app in the background. An intent whose extras cannot be read (a Parcelable of another app's) is ignored, never a crash in `onCreate`, and a message id with a line break is no id.
- Known limit: while Expo delays `loadApp` (expo-updates, the development launcher), its delegate wrapper calls no `onNewIntent` listener, so a tap (and a deep link: React Native's `url` event is skipped the same way) that arrives by `onNewIntent` in that window is lost. `Activity.getIntent()` keeps the creation intent, so it cannot be read again later; a fix needs `setIntent` in `MainActivity`.
- The default channel is made from the config's `channel` before anything needs it: when the permission is asked for (Android 13 asks only an app that has a channel), at the first `register`, when a notification is shown, and when Firebase's service starts (a notification the system shows goes to the manifest's channel, which has to exist by then). Its importance is high, so a notification is a banner with a sound; the small icon and color are the manifest's `com.google.firebase.messaging.default_notification_icon` and `_color`.

### iOS

- An `ExpoAppDelegateSubscriber` forwards `didRegisterForRemoteNotificationsWithDeviceToken` / `didFailToRegister…` and `didReceiveRemoteNotification:fetchCompletionHandler:` (silent pushes, with the completion called from `backgroundDone` or at 25 s).
- The module becomes `UNUserNotificationCenter`'s delegate in `didFinishLaunching`, so it sees the tap that launched the app: `willPresent` asks the foreground hook, `didReceive response` is the launch message or `opened`.
- **Rule 2 on iOS** is the open part of the design. An app the system launches for a silent push is in the background, but Expo's `AppDelegate` creates the window and starts React Native's surface at once, so the first screen mounts. The fix: when `applicationState` is `background` at launch, start the React host (JavaScript runs, the hooks see the message) and start the surface at the first `didBecomeActive`. It touches the `AppDelegate` the config plugin already edits (`applyAppDelegate`), and it helps any library's background launch, not only this one's. Phase 3 proves it on the simulator before anything depends on it.
- What the deferred surface means for the rest of the app, found in phase 3:
  - **A link that brings the app to the foreground** before the first screen exists (a universal link, the app's scheme) is a `url` event with no router to hear it, and React Native drops it; `getInitialURL` answers the process's launch, which had none. The push client listens from its start and keeps the last such link until the router's first read, which answers it (`client.ts`, `#feedLinking`; the tests are in `tests/push/client.test.ts` and `router.test.ts`).
  - **The splash screen:** an app that calls `SplashScreen.preventAutoHideAsync()` and then `hideAsync()` from `init` can leave the splash up after a background launch, because `init` ran with no screen and the hide was spent before the surface existed. Hide it from the first screen (`+layout.mobile.svelte`), not from `init`. Not fixed in v1; the guide says so.
  - **The scene-based template** (Expo's iOS 27 template moves `startReactNative` into `ExpoAppSceneDelegate`): `applyPushAppDelegate` finds no call to wrap and stops the prebuild with an error that says so. Supporting it is a follow-up when the template ships.

## The config plugin

`capabilities.push`, beside `location`, following the same rule: on without its library, or its library installed while off, stops the prebuild.

- **Android:** sets the config's `android.googleServicesFile`, so that Expo's own prebuild copies the file into `android/app` and applies the `com.google.gms.google-services` Gradle plugin; copies the icon into `res/drawable` and the color into a color resource, with the manifest's `com.google.firebase.messaging.default_notification_icon` and `_color`; writes the channel (`{ id?, name, description? }`, default id `default` and name `Notifications`) as meta-data of ours and as `default_notification_channel_id` (else the notifications the system shows go to Firebase's "Miscellaneous" channel). The messaging service and `POST_NOTIFICATIONS` are static, so they are in the native package's own manifest (Firebase's own service is at priority -500; ours, at the default 0, gets the messages).
- **iOS:** the `aps-environment` entitlement from `mode`, and `remote-notification` in `UIBackgroundModes`.
- **It refuses** (each with a message that says what to do):
  - `push` on without `@alfayez/svelte-native-push` installed, or left out of autolinking, or the package installed with `push` off;
  - `expo-notifications` or `@react-native-firebase/messaging` installed beside it (Android delivers to one `FirebaseMessagingService`, iOS has one notification center delegate);
  - a `googleServicesFile` that is missing, or has no client for the app's `android.package`;
  - anything in the config or in the Google services file that is a server secret: a service account (`"type": "service_account"`, a `private_key`), a PEM private key, or a `.p8` file;
  - and the malformed: `push` naming no platform, `android` without `googleServicesFile`, no `android.package`, an icon that is not a PNG or is missing, a color that is not `#RGB`, `#ARGB`, `#RRGGBB` or `#AARRGGBB`, a channel without a name, an invalid `ios.mode`, and the app's own `android.googleServicesFile` or `aps-environment` saying something different from `push`.

## `svelte-native doctor`

The existing `doctor` gains a push section, shown when the app has push (the package is a dependency or installed, or `app.json` turns `capabilities.push` on). It reads files and runs nothing: the package and its version against the library's, a second push library, `capabilities.push` in `app.json` (when there is no `app.config.*` it cannot run), the Google services file (found from `app.json`, else `google-services*.json` in the app's directory or `android/app/`: it parses, holds no server secret, and has a client for `android.package` or the Gradle `applicationId`), and after a prebuild the `aps-environment` entitlement and the `remote-notification` background mode. It does not judge the signing team (a Personal Team cannot carry the entitlement): that needs the provisioning profile, and Xcode refuses the signing anyway. `doctor --server` checks the server's environment instead: `FCM_SERVICE_ACCOUNT` (the key's JSON or its file's path), `APNS_KEY` (the PEM or the `.p8`'s path), `APNS_KEY_ID` and `APNS_TEAM_ID` parse and load, then one token exchange with Google and one request to APNs's sandbox host with a device token that cannot exist (`BadDeviceToken` is a key APNs accepted, 403 one it refused). And `svelte-native push send --token <token> --title … --url …` sends one message with the same variables, for trying a device; `--token` is the `PushToken` JSON that `save` received, or a raw token with `--provider`, `--app` and, for APNs, `--environment`. Exit 0 sent, 1 refused by the provider, 2 bad arguments or credentials.

## Testing

- **Unit:** the config transforms and every refusal; the JavaScript API against a stand-in of the native module (as the geolocation tests do); the sender against local mock servers (APNs over cleartext HTTP/2, FCM and Google's token endpoint over HTTP/1.1), every `reason` included, and the package test that installs the packed library and sends with plain Node.
- **Native host checks:** the Kotlin parts that need no device (the extras ↔ message mapping, the launch message and `opened`, the de-duplication of taps, the kept events, the background wait with its limit, the foreground wait for `show`), `packages/svelte-native-push/android/src/test/push.sh`, run by the engine-host job of CI; it also reads the module, the manifest and the config plugin against `src/push/client.ts`.
- **Devices** (`native-qa push`, gates `push.*` in `gates.json`): the harness sends through the sender with the test project's credentials and checks the token reaches `save`, a foreground message, a background data message running the hook with no screen mounted, a tap from a killed app opening the route, a tap from a running app, a token rotation, and the denied path. On the OVH emulator (its image has Google Play services) and the Samsung A16. The killed-app tap is informational on the Samsung (its battery management may hold a message for an app the user swiped away), and the background message is informational on iOS.
- **iOS:** the simulator, until the QA app is signed with a paid team. `xcrun simctl push` delivers an alert to a running app, which covers the delegate, the event, the mapping, the foreground hook and the presentation answer (checked 17 November: the example app with push on, Release, iPhone 17 simulator, iOS 26.5: the foreground hook received the title, body, `url` and data). The simulator does not deliver a silent push, neither to an app in the background nor by launching one that is not running, so the background hook and rule 2 on iOS are checked on a device only: the iPhone's `push.*` gates read "not measured" until then.

## Not in v1

Scheduled local notifications (v1 shows a notification now, which it needs for the foreground, but schedules nothing), action buttons and categories, images (an iOS notification service extension), FCM topics, web push (the same `push.subscribe` on a `+page.svelte`, over the browser's Push API), Huawei phones without Google services (HMS), iOS provisional and critical alerts, Live Activities.

## Decisions

Taken (say if any should change):

1. Our own native package, not a wrapper of `expo-notifications`; `expo-notifications` stays the choice for apps that want Expo's service, and the two exclude each other.
2. iOS goes to APNs directly, without the Firebase SDK on iOS.
3. v1 shows notifications and does not schedule them.
4. The sender is in the library; the infrastructure around it is the app's, and the guide says so.
5. A message in the foreground is shown (banner, sound and badge) unless the `foreground` hook says otherwise; iOS's own default is not to show it.

Open:

1. The native package's name: `@alfayez/svelte-native-push`.

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
