import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, type Gate, type GatesFile } from "../lib/gates.ts";
import type { Launch } from "../lib/types.ts";
import {
	bootComparison,
	parsePublished,
	publishArguments,
	publishEnvironment,
	runUpdatesScenario,
	updatesMetrics,
	type PublishedUpdate,
	type UpdateKind,
	type UpdateLaunch,
	type UpdatesDriver,
	type UpdatesFile,
} from "../lib/updates.ts";
import { gateKinds } from "../lib/gates.ts";

/**
 * A model of the client (`UpdateStore.select`, `markLaunched`, the check of `client.ts`) behind the harness's driver, so the scenario's
 * counting is tested against the policy it measures: the check runs after the first commit, a downloaded update runs from the next
 * start, an update that never reached its first commit is failed at the next start and is not downloaded again.
 */
class ClientWorld implements UpdatesDriver {
	embeddedAt = 1_000;
	clock = 1_000;
	/** What the channel serves: the last one published is the newest. */
	channel: (PublishedUpdate & { at: number; bad: boolean })[] = [];
	store = new Map<string, { status: "ready" | "failed"; at: number }>();
	/** The update a start is launching, until its first commit. */
	pending: string | null = null;
	failedIds: string[] = [];
	index = 0;
	published: PublishedUpdate[] = [];
	/** Ways to make the model misbehave. */
	faultNeverFires = false;
	forgetFailed = false;
	markerMissing = false;
	checksThatSeeNothing = 0;
	bootLaunches: Launch[] = [];

	async publish(kind: UpdateKind): Promise<PublishedUpdate> {
		const at = ++this.clock * 1000;
		const update = { kind, id: `00000000-0000-0000-0000-${String(at).padStart(12, "0")}`, group: `g${at}`, marker: `qa-test-${kind}`, message: "", createdAt: String(at), at, bad: kind === "bad" };
		this.channel.push(update);
		this.published.push(update);
		return update;
	}

	async launch(phase: UpdateLaunch["phase"]): Promise<UpdateLaunch> {
		const index = ++this.index;
		const failedIds: string[] = [];
		if (this.pending !== null) {
			if (!this.forgetFailed) {
				this.store.set(this.pending, { status: "failed", at: this.store.get(this.pending)?.at ?? 0 });
				this.failedIds.push(this.pending);
			}
			failedIds.push(this.pending);
			this.pending = null;
		}
		const ready = [...this.store].filter(([, entry]) => entry.status === "ready" && entry.at > this.embeddedAt).sort((a, b) => b[1].at - a[1].at);
		const chosen = ready[0]?.[0] ?? null;
		const running = chosen ? ({ kind: "update", id: chosen, createdAt: this.store.get(chosen)?.at ?? 0 } as const) : ({ kind: "embedded", builtAt: this.embeddedAt } as const);
		if (chosen) this.pending = chosen;
		const throws = chosen !== null && this.channel.find((update) => update.id === chosen)?.bad === true && !this.faultNeverFires;
		const base = { index, phase, failedIds, crashes: throws ? 1 : 0, jsErrors: 0, displayMs: throws ? null : 600 };
		if (throws) return { ...base, running, booted: false, probe: null, check: null, settledBy: "fault" };
		this.pending = null; // the first commit
		const marker = chosen && !this.markerMissing ? (this.channel.find((update) => update.id === chosen)?.marker ?? null) : null;
		const probe = { enabled: true, updateId: chosen, embedded: chosen === null, createdAt: null, runtimeVersion: "0.1.0", channel: "qa", checkOnLaunch: "ALWAYS", marker };
		const runningAt = chosen ? (this.store.get(chosen)?.at ?? 0) : this.embeddedAt;
		const latest = this.channel.at(-1);
		let check: UpdateLaunch["check"];
		if (this.checksThatSeeNothing > 0) {
			this.checksThatSeeNothing--;
			check = { outcome: "none", reason: "noUpdateAvailableOnServer" };
		} else if (!latest || latest.at <= runningAt) check = { outcome: "none", reason: "noUpdateAvailableOnServer" };
		else if (this.store.get(latest.id)?.status === "failed" || this.failedIds.includes(latest.id)) check = { outcome: "none", reason: "updatePreviouslyFailed" };
		else {
			this.store.set(latest.id, { status: "ready", at: latest.at });
			check = { outcome: "downloaded", id: latest.id };
		}
		return { ...base, running, booted: true, probe, check, settledBy: "check" };
	}

	async bootSeries(): Promise<Launch[]> {
		return this.bootLaunches;
	}
}

const gatesJson = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
const options = { maxLaunches: 4, settleLaunches: 3 };

describe("the scenario against the client's policy", () => {
	test("a good update runs on the second start, a bad one is recovered from and never tried again, the channel ends healthy", async () => {
		const world = new ClientWorld();
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.errors).toEqual([]);
		expect(scenario.baselineEmbedded).toBe(true);
		expect(scenario.good).toMatchObject({ applied: true, launchesToApply: 2, markerSeen: true });
		expect(scenario.bad).toMatchObject({ faultTriggered: true, rolledBack: true, retried: 0, blockedChecks: 4, launchesAfter: 4 });
		// The previous good update, not the embedded bundle: it is newer than the embedded one.
		expect(scenario.bad.rolledBackTo).toBe(scenario.good.published?.id ?? "");
		expect(scenario.bad.failedIdReported).toBe(scenario.bad.published?.id ?? "");
		expect(scenario.cleanup.healthy).toBe(true);
		expect(scenario.unexpectedFaults).toBe(0);
		// The channel's newest update is the clean-up, and it is good.
		expect(world.channel.at(-1)).toMatchObject({ kind: "cleanup", bad: false });
		expect(world.published.map((update) => update.kind)).toEqual(["good", "bad", "cleanup"]);
	});

	test("launches are counted from the publish: an update the first start does not see takes a third start", async () => {
		const world = new ClientWorld();
		const originalPublish = world.publish.bind(world);
		world.publish = async (kind) => {
			const update = await originalPublish(kind);
			if (kind === "good") world.checksThatSeeNothing = 1;
			return update;
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.good.launchesToApply).toBe(3);
		expect(scenario.good.applied).toBe(true);
	});

	test("with no previous update to return to the start after the bad one runs the embedded bundle", async () => {
		const world = new ClientWorld();
		const originalPublish = world.publish.bind(world);
		// The good update is gone from the store (cleaned away) when the bad one is published.
		world.publish = async (kind) => {
			if (kind === "bad") world.store.clear();
			return originalPublish(kind);
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.bad).toMatchObject({ rolledBack: true, rolledBackTo: "embedded", retried: 0 });
		expect(scenario.errors).toEqual([]);
	});

	test("a client that forgets a failed update keeps retrying it: badRetried counts, rolledBack still sees the first recovery", async () => {
		const world = new ClientWorld();
		world.forgetFailed = true;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.bad.retried).toBeGreaterThan(0);
		expect(scenario.errors.some((error) => error.includes("tried again"))).toBe(true);
		const metrics = updatesMetrics(file(scenario));
		expect(metrics["updates.badRetried"]).toBeGreaterThan(0);
	});

	test("a bad update whose fault does not fire is a failed run, not a rollback", async () => {
		const world = new ClientWorld();
		world.faultNeverFires = true;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.bad.faultTriggered).toBe(false);
		expect(scenario.bad.rolledBack).toBe(false);
		expect(scenario.errors.some((error) => error.includes("fault planted in its bundle did not fire"))).toBe(true);
	});

	test("an update that runs without its marker is not applied: the bundle that executes is not the published one", async () => {
		const world = new ClientWorld();
		world.markerMissing = true;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.good.applied).toBe(false);
		expect(scenario.good.markerSeen).toBe(false);
		expect(scenario.errors.some((error) => error.includes("not the one that was published"))).toBe(true);
	});

	test("the clean-up runs when the bad step fails, so the channel never ends on a bad update", async () => {
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		world.launch = async (phase) => {
			if (phase === "rollback") throw new Error("the device went away");
			return launch(phase);
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.errors.some((error) => error.includes("bad update: the device went away"))).toBe(true);
		expect(world.published.map((update) => update.kind)).toEqual(["good", "bad", "cleanup"]);
		expect(world.channel.at(-1)?.kind).toBe("cleanup");
	});

	test("a failed publish of the good update still leaves nothing to clean up when nothing was published", async () => {
		const world = new ClientWorld();
		world.publish = async () => {
			throw new Error("eas update failed (exit 1)");
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.errors.filter((error) => error.includes("eas update failed")).length).toBe(2);
		expect(world.published).toEqual([]);
		expect(scenario.cleanup.published).toBeNull();
	});

	test("a build without a channel is reported as such", async () => {
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		world.launch = async (phase) => {
			const result = await launch(phase);
			return result.probe ? { ...result, probe: { ...result.probe, checkOnLaunch: "NEVER", channel: null } } : result;
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.errors[0]).toContain("does not check for updates");
	});

	test("faults in launches other than the bad one are counted", async () => {
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		world.launch = async (phase) => {
			const result = await launch(phase);
			return phase === "settled" && result.index % 2 === 0 ? { ...result, jsErrors: 1 } : result;
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.unexpectedFaults).toBeGreaterThan(0);
	});
});

function file(scenario: Awaited<ReturnType<typeof runUpdatesScenario>>, boot = bootComparison([], [], null)): UpdatesFile {
	return {
		schema: 1,
		kind: "updates",
		startedAt: "2026-11-01T10:00:00.000Z",
		finishedAt: "2026-11-01T10:30:00.000Z",
		source: { commit: "abc", dirty: false },
		device: { serial: "localhost:5555", platform: "android", kind: "emulator", model: "x", osVersion: "16", sdk: 36, abi: "x86_64", refreshHz: 60 },
		app: { package: "io.rasheed.svelteqa", versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256: "aa", apk: null },
		channel: "qa",
		runtimeVersion: "0.1.0",
		build: null,
		eas: { command: "eas", environment: "development" },
		options,
		scenario,
		boot,
		logFile: "runs/x.log",
	};
}

const launchOf = (index: number, displayMs: number | null, js: number | null, error: string | null = null): Launch => ({
	index, displayMs, runningMainMs: null, displayedReportedMs: null, totalTimeMs: null, jsMarks: js === null ? null : { total: js }, crashes: 0, jsErrors: 0, engineWarnings: 0, error,
});

describe("boot comparison", () => {
	test("the channel build against the same app without a channel, nearest-rank percentiles", () => {
		const enabled = [300, 310, 320, 330, 340, 350, 360, 370, 380, 400].map((ms, index) => launchOf(index + 1, ms, ms - 100));
		const baseline = [290, 295, 300, 305, 310, 315, 320, 325, 330, 340].map((ms, index) => launchOf(index + 1, ms, ms - 100));
		const boot = bootComparison(enabled, baseline, { sha256: "bb", commit: "abc", dirty: false });
		expect(boot.enabled).toMatchObject({ samples: 10, p50: 340, p90: 380, jsTotalP90: 280 });
		expect(boot.baseline).toMatchObject({ p50: 310, p90: 330 });
		expect(boot.delta).toEqual({ p50: 30, p90: 50, jsTotalP90: 50 });
	});
	test("no baseline build, no delta; a launch without a display time is a failure, not a sample", () => {
		const boot = bootComparison([launchOf(1, 300, 200), launchOf(2, null, null, "no Start proc to Displayed pair in logcat")], [], null);
		expect(boot.enabled).toMatchObject({ samples: 1, failed: 1 });
		expect(boot.baseline).toBeNull();
		expect(boot.delta).toBeNull();
	});
});

describe("metrics and gates", () => {
	const gates = gatesJson.gates.filter((gate: Gate) => gate.metric.startsWith("updates."));

	test("the gates named for the run are in gates.json and belong to the updates run kind", () => {
		expect(gates.map((gate) => gate.id)).toEqual(["updates.applied", "updates.rolledBack", "updates.badRetried", "updates.unexpectedFaults", "updates.channelHealthy"]);
		for (const gate of gates) {
			expect(gateKinds(gate)).toEqual(["updates"]);
			expect(Object.keys(gate.bar)).toEqual(["android"]);
		}
		expect(gates.find((gate) => gate.id === "updates.badRetried")?.bar.android).toEqual({ max: 0 });
	});

	test("a healthy run passes every gate and keeps the boot numbers out of them", async () => {
		const scenario = await runUpdatesScenario(new ClientWorld(), options);
		const metrics = updatesMetrics(file(scenario, bootComparison([launchOf(1, 320, 220)], [launchOf(1, 300, 200)], null)));
		expect(metrics).toMatchObject({ "updates.applied": 1, "updates.launchesToApply": 2, "updates.rolledBack": 1, "updates.badRetried": 0, "updates.unexpectedFaults": 0, "updates.channelHealthy": 1, "updates.boot.warm.p50Delta": 20 });
		const rows = evaluate(gates, { "localhost:5555": { platform: "android", role: "lab", runs: ["lab", "updates"], metrics } });
		expect(rows.map((row) => row.verdict)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
	});

	test("a failed step is a 0, which fails its gate; a device that does not provide the run sees the gates informational", async () => {
		const world = new ClientWorld();
		world.forgetFailed = true;
		const metrics = updatesMetrics(file(await runUpdatesScenario(world, options)));
		const failing = evaluate(gates, { "localhost:5555": { platform: "android", role: "lab", runs: ["updates"], metrics } });
		expect(failing.find((row) => row.id === "updates.badRetried")?.verdict).toBe("fail");
		const notProvided = evaluate(gates, { R58Y90KNGRP: { platform: "android", role: "phone", runs: ["lab", "boot"], metrics: {} } });
		expect(notProvided.every((row) => row.verdict === "informational")).toBe(true);
		const notRun = evaluate(gates, { "localhost:5555": { platform: "android", role: "lab", runs: ["updates"], metrics: {} } });
		expect(notRun.every((row) => row.verdict === "not measured")).toBe(true);
	});

	test("the Android devices of gates.json provide the updates run, the iPhone is not judged by it", () => {
		const devices = gatesJson.devices;
		expect(devices.R58Y90KNGRP?.runs).toContain("updates");
		expect(devices["localhost:5555"]?.runs).toContain("updates");
		expect(devices["E74A5608-BF8E-5806-8699-1605F82ADED9"]?.runs).not.toContain("updates");
		// The gates name Android only: an iOS device is never a row of them.
		const rows = evaluate(gates, { phone: { platform: "ios", role: "phone", runs: null, metrics: {} } });
		expect(rows.every((row) => row.device === null && row.platform === "android")).toBe(true);
	});
});

describe("eas update", () => {
	const published = JSON.stringify([
		{ id: "01A19688-6EC1-7357-A10E-89EF0BA5FA07", group: "786464e3-332d-4d84-a793-efe37f7541c0", branch: "qa", message: "m", runtimeVersion: "0.1.0", platform: "ios", createdAt: "x" },
		{ id: "01a19688-6ec1-7357-a10e-89ef0ba5fa07", group: "786464e3-332d-4d84-a793-efe37f7541c0", branch: "qa", message: "native-qa", runtimeVersion: "0.1.0", platform: "android", createdAt: "2026-11-01T09:54:46.081Z" },
	]);

	test("the Android entry is the update, with the id a device reports", () => {
		expect(parsePublished(published, "good", "qa-x-good")).toEqual({
			kind: "good",
			id: "01a19688-6ec1-7357-a10e-89ef0ba5fa07",
			group: "786464e3-332d-4d84-a793-efe37f7541c0",
			marker: "qa-x-good",
			message: "native-qa",
			createdAt: "2026-11-01T09:54:46.081Z",
		});
	});
	test("noise around the array is tolerated, a missing or foreign answer is an error", () => {
		expect(parsePublished(`Computing project fingerprints\n${published}\n`, "bad", "m").kind).toBe("bad");
		expect(() => parsePublished("no json", "good", "m")).toThrow("no JSON array");
		expect(() => parsePublished("[{broken", "good", "m")).toThrow("no JSON array");
		expect(() => parsePublished("[1,", "good", "m")).toThrow("no JSON array");
		expect(() => parsePublished('[{"platform":"ios","id":"a","group":"b"}]', "good", "m")).toThrow("no Android update");
		expect(() => parsePublished("{}", "good", "m")).toThrow("no JSON array");
	});
	test("the bad bundle carries the fault, a good one an empty one whatever the shell exports, and the cache is cleared", () => {
		expect(publishEnvironment("bad", "m", "qa", "https://dev.qarnos.com")).toMatchObject({ EXPO_PUBLIC_QA_UPDATE_FAULT: "boot", EXPO_PUBLIC_QA_UPDATE_MARKER: "m", UPDATES_CHANNEL: "qa" });
		for (const kind of ["good", "cleanup"] as const) expect(publishEnvironment(kind, "m", "qa", "u").EXPO_PUBLIC_QA_UPDATE_FAULT).toBe("");
		const args = publishArguments("qa", "development", "hello");
		expect(args).toEqual(["update", "--channel", "qa", "--platform", "android", "--environment", "development", "--message", "hello", "--clear-cache", "--non-interactive", "--json"]);
	});
});
