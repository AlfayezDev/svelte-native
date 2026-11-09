import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { qaApplicationId } from "../../src/lib/native/app-ids.ts";

export const qaDir = resolve(import.meta.dirname, "..");
export const platformDir = resolve(qaDir, "..");
export const repoRoot = resolve(platformDir, "../..");
export const androidDir = resolve(platformDir, "android");
export const outDir = resolve(qaDir, "out");
export const runsDir = resolve(qaDir, "runs");
export const reportPath = resolve(qaDir, "report.json");
export const gatesPath = resolve(qaDir, "gates.json");
/**
 * The library the way the example app resolves it, through its dependency (`node_modules/@rasheed/svelte-native`: a link to the workspace package here, a copy of
 * the git tag in an app of its own): its CLI, its Expo plugin and its native modules are found from here and not by a path into `packages/`.
 */
export const svelteNativeDir = dirname(createRequire(join(platformDir, "package.json")).resolve("@rasheed/svelte-native/package.json"));
export const svelteNativeCli = join(svelteNativeDir, "src/cli.ts");
/** The CLI as a command run from the app's directory on another machine, where only the app's `node_modules` is known. */
export const svelteNativeCliFromApp = "node node_modules/@rasheed/svelte-native/src/cli.ts";

export const emulatorLock = "/tmp/svelte-qa-emulator.lock";
export const gradleLock = "/tmp/svelte-qa-gradle.lock";
/** The QA app. The smoke app's id is `packageOf.smoke` (variant.ts). */
export const defaultPackage = qaApplicationId;
