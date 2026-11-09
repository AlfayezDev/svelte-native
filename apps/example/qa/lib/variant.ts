import { join } from "node:path";
import { productApplicationId, qaApplicationId, smokeApplicationId } from "../../src/lib/native/app-ids.ts";
import { outDir } from "./paths.ts";

/**
 * The apps the harness builds. `qa` is `io.example.svelteqa`, the app every gate measures (boot, frames, parity, accessibility,
 * crashes); `smoke` is `io.example.svelteqa.smoke`, the same app plus the production app's native libraries (SPEC.md, "Native modules
 * (smoke test)"), which only the smoke run uses; `production` is the product (`io.example.app`, `APP_VARIANT=production`: no development
 * lab), built here for one purpose, the product boot check (`native-qa product`, Android emulator only). What ships is built by EAS.
 */
export type Variant = "qa" | "smoke" | "production";
export const variants: readonly Variant[] = ["qa", "smoke", "production"];

/** The application id (Android package, iOS bundle id) of each variant; `app.config.ts` sets the same ones. */
export const packageOf: Record<Variant, string> = { qa: qaApplicationId, smoke: smokeApplicationId, production: productApplicationId };
/** The executable of each iOS app, which names its crash reports (`<process>-<date>.ips`) in the phone's crash log. */
export const processNameOf: Record<Variant, string> = { qa: "ExampleSvelteQA", smoke: "Sveltesmoke", production: "Example" };
/** The URL scheme of each variant: two apps on one device must not both answer `example-svelte://`. */
export const schemeOf: Record<Variant, string> = { qa: "example-svelte", smoke: "example-svelte-smoke", production: "example" };
/** The `APP_VARIANT` a build of the variant runs with (empty: the QA app, whatever the shell has). */
export const appVariantOf: Record<Variant, string> = { qa: "", smoke: "smoke", production: "production" };

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
