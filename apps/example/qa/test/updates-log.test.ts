import { describe, expect, test } from "bun:test";
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

	test("a malformed probe line is no probe, and a launch with no SvelteUpdates line runs nothing known", () => {
		const text = line("I", "ReactNativeJS", "[Svelte QA updates] {not json");
		const seen = parseUpdateObservation(text, pkg);
		expect(seen.probe).toBeNull();
		expect(seen.running).toBeNull();
	});
});

describe("launchSettled", () => {
	const observation = (overrides: Partial<UpdateObservation>): UpdateObservation => ({
		running: null, booted: false, probe: null, check: null, failedIds: [], crashes: 0, jsErrors: 0, displayMs: null, ...overrides,
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
	test("a launch that shows nothing ends at the timeout", () => {
		expect(launchSettled(observation({}), defaultSettle.timeoutMs - 1)).toBeNull();
		expect(launchSettled(observation({}), defaultSettle.timeoutMs)).toBe("timeout");
	});
});
