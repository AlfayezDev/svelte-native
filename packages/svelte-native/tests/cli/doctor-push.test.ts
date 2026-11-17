import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pushSettings } from "../../src/capabilities.ts";
import { runChecks, type Check } from "../../src/doctor/checks.ts";
import { formatReport, runDoctor } from "../../src/doctor/index.ts";
import { plistStrings, plistString } from "../../src/doctor/push.ts";
import { otherPushLibraries, pushPackage } from "../../src/push/config.ts";
import { libraryVersion } from "../support/versions.ts";
import { library, makeFakeApp, nativePeers, repository } from "./support/doctor-fixture.ts";

// The push section of `svelte-native doctor` (src/doctor/push.ts) against fake apps: what it says of the push package, the Google services file, and the iOS files the last prebuild
// wrote, from reading files alone. The `--server` half, which makes requests, is in tests/push/cli.test.ts.

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
  /** The version of the installed push package; `null`: not installed. Default the library's. */
  version?: string | null;
  /** The app's package.json lists the push package. Default true. */
  declared?: boolean;
  /** Other packages the app depends on, and the ones that are installed. */
  dependencies?: string[];
  installed?: string[];
  files?: Record<string, string | null>;
};

/** The doctor's checks for a fake app with the push package, as `options` says, and `files` over the defaults: an `app.json` with push on and a Google services file for `io.e.a`. */
function run(options: PushApp = {}): { root: string; checks: Check[]; push: Check[] } {
  const version = options.version === undefined ? libraryVersion : options.version;
  const dependencies = { [library.name]: "*", ...Object.fromEntries(nativePeers.map((name) => [name, "*"])), ...(options.declared === false ? {} : { [pushPackage]: "*" }), ...Object.fromEntries((options.dependencies ?? []).map((name) => [name, "*"])) };
  const stubs = Object.fromEntries([...(version === null ? [] : [[pushPackage, version]]), ...(options.installed ?? []).map((name) => [name, "1.0.0"])].map(([name, installed]) => [`node_modules/${name}/package.json`, JSON.stringify({ name, version: installed })]));
  const root = makeFakeApp({
    files: { "package.json": JSON.stringify({ name: "fake-app", version: "1.0.0", dependencies }), "app.json": appJson(fullPush), "google-services.json": googleServices("io.e.a"), ...stubs, ...options.files },
  });
  apps.push(root);
  const checks = runChecks({ appRoot: root, packageRoot: join(repository, "packages/svelte-native"), ...tools });
  return { root, checks, push: checks.filter((check) => check.group === "push") };
}
const find = (checks: Check[], text: string) => checks.find((check) => check.message.includes(text));
const statuses = (checks: Check[]) => checks.map((check) => check.status);
const failures = (checks: Check[]) => checks.filter((check) => check.status === "fail");

const entitlements = (environment?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n  <dict>${environment ? `\n    <key>aps-environment</key>\n    <string>${environment}</string>` : ""}\n  </dict>\n</plist>\n`;
const infoPlist = (modes?: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n    <key>CFBundleName</key>\n    <string>App</string>${modes ? `\n    <key>UIBackgroundModes</key>\n    <array>${modes.map((mode) => `\n      <string>${mode}</string>`).join("")}\n    </array>` : ""}\n  </dict>\n</plist>\n`;
/** The iOS project a prebuild writes: `ios/App.xcodeproj`, the entitlements and the Info.plist of the app (`null`: without the entitlement, or without background modes). */
const ios = ({ environment = "production", modes = ["remote-notification"] }: { environment?: string | null; modes?: string[] | null } = {}): Record<string, string> => ({
  "ios/App.xcodeproj/project.pbxproj": "",
  "ios/App/App.entitlements": entitlements(environment ?? undefined),
  "ios/App/Info.plist": infoPlist(modes ?? undefined),
});

describe("an app with push that is set up", () => {
  const { push } = run();

  test("passes its checks: the package, no other push library, the capability, the Google services file and its client; the iOS files wait for a prebuild", () => {
    expect(push.map((check) => [check.status, check.message])).toEqual([
      ["pass", `${pushPackage} ${libraryVersion} is a dependency of the app and matches ${library.name} ${libraryVersion}`],
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
    expect(text).toMatch(/\npush\n {2}pass {2}@alfayez\/svelte-native-push /);
  });

  test("with the iOS project of the last prebuild, the entitlement and the background mode pass too", () => {
    const { push: withIos } = run({ files: ios() });
    expect(statuses(withIos)).toEqual(Array(7).fill("pass"));
    expect(withIos.at(-2)?.message).toBe("ios/App/App.entitlements has aps-environment production");
    expect(withIos.at(-1)?.message).toBe("ios/App/Info.plist lists remote-notification in UIBackgroundModes");
  });
});

describe("an app with no push", () => {
  test("has no push line at all", () => {
    const { checks } = run({ version: null, declared: false, files: { "app.json": appJson(undefined), "google-services.json": null } });
    expect(checks.filter((check) => check.group === "push")).toEqual([]);
    // The app of the other doctor tests, which has never heard of push.
    const plain = runChecks({ appRoot: makeFakeApp(), packageRoot: join(repository, "packages/svelte-native"), ...tools });
    expect(plain.some((check) => check.group === "push")).toBe(false);
  });

  test("but one whose app.json turns the capability on is an app with push, and says its package is missing", () => {
    const { push } = run({ version: null, declared: false });
    expect(find(push, `${pushPackage} is not installed`)).toMatchObject({ status: "fail" });
  });
});

describe("the push package", () => {
  test("not installed, though it is a dependency: install", () => {
    const { push } = run({ version: null });
    expect(push[0]).toMatchObject({ status: "fail", message: `${pushPackage} is a dependency of the app but is not installed`, fix: "pnpm install" });
  });

  test("not installed and not a dependency: the fix is the same tag as the library", () => {
    const { push } = run({ version: null, declared: false });
    expect(push[0]?.status).toBe("fail");
    expect(push[0]?.fix).toContain(`#v${libraryVersion}&path:packages/svelte-native-push`);
  });

  test("another version than the library's is a failure that says to install the same tag", () => {
    const { push } = run({ version: "0.0.1" });
    expect(push[0]).toMatchObject({ status: "fail", message: expect.stringContaining(`${pushPackage} 0.0.1 does not match ${library.name} ${libraryVersion}`) });
    expect(push[0]?.fix).toContain("install the same tag");
    expect(push[0]?.fix).toContain(`#v${libraryVersion}`);
  });

  test("installed but not a dependency of the app: autolinking would not link it", () => {
    const { push } = run({ declared: false });
    expect(push[0]?.status).toBe("fail");
    expect(push[0]?.message).toContain("is installed but is not a dependency of the app");
    expect(push[0]?.message).toContain("autolinking links only the app's own dependencies");
  });

  for (const other of otherPushLibraries) {
    test(`${other} beside it is a failure: an app has one push library`, () => {
      const installed = run({ installed: [other] }).push;
      expect(find(installed, `${other} is installed beside ${pushPackage}`)).toMatchObject({ status: "fail", fix: expect.stringContaining(`pnpm remove ${other}`) });
      expect(find(installed, "one push library")?.message).toContain("FirebaseMessagingService");
      expect(find(installed, "no other push library")).toBeUndefined();
      // Declared and not installed yet (a pnpm install is due) is as much a second library.
      expect(find(run({ dependencies: [other] }).push, `${other} is installed beside`)?.status).toBe("fail");
    });
  }
});

describe("the capability", () => {
  test("an app.json whose plugin has no capabilities.push, with the push package installed, is a failure the prebuild would make too", () => {
    const { push } = run({ files: { "app.json": appJson(undefined) } });
    expect(find(push, "does not turn capabilities.push on")).toMatchObject({ status: "fail" });
    // A capability that is off has no platform to check.
    expect(push.filter((check) => /google-services|aps-environment/.test(check.message))).toEqual([]);
  });

  test("a plugin listed by name alone, and `push: false`, are off", () => {
    for (const config of [JSON.stringify({ expo: { plugins: [library.name] } }), appJson(false)]) {
      expect(find(run({ files: { "app.json": config } }).push, "does not turn capabilities.push on")?.status).toBe("fail");
    }
  });

  test("with an app.config.ts the doctor cannot say it is off: it says what it could not find, not that the capability is missing", () => {
    const { push } = run({ files: { "app.json": JSON.stringify({ expo: { name: "fake" } }), "app.config.ts": "export default ({ config }) => config;\n", "google-services.json": null } });
    expect(find(push, "does not turn capabilities.push on")).toBeUndefined();
    expect(find(push, "could not find the Google services file")).toMatchObject({ status: "unknown" });
    expect(find(push, "app.config.ts is code that the doctor does not run")).toBeDefined();
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

  test("a file the config does not name is found in the app's directory (google-services*.json, the plain name first), or as the prebuild's copy", () => {
    const unnamed = appJson({ android: {}, ios: { mode: "production" } });
    expect(find(run({ files: { "app.json": unnamed, "google-services.json": null, "google-services.dev.json": googleServices("io.e.a") } }).push, "google-services.dev.json is JSON")?.status).toBe("pass");
    const both = run({ files: { "app.json": unnamed, "google-services.json": googleServices("io.e.a"), "google-services.dev.json": googleServices("io.e.other") } }).push;
    expect(find(both, "google-services.json is JSON")?.status).toBe("pass");
    expect(find(both, "google-services.dev.json")).toBeUndefined();
    const copy = run({ files: { "app.json": unnamed, "google-services.json": null, "android/app/google-services.json": googleServices("io.e.a") } }).push;
    expect(find(copy, "android/app/google-services.json is JSON")?.status).toBe("pass");
  });

  test("the file android.googleServicesFile of the config names counts when the plugin does not", () => {
    const config = JSON.stringify({ expo: { name: "fake", android: { package: "io.e.a", googleServicesFile: "./config/firebase.json" }, plugins: [[library.name, { capabilities: { push: { android: {} } } }]] } });
    const { push } = run({ files: { "app.json": config, "google-services.json": null, "config/firebase.json": googleServices("io.e.a") } });
    expect(find(push, "config/firebase.json is JSON")?.status).toBe("pass");
  });

  test("an app.config.ts and no file at all: it could not tell, and says how to let it", () => {
    const { push } = run({ files: { "app.json": null, "app.config.ts": "export default {};\n", "google-services.json": null } });
    const unknown = find(push, "could not find the Google services file");
    expect(unknown).toMatchObject({ status: "unknown" });
    expect(unknown?.fix).toContain("keep google-services.json in the app's directory");
    // With the file in the app's directory it checks it, whoever builds the config.
    const found = run({ files: { "app.json": null, "app.config.ts": "export default {};\n" } }).push;
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
