import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CapabilityConfigError, pushSettings, withCapabilities } from "../../src/capabilities.ts";
import { runChecks, type Check } from "../../src/doctor/checks.ts";
import { formatReport, runDoctor } from "../../src/doctor/index.ts";
import { ANDROID_PUSH_FLAG, IOS_PUSH_FLAG, plistStrings, plistString } from "../../src/doctor/push.ts";
import { otherPushLibraries } from "../../src/push/config.ts";
import { library, makeFakeApp, repository } from "./support/doctor-fixture.ts";

// The push section of `expo-svelte doctor` (src/doctor/push.ts) against fake apps: what it says of `capabilities.push`, the Google services file, and the native files the last
// prebuild wrote, from reading files alone. Push is part of the library: there is no package to check. The `--server` half, which makes requests, is in tests/push/cli.test.ts.

const apps: string[] = [];
afterAll(() => { for (const app of apps) rmSync(app, { recursive: true, force: true }); });

const tools = { node: "26.0.0", pnpm: () => "12.3.4" };

const googleServices = (...packages: string[]) =>
  JSON.stringify({ project_info: { project_id: "demo" }, client: packages.map((name) => ({ client_info: { mobilesdk_app_id: "1:1:android:1", android_client_info: { package_name: name } } })), configuration_version: "1" });
const fullPush = { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } };
/** An `app.json` whose plugin entry for the library has these `capabilities.push` (and, with `androidPackage`, an `android.package`). */
const appJson = (push: unknown, extra: Record<string, unknown> = {}, androidPackage: string | null = "io.e.a") =>
  JSON.stringify({ expo: { name: "fake", ...(androidPackage ? { android: { package: androidPackage } } : {}), plugins: [[library.name, push === undefined ? {} : { capabilities: { push } }]], ...extra } });

type PushApp = {
  /** Other packages the app depends on, and the ones that are installed. */
  dependencies?: string[];
  installed?: string[];
  files?: Record<string, string | null>;
};

/** The doctor's checks for a fake app, as `options` says, and `files` over the defaults: an `app.json` with push on and a Google services file for `io.e.a`. */
function run(options: PushApp = {}): { root: string; checks: Check[]; push: Check[] } {
  const dependencies = { [library.name]: "*", ...Object.fromEntries((options.dependencies ?? []).map((name) => [name, "*"])) };
  const stubs = Object.fromEntries((options.installed ?? []).map((name) => [`node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0" })]));
  const root = makeFakeApp({
    files: { "package.json": JSON.stringify({ name: "fake-app", version: "1.0.0", dependencies }), "app.json": appJson(fullPush), "google-services.json": googleServices("io.e.a"), ...stubs, ...options.files },
  });
  apps.push(root);
  const checks = runChecks({ appRoot: root, packageRoot: join(repository, "packages/expo-svelte"), ...tools });
  return { root, checks, push: checks.filter((check) => check.group === "push") };
}
const find = (checks: Check[], text: string) => checks.find((check) => check.message.includes(text));
const statuses = (checks: Check[]) => checks.map((check) => check.status);
const failures = (checks: Check[]) => checks.filter((check) => check.status === "fail");

const entitlements = (environment?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n  <dict>${environment ? `\n    <key>aps-environment</key>\n    <string>${environment}</string>` : ""}\n  </dict>\n</plist>\n`;
const infoPlist = (modes?: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n    <key>CFBundleName</key>\n    <string>App</string>${modes ? `\n    <key>UIBackgroundModes</key>\n    <array>${modes.map((mode) => `\n      <string>${mode}</string>`).join("")}\n    </array>` : ""}\n  </dict>\n</plist>\n`;
/**
 * The iOS project a prebuild writes: `ios/App.xcodeproj`, the entitlements and the Info.plist of the app (`null`: without the entitlement, or without background modes), with the
 * flag that turns push on (`flag: false`: a prebuild that did not).
 */
const ios = ({ environment = "production", modes = ["remote-notification"], flag = true }: { environment?: string | null; modes?: string[] | null; flag?: boolean } = {}): Record<string, string> => ({
  "ios/App.xcodeproj/project.pbxproj": "",
  "ios/App/App.entitlements": entitlements(environment ?? undefined),
  "ios/App/Info.plist": infoPlist(modes ?? undefined).replace("<dict>", flag ? `<dict>\n    <key>${IOS_PUSH_FLAG}</key>\n    <true/>` : "<dict>"),
});
/** The Android manifest a prebuild writes, with the flag that turns push on or without it. */
const androidManifest = (flag: boolean): Record<string, string> => ({
  "android/app/src/main/AndroidManifest.xml": `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application>${flag ? `\n    <meta-data android:name="${ANDROID_PUSH_FLAG}" android:value="true"/>` : ""}\n  </application>\n</manifest>\n`,
});

describe("an app with push that is set up", () => {
  const { push } = run();

  test("passes its checks: no other push library, the capability, the Google services file and its client; the iOS files wait for a prebuild", () => {
    expect(push.map((check) => [check.status, check.message])).toEqual([
      ["pass", "no other push library (expo-notifications, @react-native-firebase/messaging) is installed"],
      ["pass", "app.json turns capabilities.push on (android, ios)"],
      ["pass", "google-services.json is JSON and holds no server secret (Firebase project demo)"],
      ["pass", 'google-services.json has a client for the app\'s package "io.e.a"'],
      ["skip", "no ios/ directory yet: the aps-environment entitlement and the remote-notification background mode are written by `expo prebuild`, which has not run"],
    ]);
  });

  test("is its own group, printed under `push`, and the other groups are as they were", () => {
    const text = formatReport(run().checks);
    expect(text).toContain("\npush\n");
    expect(text).toMatch(/\npush\n {2}pass {2}no other push library /);
  });

  test("with the native projects of the last prebuild, the entitlement, the background mode and the prebuild's flags pass too", () => {
    const { push: prebuilt } = run({ files: { ...ios(), ...androidManifest(true) } });
    expect(statuses(prebuilt)).toEqual(Array(8).fill("pass"));
    expect(prebuilt.slice(-4).map((check) => check.message)).toEqual([
      "ios/App/App.entitlements has aps-environment production",
      "ios/App/Info.plist lists remote-notification in UIBackgroundModes",
      `the last prebuild turned push on for android: android/app/src/main/AndroidManifest.xml (${ANDROID_PUSH_FLAG})`,
      `the last prebuild turned push on for ios: ios/…/Info.plist (${IOS_PUSH_FLAG})`,
    ]);
  });
});

describe("an app with no push", () => {
  test("has no push line at all: no capabilities.push, the plugin by name alone, push: false, or an app that never heard of push", () => {
    for (const config of [appJson(undefined), JSON.stringify({ expo: { plugins: [library.name] } }), appJson(false)]) {
      const { checks } = run({ files: { "app.json": config, "google-services.json": null } });
      expect(checks.filter((check) => check.group === "push")).toEqual([]);
    }
    const plain = runChecks({ appRoot: makeFakeApp(), packageRoot: join(repository, "packages/expo-svelte"), ...tools });
    expect(plain.some((check) => check.group === "push")).toBe(false);
  });

  test("a second push library is that library's business when push is off", () => {
    const { checks } = run({ installed: ["expo-notifications"], files: { "app.json": appJson(false) } });
    expect(checks.filter((check) => check.group === "push")).toEqual([]);
  });
});

describe("one push library", () => {
  test("the libraries refused are the two this describe goes over", () => {
    expect(otherPushLibraries).toEqual(["expo-notifications", "@react-native-firebase/messaging"]);
  });

  for (const other of otherPushLibraries) {
    test(`${other} with capabilities.push on is a failure: an app has one push library`, () => {
      const installed = run({ installed: [other] }).push;
      expect(find(installed, `${other} is installed and capabilities.push is on`)).toMatchObject({ status: "fail", fix: expect.stringContaining(`pnpm remove ${other}`) });
      expect(find(installed, "one push library")?.message).toContain("FirebaseMessagingService");
      expect(find(installed, "no other push library")).toBeUndefined();
      // Declared and not installed yet (a pnpm install is due) is as much a second library.
      expect(find(run({ dependencies: [other] }).push, `${other} is installed and capabilities.push is on`)?.status).toBe("fail");
    });
  }
});

describe("the prebuild", () => {
  test("a platform the config names, whose native project the last prebuild wrote without push, is a prebuild older than the config", () => {
    const { push } = run({ files: { ...ios({ flag: false }), ...androidManifest(false) } });
    for (const platform of ["android", "ios"]) {
      expect(find(push, `capabilities.push names ${platform}, and the last prebuild did not turn push on there`)).toMatchObject({ status: "fail", fix: `npx expo prebuild --platform ${platform}, then build the app again` });
    }
  });

  test("a platform the config leaves out, or a native project not written yet, has nothing to say", () => {
    const androidOnly = run({ files: { "app.json": appJson({ android: { googleServicesFile: "./google-services.json" } }), ...ios({ flag: false }), ...androidManifest(true) } }).push;
    expect(find(androidOnly, "prebuild turned push on for android")?.status).toBe("pass");
    expect(find(androidOnly, "for ios")).toBeUndefined();
    expect(find(run().push, "the last prebuild")).toBeUndefined();
  });

  test("with an app.config.ts, the config is code: no section without a prebuild that turned push on, and with one the doctor checks what it can", () => {
    const code = { "app.json": JSON.stringify({ expo: { name: "fake" } }), "app.config.ts": "export default ({ config }) => config;\n", "google-services.json": null };
    expect(run({ files: code }).push).toEqual([]);
    const { push } = run({ files: { ...code, ...androidManifest(true) } });
    expect(find(push, "could not find the Google services file")).toMatchObject({ status: "unknown" });
    expect(find(push, "app.config.ts is code that the doctor does not run")).toMatchObject({ status: "unknown" });
  });
});

describe("the capability's value: the doctor refuses what the plugin refuses, with the plugin's message", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nTOPSECRETKEYBODY\n-----END PRIVATE KEY-----\n";
  const android = (more: object = {}) => ({ googleServicesFile: "./google-services.json", ...more });
  const refusedConfigs: [string, unknown][] = [
    ["an empty object", {}],
    ["true", true],
    ["a string", "on"],
    ["a number", 1],
    ["an array", []],
    ["android with nothing in it", { android: {} }],
    ["android with an empty file", { android: { googleServicesFile: "" } }],
    ["android that is a string", { android: "./google-services.json" }],
    ["ios with nothing in it", { ios: {} }],
    ["ios with a mode that is not one", { ios: { mode: "staging" } }],
    ["ios with a mode of another case", { ios: { mode: "Production" } }],
    ["ios that is a string", { ios: "production" }],
    ["an icon that is not a PNG", { android: android({ icon: "./assets/icon.jpg" }) }],
    ["an empty icon", { android: android({ icon: "" }) }],
    ["a color that is not hex", { android: android({ color: "green" }) }],
    ["a channel with no name", { android: android({ channel: {} }) }],
    ["a channel with an empty id", { android: android({ channel: { name: "Updates", id: "" } }) }],
    ["a channel with a blank description", { android: android({ channel: { name: "Updates", description: " " } }) }],
    ["a service account in it", { ...fullPush, serviceAccount: { type: "service_account", project_id: "demo" } }],
    ["a PEM key in it", { ...fullPush, key: pem }],
    ["the path of an APNs key", { ios: { mode: "production", key: "./AuthKey_ABC123DEFG.p8" } }],
  ];
  const takenConfigs: [string, unknown][] = [
    ["both platforms", fullPush],
    ["iOS alone", { ios: { mode: "development" } }],
    ["Android alone", { android: android() }],
    ["everything the plugin reads", { android: android({ icon: "./assets/notify.png", color: "#0a7f5a", channel: { id: "orders", name: "Orders", description: "Order updates" } }), ios: { mode: "production" } }],
    ["a text that looks like a number or a reference", { android: android({ channel: { id: "007", name: "@mentions", description: "?what" } }) }],
  ];
  const pluginsAnswer = (root: string, push: unknown): Error | undefined => {
    try {
      withCapabilities({ name: "fake", slug: "fake", android: { package: "io.e.a" }, _internal: { projectRoot: root } }, { push: push as never }, { projectRoot: root });
      return undefined;
    } catch (error) {
      return error as Error;
    }
  };
  const asked = (push: unknown) => run({ files: { "app.json": appJson(push), "assets/notify.png": "a png, nearly" } });
  const refusal = (push: Check[]) => push.find((check) => check.message.includes("and the config plugin refuses it"));

  for (const [what, push] of refusedConfigs) {
    test(`${what}: the plugin stops the prebuild, and the doctor fails with the plugin's message`, () => {
      const { root, push: checks } = asked(push);
      const plugin = pluginsAnswer(root, push);
      expect(plugin).toBeInstanceOf(CapabilityConfigError);
      expect(refusal(checks)?.status).toBe("fail");
      expect(refusal(checks)?.message).toContain(`: ${plugin?.message}`);
      expect(find(checks, "turns capabilities.push on (")).toBeUndefined();
      // A secret is not repeated in what the doctor prints.
      expect(JSON.stringify(checks)).not.toContain("TOPSECRETKEYBODY");
    });
  }

  for (const [what, push] of takenConfigs) {
    test(`${what}: the plugin takes it, and the doctor passes it`, () => {
      const { root, push: checks } = asked(push);
      expect(pluginsAnswer(root, push)).toBeUndefined();
      expect(refusal(checks)).toBeUndefined();
      expect(find(checks, "turns capabilities.push on (")?.status).toBe("pass");
      expect(failures(checks)).toEqual([]);
    });
  }

  test("a capability that is off is not refused by either: false, null and leaving it out", () => {
    for (const push of [false, null, undefined]) {
      const { root, push: checks } = run({ files: { "app.json": appJson(push) } });
      expect(pluginsAnswer(root, push)).toBeUndefined();
      // Push is off: the doctor has no push section to say anything in.
      expect(checks).toEqual([]);
    }
  });

  test("with an app.config.ts beside app.json, what app.json holds may be changed by the code: the doctor says it could not tell, and a secret is a failure either way", () => {
    const code = { "app.config.ts": "export default ({ config }) => config;\n" };
    const { push: malformed } = run({ files: { "app.json": appJson({}), ...code } });
    expect(refusal(malformed)?.status).toBe("unknown");
    expect(refusal(malformed)?.message).toContain("unless the app's config code changes it: capabilities.push names no platform");
    const { push: secret } = run({ files: { "app.json": appJson({ ...fullPush, key: pem }), ...code } });
    expect(refusal(secret)?.status).toBe("fail");
  });

  test("the failure says what to do, and a failing capability makes the doctor exit 1", () => {
    const { root, push: checks } = asked({ ios: {} });
    expect(refusal(checks)?.fix).toContain("change capabilities.push in app.json as the message says");
    expect(refusal(asked({ ...fullPush, key: pem }).push)?.fix).toContain("FCM_SERVICE_ACCOUNT");
    expect(runDoctor(root, [], { write: () => undefined }, { ...tools })).toBe(1);
  });
});

describe("the Google services file", () => {
  test("a server secret in it is a failure with a security fix, and nothing else is said of the file", () => {
    for (const secret of [
      JSON.stringify({ type: "service_account", project_id: "demo", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", client_email: "x@demo.iam.gserviceaccount.com" }),
      JSON.stringify({ project_info: { project_id: "demo" }, client: [], private_key: "x" }),
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    ]) {
      const { push } = run({ files: { "google-services.json": secret } });
      const failure = find(push, "google-services.json holds ");
      expect(failure?.status).toBe("fail");
      expect(failure?.message).toMatch(/a server secret/);
      expect(failure?.fix).toContain("revoke the key");
      expect(failure?.fix).toContain("FCM_SERVICE_ACCOUNT");
      expect(find(push, "has a client for")).toBeUndefined();
      // The key's text is not repeated in what the doctor prints.
      expect(JSON.stringify(failure)).not.toContain("abc");
    }
  });

  test("the plugin refuses the same files the doctor fails, and takes the one it passes", () => {
    const service = JSON.stringify({ type: "service_account", private_key: "k" });
    const other = googleServices("io.e.other");
    for (const [contents, expected] of [[service, "a service account key"], [other, "has no client for the app's package"]] as const) {
      const { root, push } = run({ files: { "google-services.json": contents } });
      expect(failures(push).map((check) => check.message).join("\n"), expected).toContain("google-services.json");
      expect(() => pushSettings(fullPush, "io.e.a", root)).toThrow(expected);
    }
    const { root, push } = run();
    expect(push.some((check) => check.status === "fail")).toBe(false);
    expect(pushSettings(fullPush, "io.e.a", root).android?.googleServicesFile).toBe("./google-services.json");
  });

  test("a file that is not JSON is a failure", () => {
    expect(find(run({ files: { "google-services.json": "{ nope" } }).push, "google-services.json is not JSON")?.status).toBe("fail");
  });

  test("a Firebase project with no client for the app's package is a failure that lists the ones it has", () => {
    const { push } = run({ files: { "google-services.json": googleServices("io.e.other", "io.e.third") } });
    const failure = find(push, 'has no client for the app\'s package "io.e.a"');
    expect(failure?.status).toBe("fail");
    expect(failure?.message).toContain('it has "io.e.other", "io.e.third"');
    expect(failure?.fix).toContain("download google-services.json again");
    expect(find(run({ files: { "google-services.json": "{}" } }).push, "it has no Android client")?.status).toBe("fail");
  });

  test("the package is android.package of app.json, else the applicationId of the android/ project a prebuild made", () => {
    const withoutPackage = { "app.json": appJson(fullPush, {}, null) };
    expect(find(run({ files: withoutPackage }).push, "could not tell the app's Android package")).toMatchObject({ status: "unknown" });
    const gradle = (quote: string) => `android {\n    defaultConfig {\n        applicationId ${quote}io.e.a${quote}\n        versionCode 1\n    }\n}\n`;
    expect(find(run({ files: { ...withoutPackage, "android/app/build.gradle": gradle("'") } }).push, 'has a client for the app\'s package "io.e.a"')?.status).toBe("pass");
    expect(find(run({ files: { ...withoutPackage, "android/app/build.gradle": gradle('"').replace("applicationId", "applicationId =").replace("io.e.a", "io.e.other") } }).push, 'has no client for the app\'s package "io.e.other"')?.status).toBe("fail");
  });

  test("a file the config names that is not there is a failure that says where it looked", () => {
    const { push, root } = run({ files: { "google-services.json": null } });
    const failure = find(push, "google-services.json does not exist");
    expect(failure?.status).toBe("fail");
    expect(failure?.message).toContain(join(root, "google-services.json"));
    expect(failure?.fix).toContain("Firebase console");
  });

  test("a file the config does not name is found in the app's directory (google-services*.json, the plain name first), or as the prebuild's copy; the config that does not name it is refused all the same", () => {
    const unnamed = appJson({ android: {}, ios: { mode: "production" } });
    expect(find(run({ files: { "app.json": unnamed, "google-services.json": null, "google-services.dev.json": googleServices("io.e.a") } }).push, "google-services.dev.json is JSON")?.status).toBe("pass");
    // The plugin stops the prebuild on `android` without a `googleServicesFile` (the capability's own, not Expo's), and the doctor says so beside what it found.
    expect(find(run({ files: { "app.json": unnamed } }).push, "capabilities.push.android needs googleServicesFile")?.status).toBe("fail");
    const both = run({ files: { "app.json": unnamed, "google-services.json": googleServices("io.e.a"), "google-services.dev.json": googleServices("io.e.other") } }).push;
    expect(find(both, "google-services.json is JSON")?.status).toBe("pass");
    expect(find(both, "google-services.dev.json")).toBeUndefined();
    const copy = run({ files: { "app.json": unnamed, "google-services.json": null, "android/app/google-services.json": googleServices("io.e.a") } }).push;
    expect(find(copy, "android/app/google-services.json is JSON")?.status).toBe("pass");
  });

  test("the file android.googleServicesFile of the config names is checked when capabilities.push does not name one (which the plugin refuses, and the doctor says)", () => {
    const config = JSON.stringify({ expo: { name: "fake", android: { package: "io.e.a", googleServicesFile: "./config/firebase.json" }, plugins: [[library.name, { capabilities: { push: { android: {} } } }]] } });
    const { push } = run({ files: { "app.json": config, "google-services.json": null, "config/firebase.json": googleServices("io.e.a") } });
    expect(find(push, "config/firebase.json is JSON")?.status).toBe("pass");
    expect(find(push, "capabilities.push.android needs googleServicesFile")?.status).toBe("fail");
  });

  test("an app.config.ts and no file at all: it could not tell, and says how to let it", () => {
    // A config that is code says nothing the doctor can read; the prebuild that turned push on is what says the app has push.
    const { push } = run({ files: { "app.json": null, "app.config.ts": "export default {};\n", "google-services.json": null, ...androidManifest(true) } });
    const unknown = find(push, "could not find the Google services file");
    expect(unknown).toMatchObject({ status: "unknown" });
    expect(unknown?.fix).toContain("keep google-services.json in the app's directory");
    // With the file in the app's directory it checks it, whoever builds the config.
    const found = run({ files: { "app.json": null, "app.config.ts": "export default {};\n", ...androidManifest(true) } }).push;
    expect(find(found, "google-services.json is JSON")?.status).toBe("pass");
    expect(find(found, "could not tell the app's Android package")?.status).toBe("unknown");
  });

  test("a push that is for iOS alone has no Google services file to look for", () => {
    const { push } = run({ files: { "app.json": appJson({ ios: { mode: "production" } }), "google-services.json": null } });
    expect(find(push, "has no capabilities.push.android")?.status).toBe("skip");
  });
});

describe("the iOS project", () => {
  test("a prebuild that wrote neither the entitlement nor the background mode is two failures, each with the fix", () => {
    const { push } = run({ files: ios({ environment: null, modes: null }) });
    const entitlement = find(push, "has no aps-environment");
    const modes = find(push, "does not list remote-notification in UIBackgroundModes");
    expect([entitlement?.status, modes?.status]).toEqual(["fail", "fail"]);
    expect(entitlement?.fix).toContain("npx expo prebuild --platform ios");
    expect(entitlement?.message).toContain("ios/App/App.entitlements");
  });

  test("the entitlement is read for either mode, and the background mode among others", () => {
    for (const environment of ["development", "production"]) {
      const { push } = run({ files: { "app.json": appJson({ ...fullPush, ios: { mode: environment } }), ...ios({ environment, modes: ["fetch", "remote-notification", "audio"] }) } });
      expect(find(push, `has aps-environment ${environment}`)?.status).toBe("pass");
      expect(find(push, "lists remote-notification")?.status).toBe("pass");
    }
  });

  test("an entitlement of another mode than the config's is a prebuild that is older than the config", () => {
    const { push } = run({ files: { "app.json": appJson({ ...fullPush, ios: { mode: "development" } }), ...ios() } });
    expect(find(push, "has aps-environment production, and capabilities.push.ios.mode is development")).toMatchObject({ status: "fail", message: expect.stringContaining("older than the config") });
  });

  test("a project without an entitlements file fails, and one without an Info.plist could not be read", () => {
    expect(find(run({ files: { ...ios(), "ios/App/App.entitlements": null } }).push, "has no .entitlements file")?.status).toBe("fail");
    expect(find(run({ files: { ...ios(), "ios/App/Info.plist": null } }).push, "could not read ios/App/Info.plist")?.status).toBe("unknown");
    expect(find(run({ files: { ...ios(), "ios/App/Info.plist": "bplist00\u0000" } }).push, "is a binary plist")?.status).toBe("unknown");
  });

  test("the app's directory is the project's name, else the one directory with an Info.plist; several are not guessed between", () => {
    const named = run({ files: { "ios/Other.xcodeproj/project.pbxproj": "", "ios/Other/Other.entitlements": entitlements("production"), "ios/Other/Info.plist": infoPlist(["remote-notification"]), "ios/Unrelated/Info.plist": infoPlist() } }).push;
    expect(find(named, "ios/Other/Other.entitlements has aps-environment production")?.status).toBe("pass");
    const single = run({ files: { "ios/Solo/Solo.entitlements": entitlements("production"), "ios/Solo/Info.plist": infoPlist(["remote-notification"]) } }).push;
    expect(find(single, "ios/Solo/Solo.entitlements has aps-environment production")?.status).toBe("pass");
    const several = run({ files: { "ios/A/Info.plist": infoPlist(), "ios/B/Info.plist": infoPlist() } }).push;
    expect(find(several, "could not find the iOS app in ios/")?.status).toBe("unknown");
  });

  test("a push for Android alone has no entitlement to look for, whatever ios/ holds", () => {
    const { push } = run({ files: { "app.json": appJson({ android: { googleServicesFile: "./google-services.json" } }), ...ios({ environment: null, modes: null }) } });
    expect(find(push, "has no capabilities.push.ios")?.status).toBe("skip");
    expect(failures(push)).toEqual([]);
  });

  test("the plist readers take what Expo writes", () => {
    expect(plistString(entitlements("development"), "aps-environment")).toBe("development");
    expect(plistString(entitlements(), "aps-environment")).toBeUndefined();
    expect(plistStrings(infoPlist(["fetch", "remote-notification"]), "UIBackgroundModes")).toEqual(["fetch", "remote-notification"]);
    expect(plistStrings(infoPlist(), "UIBackgroundModes")).toBeUndefined();
  });
});

describe("the report", () => {
  test("a failure of the push section fails the doctor (exit 1) with its fix under it; one that could not tell does not", () => {
    const failing = run({ files: { "google-services.json": googleServices("io.e.other") } });
    const lines: string[] = [];
    expect(runDoctor(failing.root, [], { write: (text) => { lines.push(text); } }, { ...tools })).toBe(1);
    expect(lines.join("")).toMatch(/\npush\n(?:.*\n)*? {2}FAIL {2}google-services\.json has no client for the app's package "io\.e\.a".*\n {8}fix: add an Android app/);
    const unknown = run({ files: { "app.json": appJson(fullPush, {}, null) } });
    expect(unknown.push.some((check) => check.status === "unknown")).toBe(true);
    expect(unknown.push.some((check) => check.status === "fail")).toBe(false);
  });

  test("it reads and writes nothing: the app's directory is as it was", () => {
    const { root } = run({ files: ios() });
    const listing = () => readdirSync(root, { recursive: true }).map(String).sort();
    const before = listing();
    runDoctor(root, [], { write: () => undefined }, { ...tools });
    expect(listing()).toEqual(before);
  });
});
