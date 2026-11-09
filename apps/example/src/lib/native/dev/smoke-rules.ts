import type { SmokeResult } from "./smoke-log.ts";

/** Decisions of the native module smoke test that need no React Native, so the harness's tests load them. */

/** Every module id the test reports, in run order; `qa/gates.json` pins the same list and a test compares it with the checks. */
export const smokeModules: readonly string[] = [
	"async-storage",
	"mmkv",
	"secure-store",
	"netinfo",
	"device-info",
	"expo-device",
	"get-random-values",
	"quick-crypto",
	"quick-base64",
	"nitro",
	"launch-arguments",
	"localization",
	"constants",
	"asset",
	"haptics",
	"screen-orientation",
	"store-review",
	"system-ui",
	"tracking-transparency",
	"local-authentication",
	"notifications",
	"location",
	"sharing",
	"web-browser",
	"splash-screen",
	"ssl-pinning",
	"firebase",
	"sentry",
	"hms",
	"intercom",
	"statsig",
	"mixpanel",
	"adjust",
	"check-installed-apps",
	"live-direction",
];

/** The native modules the HMS location library registers on Android. */
export const hmsNativeModules = ["HMSFusedLocation", "HMSLocationKit", "HMSGeofence", "HMSGeocoder", "HMSActivityIdentification"] as const;

const huawei = /^(huawei|honor)$/i;

/**
 * The HMS location library loaded; what the device is decides what that means. No native module registered: the library did not
 * link (`fail`). On a Huawei or Honor device (HMS Core is theirs) the registered modules are the load the test is after (`ok`).
 * On any other device the library is linked but HMS Core is not there to call: `skip`, and `gates.json` lists that skip as expected.
 */
export function hmsOutcome(manufacturer: string | null | undefined, registered: readonly string[]): { status: "ok" | "skip" | "fail"; detail: string } {
	if (registered.length === 0) return { status: "fail", detail: "loaded, but no HMS native module is registered: the library is not linked" };
	const modules = `${registered.length} native modules registered (${registered.join(", ")})`;
	if (manufacturer !== null && manufacturer !== undefined && huawei.test(manufacturer.trim())) return { status: "ok", detail: `loaded on a ${manufacturer} device, ${modules}; HMS calls not made` };
	return { status: "skip", detail: `not a Huawei device (${manufacturer ?? "unknown manufacturer"}): loaded, ${modules}; HMS Core, which the calls need, is Huawei-only` };
}

/**
 * The verdict of the lab's `smoke` scenario: a pass is every pinned module reported and none failed. A run that reported nothing, or
 * only some of the modules (it was stopped, or the call that never returned ended it), is not a pass.
 */
export function smokeScenarioOutcome(results: readonly SmokeResult[], expected: number): { verdict: "pass" | "fail"; summary: string } {
	const count = (status: string) => results.filter((result) => result.status === status).length;
	const failed = results.filter((result) => result.status === "fail").map((result) => result.module);
	const tally = `${count("ok")} ok · ${failed.length} fail · ${count("skip")} skip of ${results.length}`;
	if (results.length !== expected) return { verdict: "fail", summary: `${tally} · ${results.length} of ${expected} modules reported${failed.length ? ` · failed: ${failed.join(", ")}` : ""}` };
	return { verdict: failed.length === 0 ? "pass" : "fail", summary: `${tally}${failed.length ? ` · failed: ${failed.join(", ")}` : ""}` };
}
