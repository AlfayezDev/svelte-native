/**
 * What the app's push configuration is checked against, in one place for the two that check it: the config plugin (`capabilities.ts`, which refuses a prebuild that
 * ships a secret, a malformed `capabilities.push`, a Google services file that is not the app's, or a second push library) and `svelte-native doctor` (which says the same things
 * before the prebuild, and about the files of the last one). Nothing here reads a file or imports Expo: the doctor is bundled into the CLI, which has to start in an app that has no
 * Expo installed yet.
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

/** The refusal of a secret in the config, as the plugin and the doctor both say it: `where` names the value and `what` the kind of key it is (`findPushSecret`). */
export const pushSecretMessage = ({ where, what }: { where: string; what: string }): string =>
  `${where} is ${what}: a key that can send to every user must never be in the app or its build. Keep it in the server's environment (the FCM service account, the APNs .p8 with its key id and team id) and give the app identifiers only.`;

/** What `capabilities.push` says once its shape has been checked: nothing is read from disk, so a file it names may still be missing, and the channel's defaults are not filled in. */
export type PushConfig = {
  android?: { googleServicesFile: string; icon?: string; color?: string; channel?: { id?: string; name: string; description?: string } };
  ios?: { mode: "development" | "production" };
};

/** A refusal inside the check below, which the check returns as its `problem`. */
class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message);
};

/** `value` as an object of the config, or the refusal that says what the config takes there. */
function section(value: unknown, where: string, example: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse(`${where} takes an object: ${example}`);
  return value as Record<string, unknown>;
}

/** A text of the config that is given: not empty, as the user or the build will read it. */
function optionalText(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") return refuse(`${where} must be a text that is not empty.`);
  return value;
}

function readIos(value: unknown): NonNullable<PushConfig["ios"]> {
  const ios = section(value, "capabilities.push.ios", '`ios: { mode: "production" }`');
  if (ios.mode !== "development" && ios.mode !== "production")
    return refuse(
      'capabilities.push.ios.mode must be "development" or "production": it is the aps-environment entitlement, "development" for a build signed for development and "production" for TestFlight and the App Store.',
    );
  return { mode: ios.mode };
}

function readAndroid(value: unknown): NonNullable<PushConfig["android"]> {
  const android = section(value, "capabilities.push.android", '`android: { googleServicesFile: "./google-services.json" }`');
  const file = android.googleServicesFile;
  if (typeof file !== "string" || file.trim() === "")
    return refuse(
      'capabilities.push.android needs googleServicesFile, the path of the Firebase project\'s google-services.json (Firebase console, Project settings, your Android app): `android: { googleServicesFile: "./google-services.json" }`. ' +
        "Leave `android` out for an app that has no push on Android.",
    );
  const settings: NonNullable<PushConfig["android"]> = { googleServicesFile: file };
  const icon = optionalText(android.icon, "capabilities.push.android.icon");
  if (icon !== undefined) {
    if (!/\.png$/i.test(icon)) return refuse(`capabilities.push.android.icon ("${icon}") must be a PNG file: the notification's small icon, white on a transparent background.`);
    settings.icon = icon;
  }
  const color = optionalText(android.color, "capabilities.push.android.color");
  if (color !== undefined) {
    if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return refuse(`capabilities.push.android.color ("${color}") must be a hex color such as "#0a7f5a": the notification's accent color.`);
    settings.color = color;
  }
  if (android.channel !== undefined) {
    const channel = section(android.channel, "capabilities.push.android.channel", '`channel: { name: "Updates" }`');
    if (typeof channel.name !== "string" || channel.name.trim() === "")
      return refuse('capabilities.push.android.channel needs a name, as the user will read it in the app\'s notification settings: `channel: { name: "Updates" }`.');
    const id = optionalText(channel.id, "capabilities.push.android.channel.id");
    const description = optionalText(channel.description, "capabilities.push.android.channel.description");
    settings.channel = { ...(id === undefined ? {} : { id }), name: channel.name, ...(description === undefined ? {} : { description }) };
  }
  return settings;
}

/**
 * Checks the shape of `capabilities.push` (the value of the config, whatever it is; the caller has found it not to be off, and to hold no secret) and returns what it says, or the
 * `problem` the plugin stops the prebuild with. It reads nothing: the files it names, the app's package and the installed libraries are for the plugin to check (`pushSettings`), and
 * the doctor says them in its own way. The plugin and the doctor both call this, so they refuse the same configs.
 */
export function checkPushConfig(push: unknown): { config: PushConfig } | { problem: string } {
  try {
    const platforms = section(push, "capabilities.push", '`push: { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } }`, or `push: false`');
    if (platforms.android === undefined && platforms.ios === undefined)
      return refuse(
        "capabilities.push names no platform: give `android` (its google-services.json), `ios` (its aps-environment mode) or both, or turn the capability off with `push: false` and uninstall @alfayez/svelte-native-push.",
      );
    const config: PushConfig = {};
    if (platforms.android !== undefined) config.android = readAndroid(platforms.android);
    if (platforms.ios !== undefined) config.ios = readIos(platforms.ios);
    return { config };
  } catch (error) {
    if (error instanceof Refusal) return { problem: error.message };
    throw error;
  }
}

/** Whether `capabilities.push` of the config is on: anything but `false`, `null` and leaving it out (so a value that is not an object is on, and is refused by `checkPushConfig`). */
export const pushIsOn = (push: unknown): boolean => push !== undefined && push !== null && push !== false;
