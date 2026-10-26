import { resolve } from "node:path";

export const qaDir = resolve(import.meta.dirname, "..");
export const platformDir = resolve(qaDir, "..");
export const repoRoot = resolve(platformDir, "../..");
export const androidDir = resolve(platformDir, "android");
export const outDir = resolve(qaDir, "out");
export const runsDir = resolve(qaDir, "runs");
export const reportPath = resolve(qaDir, "report.json");
export const gatesPath = resolve(qaDir, "gates.json");
export const svelteNativeCli = resolve(repoRoot, "packages/svelte-native/src/cli.ts");

export const emulatorLock = "/tmp/svelte-qa-emulator.lock";
export const gradleLock = "/tmp/svelte-qa-gradle.lock";
export const defaultPackage = "io.rasheed.svelteqa";
