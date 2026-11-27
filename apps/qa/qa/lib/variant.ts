import { join } from "node:path";
import { productApplicationId, qaApplicationId, smokeApplicationId } from "../../src/lib/native/app-ids.ts";
import { outDir } from "./paths.ts";

/**
 * The apps the harness builds. `qa` is `dev.alfayez.exposvelte.qa`, the app every gate measures (boot, frames, parity, accessibility,
 * crashes); `smoke` is `dev.alfayez.exposvelte.qa.smoke`, the same app plus a real app's native libraries (SPEC.md, "Native modules
 * (smoke test)"), which only the smoke run uses; `production` is the product (`dev.alfayez.exposvelte.qaproduct`, `APP_VARIANT=production`: no development
 * lab), built here for one purpose, the product boot check (`native-qa product`, Android emulator only). What ships is built by EAS.
 */
export type Variant = "qa" | "smoke" | "production";
export const variants: readonly Variant[] = ["qa", "smoke", "production"];

/** The application id (Android package, iOS bundle id) of each variant; `app.config.ts` sets the same ones. */
export const packageOf: Record<Variant, string> = { qa: qaApplicationId, smoke: smokeApplicationId, production: productApplicationId };
/** The executable of each iOS app, which names its crash reports (`<process>-<date>.ips`) in the phone's crash log. */
export const processNameOf: Record<Variant, string> = { qa: "ExpoSvelteQA", smoke: "Sveltesmoke", production: "SvelteQAproduct" };
/** The URL scheme of each variant: the apps on one device answer a scheme of their own each (the example app's is `expo-svelte://`). */
export const schemeOf: Record<Variant, string> = { qa: "expo-svelte-qa", smoke: "expo-svelte-qa-smoke", production: "svelte-qa-product" };
/** The `APP_VARIANT` a build of the variant runs with, always set, so one in the shell cannot turn one app into another (the library's own default is `app`, not `qa`). */
export const appVariantOf: Record<Variant, string> = { qa: "qa", smoke: "smoke", production: "production" };

/** `--variant`: absent is the QA app. */
export function variantFlag(value: string | boolean | undefined): Variant {
	if (value === undefined || value === "qa") return "qa";
	if (value === "smoke") return "smoke";
	if (value === "production") return "production";
	throw new Error(`--variant must be qa, smoke or production, not ${String(value)}`);
}

/**
 * What names the files of a build: the QA app keeps the names every other command reads (`app-x86_64.apk`, `build-x86_64.json`,
 * `ios-build.json`); the others carry the variant (`app-smoke-x86_64.apk`, `app-production-x86_64.apk`).
 */
export const stemOf = (variant: Variant, abi: string): string => (variant === "qa" ? abi : `${variant}-${abi}`);
export const apkPath = (variant: Variant, abi: string, directory: string = outDir): string => join(directory, `app-${stemOf(variant, abi)}.apk`);
export const buildLogName = (variant: Variant, abi: string): string => `build-${stemOf(variant, abi)}.log`;
export const iosBuildName = (variant: Variant): string => (variant === "qa" ? "ios-build.json" : "ios-build-smoke.json");
