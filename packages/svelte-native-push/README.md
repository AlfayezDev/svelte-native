# @alfayez/svelte-native-push

The native code of push notifications for [Svelte Native](../svelte-native/README.md): an Expo module, `SveltePush`, on Firebase Cloud Messaging for Android and on the Apple Push Notification service for iOS. It has no JavaScript. The API an app calls is `@alfayez/svelte-native/push` (and `@alfayez/svelte-native/push/server`, the sender), and this package is what makes it work on a device.

It is a package of its own so that Firebase is in the build of the apps that use push and of no other app, and so that installing it is what links it, as for any native library. It is released with `@alfayez/svelte-native`, at the same version.

## With `capabilities.push`

The package goes with the `push` capability of the `@alfayez/svelte-native` config plugin. Install it from the same repository and tag as the library (the package is private, like the library):

```sh
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native-push"
```

and say which platforms it serves, with identifiers only:

```ts
// app.config.ts
plugins: [["@alfayez/svelte-native", {
  capabilities: {
    push: {
      android: { googleServicesFile: "./google-services.json", icon: "./assets/notify.png", color: "#0a7f5a", channel: { name: "Updates" } },
      ios: { mode: "production" },
    },
  },
}]]
```

The plugin stops the prebuild for the half-made states: the package without `capabilities.push`, `capabilities.push` without the package, another push library beside it (`expo-notifications`, `@react-native-firebase/messaging`: an app has one), a Google services file that has no client for the app's `android.package`, and a server secret anywhere in the config (the FCM service account, the APNs `.p8`: those belong to the server).

The design and what the developer does are in [PUSH.md](../svelte-native/PUSH.md); the guide page that will follow it is not written yet.
