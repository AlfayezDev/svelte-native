import { join } from "node:path";
import { qaApplicationId, smokeApplicationId } from "../../src/lib/native/app-ids.ts";
import { outDir } from "./paths.ts";

/**
 * The two apps the harness builds. `qa` is `io.rasheed.svelteqa`, the app every gate measures (boot, frames, parity, accessibility,
 * crashes); `smoke` is `io.rasheed.svelteqa.smoke`, the same app plus the production app's native libraries (SPEC.md, "Native modules
 * (smoke test)"), which only the smoke run uses. The product (`io.rasheed.app`) is built by EAS, not here.
 */
export type Variant = "qa" | "smoke";
export const variants: readonly Variant[] = ["qa", "smoke"];

/** The application id (Android package, iOS bundle id) of each variant; `app.config.ts` sets the same ones. */
export const packageOf: Record<Variant, string> = { qa: qaApplicationId, smoke: smokeApplicationId };
/** The URL scheme of each variant: two apps on one device must not both answer `rasheed-svelte://`. */
export const schemeOf: Record<Variant, string> = { qa: "rasheed-svelte", smoke: "rasheed-svelte-smoke" };
/** The `APP_VARIANT` a build of the variant runs with (empty: the QA app, whatever the shell has). */
export const appVariantOf: Record<Variant, string> = { qa: "", smoke: "smoke" };

/** `--variant`: absent is the QA app. */
export function variantFlag(value: string | boolean | undefined): Variant {
	if (value === undefined || value === "qa") return "qa";
	if (value === "smoke") return "smoke";
	throw new Error(`--variant must be qa or smoke, not ${String(value)}`);
}

/**
 * What names the files of a build: the QA app keeps the names every other command reads (`app-x86_64.apk`, `build-x86_64.json`,
 * `ios-build.json`); the smoke app's carry the variant (`app-smoke-x86_64.apk`).
 */
export const stemOf = (variant: Variant, abi: string): string => (variant === "qa" ? abi : `smoke-${abi}`);
export const apkPath = (variant: Variant, abi: string, directory: string = outDir): string => join(directory, `app-${stemOf(variant, abi)}.apk`);
export const buildLogName = (variant: Variant, abi: string): string => `build-${stemOf(variant, abi)}.log`;
export const iosBuildName = (variant: Variant): string => (variant === "qa" ? "ios-build.json" : "ios-build-smoke.json");
