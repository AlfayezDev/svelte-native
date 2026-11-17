/**
 * What the app's push configuration is checked against, in one place for the two that check it: the config plugin (`capabilities.ts`, which refuses a prebuild that
 * ships a secret, a Google services file that is not the app's, or a second push library) and `svelte-native doctor` (which says the same things before the prebuild, and about
 * the files of the last one). Nothing here reads a file or imports Expo: the doctor is bundled into the CLI, which has to start in an app that has no Expo installed yet.
 */

/** The native code of push: an Expo module of its own, so that Firebase is in the apps that use push and in no other. */
export const pushPackage = "@alfayez/svelte-native-push";

/**
 * The push libraries of other makers. Android delivers every message to one `FirebaseMessagingService` and iOS has one notification center delegate, so a second
 * library would take messages from the first, or the first would take them from it: an app has one push library.
 */
export const otherPushLibraries: readonly string[] = ["expo-notifications", "@react-native-firebase/messaging"];

/** The iOS entitlement that says which APNs the app's tokens belong to (`development` or `production`), and the background mode that lets a silent push wake the app. */
export const apsEnvironmentEntitlement = "aps-environment";
export const remoteNotificationMode = "remote-notification";

const pemKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const serviceAccountJson = /"type"\s*:\s*"service_account"|"private_key"\s*:/;
const privateKeyName = /^private[_-]?key$/i;

/**
 * The first server secret in `value`, and where it is (`where` names the value): a service account (an object with `"type": "service_account"`, or any `private_key`
 * in it, or JSON text that has either), a PEM private key, or the path of a `.p8` file (the APNs key). Push needs the identifiers of the app in its build
 * (`google-services.json`, the `aps-environment` mode), and none of these: a key that can send to every user is the server's, never the app's.
 */
export function findPushSecret(value: unknown, where: string): { where: string; what: string } | undefined {
  if (typeof value === "string") {
    // A service account's JSON holds a PEM key too: it is the more telling name.
    if (serviceAccountJson.test(value)) return { where, what: "a service account key" };
    if (pemKey.test(value)) return { where, what: "a PEM private key" };
    if (/\.p8$/i.test(value.trim())) return { where, what: "the path of a .p8 file (an APNs key)" };
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const at = Array.isArray(value) ? `${where}[${key}]` : `${where}.${key}`;
    if (privateKeyName.test(key)) return { where: at, what: "a private key" };
    if (key === "type" && item === "service_account") return { where, what: "a service account key" };
    const found = findPushSecret(item, at);
    if (found) return found;
  }
  return undefined;
}

/** The package names of the Firebase clients in a `google-services.json`: `client[].client_info.android_client_info.package_name`. */
export function googleServicesPackages(parsed: unknown): string[] {
  const clients = (parsed as { client?: unknown } | null)?.client;
  if (!Array.isArray(clients)) return [];
  return clients.flatMap((client: { client_info?: { android_client_info?: { package_name?: unknown } } } | null) => {
    const name = client?.client_info?.android_client_info?.package_name;
    return typeof name === "string" ? [name] : [];
  });
}
