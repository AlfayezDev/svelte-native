/**
 * The push section of `svelte-native doctor` (PUSH.md, "`svelte-native doctor`"): what can be said of an app's push setup by reading its files, as the rest of the doctor does.
 * It runs nothing and writes nothing, and it cannot run `app.config.ts`, so where the app's config is code it says it could not tell (`unknown`) instead of guessing. An app that
 * has nothing to do with push gets no line at all.
 *
 * What the config plugin refuses at prebuild (`capabilities.ts`), the doctor says before the prebuild, with the plugin's own logic (`push/config.ts`: the secrets, and the shape of `capabilities.push`,
 * which it checks with the plugin's own function and reports with the plugin's own message); and what the prebuild wrote
 * (`ios/`, `android/`) it reads back, to catch a prebuild that is older than the config.
 */
import { join } from "node:path";
import { apsEnvironmentEntitlement, checkPushConfig, findPushSecret, googleServicesPackages, otherPushLibraries, pushIsOn, pushSecretMessage, remoteNotificationMode } from "../push/config.ts";
import type { Check, Context } from "./checks.ts";
import { appJson, codeConfig } from "./integration.ts";
import { findPackage, readerFor, type Reader } from "./resolve.ts";

/** What a prebuild with push on writes, and the native side reads: the Android manifest's meta-data and the iOS Info.plist's key (`capabilities.ts`). */
export const ANDROID_PUSH_FLAG = "expo.modules.sveltepush.enabled";
export const IOS_PUSH_FLAG = "SveltePushEnabled";

const group = "push";

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** A string value of a plist (`<key>name</key><string>value</string>`), or undefined. The files Expo writes are XML plists. */
export function plistString(plist: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}

/** The strings of an array value of a plist, or undefined when the key is not there as an array. */
export function plistStrings(plist: string, key: string): string[] | undefined {
  const array = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist)?.[1];
  return array === undefined ? undefined : [...array.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1] ?? "");
}

/**
 * What the app's own files say of push: the library's plugin options in `app.json`. `push` is `capabilities.push` as an object when the capability is on (what the platform checks read from;
 * `{}` for a value that is not an object, which `capabilityCheck` fails), and `value` is what `app.json` holds there, for the plugin's own check of it. `conclusive` is whether a miss in
 * `app.json` is an answer: with an `app.config.*` beside it (code, which gets `app.json` as its base and may add the plugin or its options) it is not.
 */
type Config = { file: string; push: Record<string, unknown> | undefined; value: unknown; androidPackage: string | undefined; googleServicesFile: string | undefined; conclusive: boolean };

function readConfig(context: Context, library: string): { config: Config | undefined; code: string | undefined } {
  const json = appJson(context.appRoot, library);
  const code = codeConfig(context.appRoot);
  if (!json) return { config: undefined, code };
  const capabilities = record(json.plugin?.capabilities);
  const push = pushIsOn(capabilities.push) ? record(capabilities.push) : undefined;
  const android = record(json.expo.android);
  return { config: { file: json.file, push, value: capabilities.push, androidPackage: text(android.package), googleServicesFile: text(android.googleServicesFile), conclusive: code === undefined }, code };
}

function otherLibraries(context: Context, dependencies: Record<string, unknown>): Check[] {
  const found = otherPushLibraries.filter((name) => name in dependencies || findPackage(name, context.appRoot) !== undefined);
  if (found.length === 0) return [{ group, status: "pass", message: `no other push library (${otherPushLibraries.join(", ")}) is installed` }];
  return found.map((name): Check => ({
    group,
    status: "fail",
    message: `${name} is installed and capabilities.push is on: an app has one push library (Android delivers a message to one FirebaseMessagingService, iOS has one notification center delegate), and the config plugin refuses the build`,
    fix: `pnpm remove ${name}, or turn capabilities.push off and use ${name} for push (the guide's "Push notifications" page sets up each)`,
  }));
}

/**
 * Whether `capabilities.push` is on in `app.json`, which is the one place the doctor can read it from, and whether the plugin would take it: it refuses a secret in it, and a value that is
 * not an object, that names no platform, or whose `android` or `ios` is malformed (`checkPushConfig`, the plugin's own function), each with the message it stops the prebuild with.
 */
function capabilityCheck(config: Config | undefined): Check[] {
  if (!config) return [];
  if (config.push) {
    const secret = findPushSecret(config.value, "capabilities.push");
    if (secret) {
      return [{
        group,
        status: "fail",
        message: `${config.file} turns capabilities.push on, and the config plugin refuses it: ${pushSecretMessage(secret)}`,
        fix: "take it out of the config (and out of the repository's history), revoke the key if it was ever committed, and give it to the server's environment (FCM_SERVICE_ACCOUNT, APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID); the app's config holds identifiers only",
      }];
    }
    const checked = checkPushConfig(config.value);
    if ("problem" in checked) {
      // An `app.config.*` gets `app.json` as its base and may change `capabilities`: what the file says is then the plugin's input only if the code leaves it alone.
      const code = config.conclusive ? "" : ", unless the app's config code changes it";
      return [{
        group,
        status: config.conclusive ? "fail" : "unknown",
        message: `${config.file} turns capabilities.push on, and the config plugin refuses it${code}: ${checked.problem}`,
        fix: `change capabilities.push in ${config.file} as the message says (PUSH.md, "The config"), or turn it off with \`push: false\``,
      }];
    }
    const platforms = ["android", "ios"].filter((name) => config.push?.[name] !== undefined);
    return [{ group, status: "pass", message: `${config.file} turns capabilities.push on (${platforms.join(", ")})` }];
  }
  return [];
}

/** `package` from `applicationId` in `android/app/build.gradle` (or `.kts`): what the last prebuild made of `android.package`. */
function gradleApplicationId(reader: Reader): string | undefined {
  for (const file of ["android/app/build.gradle", "android/app/build.gradle.kts"]) {
    const gradle = reader.read(file);
    const id = gradle === undefined ? undefined : /^\s*applicationId\s*=?\s*["']([^"']+)["']/m.exec(gradle)?.[1];
    if (id) return id;
  }
  return undefined;
}

/** The Google services file the app has, by the way the doctor can tell: the config's own word for it, else the app root, else the prebuild's copy. */
function locateGoogleServices(config: Config | undefined, reader: Reader): string | undefined {
  const named = text(config?.push?.android === undefined ? undefined : record(config.push.android).googleServicesFile) ?? config?.googleServicesFile;
  if (named !== undefined) return named.replace(/^\.\//, "");
  const inRoot = reader.list(".").filter((name) => /^google-services.*\.json$/.test(name)).sort((a, b) => (a === "google-services.json" ? -1 : b === "google-services.json" ? 1 : a.localeCompare(b)));
  if (inRoot[0] !== undefined) return inRoot[0];
  return reader.read("android/app/google-services.json") === undefined ? undefined : "android/app/google-services.json";
}

const FIREBASE_FIX = "download google-services.json from the Firebase console (Project settings, your Android app) and save it in the app's directory, then name it in capabilities.push.android.googleServicesFile";

function androidChecks(context: Context, config: Config | undefined, code: string | undefined, reader: Reader): Check[] {
  // `app.json` is what the doctor can read: when it is the whole config, a push without `android` has no Android side to check (and one that is off has no push at all).
  if (config?.conclusive) {
    if (!config.push) return [];
    if (!config.push.android) return [{ group, status: "skip", message: `${config.file} has no capabilities.push.android: no Google services file to check` }];
  }
  const file = locateGoogleServices(config, reader);
  if (file === undefined) {
    return [{
      group,
      status: "unknown",
      message: `could not find the Google services file: ${code ?? "the app's config"} is code that the doctor does not run, and the app's directory has no google-services*.json`,
      fix: `keep google-services.json in the app's directory, or name it in app.json (capabilities.push.android.googleServicesFile); ${FIREBASE_FIX}`,
    }];
  }
  const contents = reader.read(file);
  if (contents === undefined) {
    return [{ group, status: "fail", message: `${file} does not exist (${join(context.appRoot, file)}), and ${config?.file ?? "the app's config"} names it as the Google services file`, fix: FIREBASE_FIX }];
  }
  const secret = findPushSecret(contents, file);
  if (secret) {
    return [{
      group,
      status: "fail",
      message: `${file} holds ${secret.what}, which is a server secret: a key that can send to every user must never be in the app or its build, and the config plugin refuses it`,
      fix: `delete it from the app (and from the repository's history, and from any build that carried it) and revoke the key in the Google Cloud console (IAM and admin, Service accounts, Keys); create a new one for the server's environment (FCM_SERVICE_ACCOUNT). The app needs the other file, which holds identifiers only: ${FIREBASE_FIX}`,
    }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return [{ group, status: "fail", message: `${file} is not JSON`, fix: `download google-services.json from the Firebase console again (Project settings, your Android app)` }];
  }
  const project = text(record(record(parsed).project_info).project_id);
  const checks: Check[] = [{ group, status: "pass", message: `${file} is JSON and holds no server secret${project ? ` (Firebase project ${project})` : ""}` }];
  const clients = googleServicesPackages(parsed);
  const appPackage = config?.androidPackage ?? gradleApplicationId(reader);
  if (appPackage === undefined) {
    checks.push({
      group,
      status: "unknown",
      message: `could not tell the app's Android package to look for its client in ${file} (${config ? `${config.file} has no android.package` : "the config is code"}, and android/ has no build.gradle yet)`,
      fix: `set android.package in app.json, or run npx expo prebuild; the file has ${clients.length === 0 ? "no Android client" : clients.map((name) => `"${name}"`).join(", ")}`,
    });
  } else if (clients.includes(appPackage)) {
    checks.push({ group, status: "pass", message: `${file} has a client for the app's package "${appPackage}"` });
  } else {
    checks.push({
      group,
      status: "fail",
      message: `${file} has no client for the app's package "${appPackage}" (${clients.length === 0 ? "it has no Android client" : `it has ${clients.map((name) => `"${name}"`).join(", ")}`}): Firebase would not deliver to this app`,
      fix: "add an Android app with that package to the Firebase project and download google-services.json again, or fix android.package",
    });
  }
  return checks;
}

/** The directory of the iOS app in `ios/`: the project's name (`App.xcodeproj`), else the one directory that holds an `Info.plist`. */
function iosAppDirectory(reader: Reader): string | undefined {
  const entries = reader.list("ios");
  const project = entries.find((name) => name.endsWith(".xcodeproj"));
  if (project !== undefined) return project.slice(0, -".xcodeproj".length);
  const candidates = entries.filter((name) => !/^(Pods|build)$|\.(xcodeproj|xcworkspace)$|^\./.test(name) && reader.read(`ios/${name}/Info.plist`) !== undefined);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function iosChecks(config: Config | undefined, reader: Reader): Check[] {
  if (config?.conclusive) {
    if (!config.push) return [];
    if (!config.push.ios) return [{ group, status: "skip", message: `${config.file} has no capabilities.push.ios: no entitlement or background mode to check` }];
  }
  if (reader.list("ios").length === 0) {
    return [{ group, status: "skip", message: "no ios/ directory yet: the aps-environment entitlement and the remote-notification background mode are written by `expo prebuild`, which has not run" }];
  }
  const directory = iosAppDirectory(reader);
  const fix = "npx expo prebuild --platform ios (with capabilities.push.ios set), so that the entitlement and the background mode are written";
  if (directory === undefined) {
    return [{ group, status: "unknown", message: "could not find the iOS app in ios/ (no <name>.xcodeproj, and not one directory with an Info.plist): the entitlement and the background mode were not checked", fix: "run npx expo prebuild --platform ios" }];
  }
  const checks: Check[] = [];
  const base = `ios/${directory}`;
  const entitlementsFile = reader.list(base).find((name) => name.endsWith(".entitlements"));
  const entitlements = entitlementsFile === undefined ? undefined : reader.read(`${base}/${entitlementsFile}`);
  if (entitlements === undefined) {
    checks.push({ group, status: "fail", message: `${base} has no .entitlements file: the Push Notifications capability (aps-environment) was not written by the last prebuild`, fix });
  } else {
    const environment = plistString(entitlements, apsEnvironmentEntitlement);
    const wanted = text(record(config?.push?.ios).mode);
    if (environment === undefined) {
      checks.push({ group, status: "fail", message: `${base}/${entitlementsFile} has no ${apsEnvironmentEntitlement}: the app cannot register with APNs`, fix });
    } else if (wanted !== undefined && wanted !== environment) {
      checks.push({ group, status: "fail", message: `${base}/${entitlementsFile} has ${apsEnvironmentEntitlement} ${environment}, and capabilities.push.ios.mode is ${wanted}: the last prebuild is older than the config`, fix });
    } else {
      checks.push({ group, status: "pass", message: `${base}/${entitlementsFile} has ${apsEnvironmentEntitlement} ${environment}` });
    }
  }
  const infoPlist = reader.read(`${base}/Info.plist`);
  if (infoPlist === undefined) {
    checks.push({ group, status: "unknown", message: `could not read ${base}/Info.plist: the background modes were not checked`, fix: "run npx expo prebuild --platform ios" });
  } else if (infoPlist.startsWith("bplist")) {
    checks.push({ group, status: "unknown", message: `${base}/Info.plist is a binary plist: the background modes were not checked` });
  } else if (plistStrings(infoPlist, "UIBackgroundModes")?.includes(remoteNotificationMode)) {
    checks.push({ group, status: "pass", message: `${base}/Info.plist lists ${remoteNotificationMode} in UIBackgroundModes` });
  } else {
    checks.push({ group, status: "fail", message: `${base}/Info.plist does not list ${remoteNotificationMode} in UIBackgroundModes: a silent push would not wake the app`, fix });
  }
  return checks;
}

/** Whether the last prebuild turned push on: the flag it writes in the Android manifest or the iOS Info.plist (undefined for a platform with no native project yet). */
function prebuiltPush(reader: Reader): { android: boolean | undefined; ios: boolean | undefined } {
  const manifest = reader.read("android/app/src/main/AndroidManifest.xml");
  const directory = reader.list("ios").length === 0 ? undefined : iosAppDirectory(reader);
  const infoPlist = directory === undefined ? undefined : reader.read(`ios/${directory}/Info.plist`);
  return {
    android: manifest === undefined ? undefined : new RegExp(`android:name="${ANDROID_PUSH_FLAG.replaceAll(".", "\\.")}"\\s+android:value="true"`).test(manifest),
    ios: infoPlist === undefined ? undefined : new RegExp(`<key>${IOS_PUSH_FLAG}</key>\\s*<true/>`).test(infoPlist),
  };
}

/** A platform the config turns push on for, whose native project the last prebuild wrote without it: the build would have no push until the next prebuild. */
function prebuildChecks(config: Config | undefined, prebuilt: { android: boolean | undefined; ios: boolean | undefined }): Check[] {
  if (!config?.push) return [];
  const checks: Check[] = [];
  for (const platform of ["android", "ios"] as const) {
    if (config.push[platform] === undefined || prebuilt[platform] === undefined) continue;
    const where = platform === "android" ? `android/app/src/main/AndroidManifest.xml (${ANDROID_PUSH_FLAG})` : `ios/…/Info.plist (${IOS_PUSH_FLAG})`;
    checks.push(prebuilt[platform]
      ? { group, status: "pass", message: `the last prebuild turned push on for ${platform}: ${where}` }
      : { group, status: "fail", message: `capabilities.push names ${platform}, and the last prebuild did not turn push on there (no ${where}): the prebuild is older than the config`, fix: `npx expo prebuild --platform ${platform}, then build the app again` });
  }
  return checks;
}

/**
 * The push checks for the app, or none when push is not in play: `app.json` turns the capability on, or the last prebuild did (an app whose config is code). `library` is the
 * library's name and version.
 */
export function pushChecks(context: Context, library: { name: string; version: string }, appPackage: Record<string, unknown>): Check[] {
  const dependencies = { ...record(appPackage.dependencies), ...record(appPackage.devDependencies), ...record(appPackage.optionalDependencies) };
  const { config, code } = readConfig(context, library.name);
  const reader = readerFor(context.appRoot);
  const prebuilt = prebuiltPush(reader);
  // `app.json` decides when it is the whole config; with code beside it (or none at all), what the last prebuild wrote says push is on.
  const inPlay = config?.push !== undefined || (config?.conclusive !== true && (prebuilt.android === true || prebuilt.ios === true));
  if (!inPlay) return [];
  return [
    ...otherLibraries(context, dependencies),
    ...capabilityCheck(config),
    ...androidChecks(context, config, code, reader),
    ...iosChecks(config, reader),
    ...prebuildChecks(config, prebuilt),
  ];
}
