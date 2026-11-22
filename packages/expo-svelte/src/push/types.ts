/**
 * The types the device's side of push (`push.svelte.ts`, the native module `SveltePush`) and the server's sender (`push/server.ts`) share
 * (PUSH.md). A `PushToken` is what the app saves on its server and what the sender sends to; a `PushMessage` is what the app's hooks receive.
 */

/** A device the app's server can send to: what `push.subscribe` hands to `save`, and the first argument of the sender's `send`. */
export type PushToken = {
  /** Firebase Cloud Messaging (Android) or the Apple Push Notification service (iOS). */
  provider: "fcm" | "apns";
  /** FCM's registration token, or the APNs device token as lowercase hex. */
  token: string;
  /** APNs only: which APNs the token belongs to, from the build's `aps-environment` entitlement. The sender picks the endpoint with it. */
  environment?: "development" | "production";
  /** The app's Android package or iOS bundle id: the APNs topic, and the check that a token goes to the project it belongs to. */
  app: string;
};

/** A message as the app receives it: in the foreground, in the background (a data message) and when its notification is tapped. */
export type PushMessage = {
  /** The provider's message id (FCM's `message_id`, APNs's `apns-id`), or one made on the device when the provider gave none. */
  id: string;
  title?: string;
  body?: string;
  /** The link a tap opens: a path of the app (`/orders/42`) or a full link (`myapp://orders/42`, or an https link the app handles). */
  url?: string;
  /** The sender's `data`: strings only, as both providers carry them. */
  data: Record<string, string>;
  provider: "fcm" | "apns";
};
