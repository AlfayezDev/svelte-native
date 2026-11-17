/**
 * What the app's push configuration is checked against, in one place for the two that check it: the config plugin (`capabilities.ts`, which refuses a prebuild that
 * ships a secret, a Google services file that is not the app's, or a second push library) and `svelte-native doctor` (which says the same things before the prebuild, and about
 * the files of the last one). Nothing here reads a file or imports Expo: the doctor is bundled into the CLI, which has to start in an app that has no Expo installed yet.
 */
/** The native code of push: an Expo module of its own, so that Firebase is in the apps that use push and in no other. */
export declare const pushPackage = "@alfayez/svelte-native-push";
/**
 * The push libraries of other makers. Android delivers every message to one `FirebaseMessagingService` and iOS has one notification center delegate, so a second
 * library would take messages from the first, or the first would take them from it: an app has one push library.
 */
export declare const otherPushLibraries: readonly string[];
/** The iOS entitlement that says which APNs the app's tokens belong to (`development` or `production`), and the background mode that lets a silent push wake the app. */
export declare const apsEnvironmentEntitlement = "aps-environment";
export declare const remoteNotificationMode = "remote-notification";
/**
 * The first server secret in `value`, and where it is (`where` names the value): a service account (an object with `"type": "service_account"`, or any `private_key`
 * in it, or JSON text that has either), a PEM private key, or the path of a `.p8` file (the APNs key). Push needs the identifiers of the app in its build
 * (`google-services.json`, the `aps-environment` mode), and none of these: a key that can send to every user is the server's, never the app's.
 */
export declare function findPushSecret(value: unknown, where: string): {
    where: string;
    what: string;
} | undefined;
/** The package names of the Firebase clients in a `google-services.json`: `client[].client_info.android_client_info.package_name`. */
export declare function googleServicesPackages(parsed: unknown): string[];
