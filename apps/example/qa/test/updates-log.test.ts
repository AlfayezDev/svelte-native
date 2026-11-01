import { describe, expect, test } from "bun:test";
import { sample } from "./sample.ts";
import { defaultSettle, launchSettled, parseUpdateObservation, runningId, type UpdateObservation } from "../lib/updates-log.ts";

const pkg = "io.rasheed.svelteqa";
const A = "01a19688-6ec1-7357-a10e-89ef0ba5fa07";
const B = "01a19689-1111-7222-a333-444455556666";
const stamp = "11-01 10:00:0";
let tick = 0;
/** One `logcat -v threadtime` line of the app's process (pid 4242) at a growing time. */
const line = (level: string, tag: string, message: string) => `${stamp}${Math.floor(tick / 100)}.${String(tick++ % 1000).padStart(3, "0")}  4242  4260 ${level} ${tag.padEnd(8)}: ${message}`;

const startProc = line("I", "ActivityManager", `Start proc 4242:${pkg}/u0a216 for next-top-activity {${pkg}/${pkg}.MainActivity}`);
const displayed = line("I", "ActivityTaskManager", `Displayed ${pkg}/.MainActivity for user 0: +612ms`);
const boot = line("I", "ReactNativeJS", "[Svelte boot] init 1 · polyfills 2 · first commit 21 · total 321 ms");
const probe = (fields: Record<string, unknown>) =>
	line("I", "ReactNativeJS", `[Svelte QA updates] ${JSON.stringify({ enabled: true, updateId: null, embedded: true, createdAt: 1_000, runtimeVersion: "0.1.0", channel: "qa", checkOnLaunch: "ALWAYS", marker: null, ...fields })}`);

const embeddedLaunch = [
	startProc,
	line("I", "SvelteUpdates", "Launching the embedded bundle (built 1761990000000)"),
	line("I", "ReactNativeJS", 'Running "main"'),
	boot,
	displayed,
	probe({}),
	line("I", "ReactNativeJS", `[Svelte updates] Update ${A} downloaded; it launches on the next start`),
].join("\n");

describe("parseUpdateObservation", () => {
	test("an embedded launch that downloaded an update", () => {
		const seen = parseUpdateObservation(embeddedLaunch, pkg);
		expect(seen.running).toEqual({ kind: "embedded", builtAt: 1761990000000 });
		expect(seen.booted).toBe(true);
		expect(seen.check).toEqual({ outcome: "downloaded", id: A });
		expect(seen.probe).toMatchObject({ enabled: true, channel: "qa", checkOnLaunch: "ALWAYS", marker: null, embedded: true });
		expect(seen.failedIds).toEqual([]);
		expect(seen.crashes + seen.jsErrors).toBe(0);
		expect(seen.displayMs).not.toBeNull();
		expect(runningId(seen)).toBeNull();
	});

	test("a launch of the downloaded update reports its id and the marker of its bundle", () => {
		const text = [
			startProc,
			line("I", "SvelteUpdates", `Launching update ${A} (created 1761990123456)`),
			boot,
			probe({ updateId: A, embedded: false, marker: "qa-20261101T100000Z-good" }),
			line("I", "ReactNativeJS", "[Svelte updates] No update to download (noUpdateAvailableOnServer)"),
		].join("\n");
		const seen = parseUpdateObservation(text, pkg);
		expect(seen.running).toEqual({ kind: "update", id: A, createdAt: 1761990123456 });
		expect(runningId(seen)).toBe(A);
		expect(seen.probe?.marker).toBe("qa-20261101T100000Z-good");
		expect(seen.check).toEqual({ outcome: "none", reason: "noUpdateAvailableOnServer" });
	});

	test("a bundle that throws before its first commit: no boot, a JS fatal, no check", () => {
		const text = [
			startProc,
			line("I", "SvelteUpdates", `Launching update ${B} (created 1761990200000)`),
			line("E", "BridgelessReact", "ReactHost{0}.handleHostException(message = \"Error: QA update fault: bundle qa-x-bad throws while it loads\")"),
		].join("\n");
		const seen = parseUpdateObservation(text, pkg);
		expect(runningId(seen)).toBe(B);
		expect(seen.booted).toBe(false);
		expect(seen.crashes).toBe(1);
		expect(seen.check).toBeNull();
		expect(seen.probe).toBeNull();
	});

	test("the start after it recovers: the failed id, the previous update, and the client's own refusal of the bad one", () => {
		const text = [
			startProc,
			line("W", "SvelteUpdates", `Update ${B} did not reach its first commit; launching the previous update or the embedded bundle`),
			line("I", "SvelteUpdates", `Launching update ${A} (created 1761990123456)`),
			boot,
			line("I", "ReactNativeJS", "[Svelte updates] No update to download (updatePreviouslyFailed)"),
		].join("\n");
		const seen = parseUpdateObservation(text, pkg);
		expect(seen.failedIds).toEqual([B]);
		expect(runningId(seen)).toBe(A);
		expect(seen.booted).toBe(true);
		expect(seen.check).toEqual({ outcome: "none", reason: "updatePreviouslyFailed" });
	});

	test("rollback directive, failed check (a quoted warning) and the first line of a kind wins", () => {
		expect(parseUpdateObservation(line("I", "ReactNativeJS", "[Svelte updates] Rolled back to the embedded bundle; it launches on the next start"), pkg).check).toEqual({ outcome: "rollback" });
		const failed = [line("W", "ReactNativeJS", "'[Svelte updates] Update check failed', Error: offline"), line("I", "ReactNativeJS", `[Svelte updates] Update ${A} downloaded; it launches on the next start`)].join("\n");
		expect(parseUpdateObservation(failed, pkg).check).toEqual({ outcome: "failed" });
		const twice = [line("I", "SvelteUpdates", "Launching the embedded bundle (built 5)"), line("I", "SvelteUpdates", `Launching update ${A} (created 6)`)].join("\n");
		expect(parseUpdateObservation(twice, pkg).running).toEqual({ kind: "embedded", builtAt: 5 });
	});

	test("a start that honoured the QA reset reports the token and what it forgot; one that did not reports none", () => {
		const text = [
			startProc,
			line("W", "SvelteUpdates", "QA reset (qa-20261101T102000Z): forgot 3 update(s), the failed list and the launch marker"),
			line("I", "SvelteUpdates", "Launching the embedded bundle (built 1761990000000)"),
		].join("\n");
		expect(parseUpdateObservation(text, pkg)).toMatchObject({ reset: { token: "qa-20261101T102000Z", forgotten: 3 }, running: { kind: "embedded", builtAt: 1761990000000 } });
		expect(parseUpdateObservation(embeddedLaunch, pkg).reset).toBeNull();
	});

	test("a malformed probe line is no probe, and a launch with no SvelteUpdates line runs nothing known", () => {
		const text = line("I", "ReactNativeJS", "[Svelte QA updates] {not json");
		const seen = parseUpdateObservation(text, pkg);
		expect(seen.probe).toBeNull();
		expect(seen.running).toBeNull();
	});
});

describe("launchSettled", () => {
	const observation = (overrides: Partial<UpdateObservation>): UpdateObservation => ({
		running: null, booted: false, probe: null, check: null, failedIds: [], reset: null, crashes: 0, jsErrors: 0, displayMs: null, ...overrides,
	});
	const probeOf = (checkOnLaunch: string) => ({ enabled: true, updateId: null, embedded: true, createdAt: null, runtimeVersion: "0.1.0", channel: "qa", checkOnLaunch, marker: null });

	test("a booted app that checks is done when the check ended, however early", () => {
		expect(launchSettled(observation({ booted: true, check: { outcome: "none", reason: "x" } }), 500)).toBe("check");
		expect(launchSettled(observation({ booted: true, probe: probeOf("ALWAYS") }), 20_000)).toBeNull();
	});
	test("a booted app that does not check is done a moment after the host booted", () => {
		expect(launchSettled(observation({ booted: true, probe: probeOf("NEVER") }), 1_000)).toBeNull();
		expect(launchSettled(observation({ booted: true, probe: probeOf("NEVER") }), defaultSettle.bootGraceMs)).toBe("boot");
	});
	test("a bundle that threw never boots: done a moment after its fatal", () => {
		expect(launchSettled(observation({ crashes: 1 }), 1_000)).toBeNull();
		expect(launchSettled(observation({ crashes: 1 }), defaultSettle.faultGraceMs)).toBe("fault");
	});
	test("a bundle that threw after its first commit did boot, and its host died before the check: done a moment after the fatal too", () => {
		expect(launchSettled(observation({ booted: true, crashes: 1 }), 1_000)).toBeNull();
		expect(launchSettled(observation({ booted: true, crashes: 1 }), defaultSettle.faultGraceMs)).toBe("fault");
		// The check ending first is the healthy case, whatever else was logged.
		expect(launchSettled(observation({ booted: true, crashes: 1, check: { outcome: "none", reason: "x" } }), 100)).toBe("check");
	});
	test("a launch that shows nothing ends at the timeout", () => {
		expect(launchSettled(observation({}), defaultSettle.timeoutMs - 1)).toBeNull();
		expect(launchSettled(observation({}), defaultSettle.timeoutMs)).toBe("timeout");
	});
});

describe("launches captured from the QA app built for the qa channel", () => {
	const SMOKE = "01a19688-6ec1-7357-a10e-89ef0ba5fa07";
	const GOOD = "01a19694-d84b-75f6-8727-26a4f2c91df4";
	const BAD = "01a19692-6f07-76ea-b454-69a0b2e78ada";

	test("the first start after a clean install: the embedded bundle, the app's report, and the update the check downloaded", () => {
		const seen = parseUpdateObservation(sample("updates-embedded-download.log"), pkg);
		expect(seen.running).toEqual({ kind: "embedded", builtAt: 1793526761514 });
		expect(seen.booted).toBe(true);
		expect(seen.probe).toEqual({ enabled: true, updateId: null, embedded: true, createdAt: 1793526761514, runtimeVersion: "0.1.0", channel: "qa", checkOnLaunch: "ALWAYS", marker: null });
		expect(seen.check).toEqual({ outcome: "downloaded", id: GOOD });
		expect(seen.displayMs).toBeNull(); // no Start proc line in this capture, so no pair
		expect(launchSettled(seen, 2_000)).toBe("check");
	});
	test("the start after it runs the update, and its bundle reports the update id", () => {
		const seen = parseUpdateObservation(sample("updates-update-run.log"), pkg);
		expect(runningId(seen)).toBe(GOOD);
		expect(seen.probe?.updateId).toBe(GOOD);
		expect(seen.probe?.embedded).toBe(false);
		expect(seen.check).toEqual({ outcome: "none", reason: "noUpdateAvailableOnServer" });
	});
	test("the bad update: launched, a JavaScript fatal, no first commit, nothing after it", () => {
		const seen = parseUpdateObservation(sample("updates-bad-launch.log"), pkg);
		expect(runningId(seen)).toBe(BAD);
		expect(seen.booted).toBe(false);
		expect(seen.crashes).toBe(1);
		expect(seen.jsErrors).toBe(1);
		expect(seen.check).toBeNull();
		expect(launchSettled(seen, 5_000)).toBeNull();
		expect(launchSettled(seen, 6_000)).toBe("fault");
	});
	test("the start after it: the failed id, the previous update, and the bad one refused by the client", () => {
		const seen = parseUpdateObservation(sample("updates-recovered-launch.log"), pkg);
		expect(seen.failedIds).toEqual([BAD]);
		expect(runningId(seen)).toBe(SMOKE);
		expect(seen.booted).toBe(true);
		expect(seen.probe?.marker).toBe("qa-smoke-1");
		expect(seen.check).toEqual({ outcome: "none", reason: "updatePreviouslyFailed" });
	});
	test("a later start does not try the bad update again", () => {
		const seen = parseUpdateObservation(sample("updates-blocked-check.log"), pkg);
		expect(runningId(seen)).toBe(SMOKE);
		expect(seen.failedIds).toEqual([]);
		expect(seen.check).toEqual({ outcome: "none", reason: "updatePreviouslyFailed" });
		expect(seen.displayMs).toBeNull();
	});
});
