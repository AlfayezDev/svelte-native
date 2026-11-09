import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, type Gate, type GatesFile } from "../lib/gates.ts";
import type { Launch } from "../lib/types.ts";
import {
	badFaults,
	bootComparison,
	ensureHealthyChannel,
	parsePublished,
	publishArguments,
	publishEnvironment,
	restartProblem,
	runUpdatesScenario,
	updatesMetrics,
	type BadFault,
	type PublishedUpdate,
	type UpdateKind,
	type UpdateLaunch,
	type UpdatesDriver,
	type UpdatesFile,
	type UpdatesScenario,
} from "../lib/updates.ts";
import { gateKinds } from "../lib/gates.ts";

/**
 * A model of the client (`UpdateStore.select`, `markFatal`, `markLaunched`, the check of `client.ts`) behind the harness's driver, so
 * the scenario's counting is tested against the policy it measures: the check runs after the first commit, a downloaded update runs
 * from the next start, a launch that recorded a fatal fails the update at the next start, a second unconfirmed launch in a row does,
 * and a failed update is not downloaded again.
 */
class ClientWorld implements UpdatesDriver {
	embeddedAt = 1_000;
	clock = 1_000;
	/** What the channel serves: the last one published is the newest. */
	channel: (PublishedUpdate & { at: number })[] = [];
	store = new Map<string, { status: "ready" | "failed"; at: number }>();
	pending: string | null = null;
	pendingFatal = false;
	unconfirmed = new Map<string, number>();
	failedIds: string[] = [];
	index = 0;
	published: PublishedUpdate[] = [];
	/** Ways to make the model misbehave. */
	faultNeverFires = false;
	forgetFailed = false;
	markerMissing = false;
	checksThatSeeNothing = 0;
	/** The host does not record the fatal of a bad launch (as a platform without the hook): the update then needs two launches to fail. */
	fatalNotRecorded = false;
	/** Every check fails, as on a device with no network. */
	offline = false;
	/** A launch (by index) that reads to the timeout with nothing logged. */
	silentLaunch: number | null = null;
	/** Fail publishing (by kind): the server may have taken the update (`serverTakesIt`) or not. */
	failPublish: UpdateKind | null = null;
	serverTakesIt = false;
	bootLaunches: Launch[] = [];

	async publish(kind: UpdateKind, fault?: BadFault): Promise<PublishedUpdate> {
		const at = ++this.clock * 1000;
		const update = { kind, fault: fault ?? null, branch: "qa", id: `00000000-0000-0000-0000-${String(at).padStart(12, "0")}`, group: `g${at}`, marker: `qa-test-${kind}${fault ? `-${fault}` : ""}`, message: "", createdAt: String(at), at };
		if (this.failPublish === kind) {
			if (this.serverTakesIt) this.channel.push(update);
			throw new Error("eas update failed (exit 1)");
		}
		this.channel.push(update);
		this.published.push(update);
		return update;
	}

	async launch(phase: UpdateLaunch["phase"]): Promise<UpdateLaunch> {
		const index = ++this.index;
		const failedIds: string[] = [];
		if (this.pending !== null) {
			const count = (this.unconfirmed.get(this.pending) ?? 0) + 1;
			if (!this.forgetFailed && (this.pendingFatal || count >= 2)) {
				this.store.set(this.pending, { status: "failed", at: this.store.get(this.pending)?.at ?? 0 });
				this.failedIds.push(this.pending);
				this.unconfirmed.delete(this.pending);
			} else this.unconfirmed.set(this.pending, count);
			failedIds.push(this.pending);
			this.pending = null;
			this.pendingFatal = false;
		}
		const ready = [...this.store].filter(([, entry]) => entry.status === "ready" && entry.at > this.embeddedAt).sort((a, b) => b[1].at - a[1].at);
		const chosen = ready[0]?.[0] ?? null;
		const running = chosen ? ({ kind: "update", id: chosen, createdAt: this.store.get(chosen)?.at ?? 0 } as const) : ({ kind: "embedded", builtAt: this.embeddedAt } as const);
		if (chosen) this.pending = chosen;
		const base = { index, phase, failedIds, unconfirmedIds: [] as string[], reset: index === 1 ? { token: "qa-test", forgotten: 0 } : null, crashes: 0, jsErrors: 0, displayMs: 600 };
		if (this.silentLaunch === index) return { ...base, running: null, booted: false, probe: null, check: null, failedIds: [], unconfirmedIds: [], settledBy: "timeout" };
		const fault = chosen && !this.faultNeverFires ? (this.channel.find((update) => update.id === chosen)?.fault ?? null) : null;
		if (fault) {
			if (!this.fatalNotRecorded) this.pendingFatal = true;
			// `boot` never boots; the late faults boot and then throw before the host's check.
			return { ...base, running, crashes: 1, jsErrors: fault === "boot" ? 1 : 0, displayMs: fault === "boot" ? null : 600, booted: fault !== "boot", probe: null, check: null, settledBy: "fault" };
		}
		this.pending = null; // confirmed after the window
		if (chosen) this.unconfirmed.delete(chosen);
		const marker = chosen && !this.markerMissing ? (this.channel.find((update) => update.id === chosen)?.marker ?? null) : null;
		const probe = { enabled: true, updateId: chosen, embedded: chosen === null, createdAt: null, runtimeVersion: "0.1.0", channel: "qa", checkOnLaunch: "ALWAYS", marker };
		const runningAt = chosen ? (this.store.get(chosen)?.at ?? 0) : this.embeddedAt;
		const latest = this.channel.at(-1);
		let check: UpdateLaunch["check"];
		if (this.offline) check = { outcome: "failed" };
		else if (this.checksThatSeeNothing > 0) {
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
const options = { maxLaunches: 4, settleLaunches: 3, faults: badFaults };

describe("the scenario against the client's policy", () => {
	test("a starting update, a good one applied in two starts, each kind of bad update recovered from and never tried again, the channel ends healthy", async () => {
		const world = new ClientWorld();
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.errors).toEqual([]);
		expect(scenario.baselineEmbedded).toBe(true);
		expect(scenario.head.verified).toBe(true);
		expect(scenario.good).toMatchObject({ applied: true, launchesToApply: 2, markerSeen: true });
		expect(scenario.bads.map((bad) => bad.fault)).toEqual(["boot", "mount", "effect"]);
		for (const bad of scenario.bads) {
			expect(bad).toMatchObject({ faultTriggered: true, rolledBack: true, retried: 0, blockedChecks: 4, launchesAfter: 4, evidence: true });
			// The previous good update, not the embedded bundle: it is newer than the embedded one.
			expect(bad.rolledBackTo).toBe(scenario.good.published?.id ?? "");
			expect(bad.failedIdReported).toBe(bad.published?.id ?? "");
		}
		expect(scenario.cleanup.healthy).toBe(true);
		expect(scenario.unexpectedFaults).toBe(0);
		// The channel's newest update is the clean-up, and it is good.
		expect(world.channel.at(-1)).toMatchObject({ kind: "cleanup", fault: null });
		expect(world.published.map((update) => update.kind)).toEqual(["head", "good", "bad", "bad", "bad", "cleanup"]);
		expect(scenario.attempts.map((attempt) => attempt.outcome)).toEqual(["published", "published", "published", "published", "published", "published"]);
	});

	test("the channel is cleaned up before the boot series, which then runs on the healthy channel", async () => {
		const world = new ClientWorld();
		let publishedBeforeBoot: string[] = [];
		world.bootSeries = async () => {
			publishedBeforeBoot = world.published.map((update) => update.kind);
			return [];
		};
		await runUpdatesScenario(world, options);
		expect(publishedBeforeBoot.at(-1)).toBe("cleanup");
	});

	test("a stale or bad update at the channel's head does not reach the measurements: the run publishes its own first", async () => {
		const world = new ClientWorld();
		// An earlier run left a bad update at the head, newer than the embedded bundle.
		world.channel.push({ kind: "bad", fault: "boot", branch: "qa", id: "00000000-0000-0000-0000-00000000dead", group: "g", marker: "old", message: "", createdAt: "1", at: 1_500_000 });
		world.store.set("00000000-0000-0000-0000-00000000dead", { status: "ready", at: 1_500_000 });
		world.clock = 2_000;
		const scenario = await runUpdatesScenario(world, options);
		// The bad one is on the device from the start, newer than the embedded bundle, and runs first: the run's own head is only fetched by its check.
		expect(world.published[0]?.kind).toBe("head");
		expect(scenario.baseline?.phase).toBe("baseline");
		expect(scenario.head.launches.length).toBeGreaterThan(0);
		// Whatever the stale head did happened in the head phase and the baseline, not in the counted phases.
		expect(scenario.good.launchesToApply).toBe(2);
		expect(scenario.bads.every((bad) => bad.rolledBack)).toBe(true);
	});

	test("launches are counted from the publish: an update the first start does not see takes a third start", async () => {
		const world = new ClientWorld();
		const originalPublish = world.publish.bind(world);
		world.publish = async (kind, fault) => {
			const update = await originalPublish(kind, fault);
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
		// Nothing good is left in the store when the first bad one is published.
		world.publish = async (kind, fault) => {
			if (kind === "bad" && fault === "boot") world.store.clear();
			return originalPublish(kind, fault);
		};
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot"] });
		expect(scenario.bads[0]).toMatchObject({ rolledBack: true, rolledBackTo: "embedded", retried: 0 });
		expect(scenario.errors).toEqual([]);
	});

	test("a client that forgets a failed update keeps retrying it: badRetried counts", async () => {
		const world = new ClientWorld();
		world.forgetFailed = true;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.bads[0]?.retried).toBeGreaterThan(0);
		expect(scenario.errors.some((error) => error.includes("tried again"))).toBe(true);
		expect(updatesMetrics(file(scenario))["updates.badRetried"]).toBeGreaterThan(0);
	});

	test("a host that records no fatal needs two launches to fail the update: the start after the bad one runs it again, and the run says so", async () => {
		const world = new ClientWorld();
		world.fatalNotRecorded = true;
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["mount"] });
		expect(scenario.bads[0]?.rolledBack).toBe(false);
		expect(scenario.bads[0]?.retried).toBeGreaterThan(0);
		expect(updatesMetrics(file(scenario, bootComparison([], [], null), { faults: ["mount"] }))["updates.rolledBack"]).toBeNull();
	});

	test("a bad update whose fault does not fire is a failed run, not a rollback", async () => {
		const world = new ClientWorld();
		world.faultNeverFires = true;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.bads[0]?.faultTriggered).toBe(false);
		expect(scenario.bads[0]?.rolledBack).toBe(false);
		expect(scenario.errors.some((error) => error.includes("fault planted in its bundle did not fire"))).toBe(true);
	});

	test("an update that runs without its marker is not applied: the bundle that executes is not the published one", async () => {
		const world = new ClientWorld();
		world.markerMissing = true;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.good.applied).toBe(false);
		expect(scenario.good.markerSeen).toBe(false);
		expect(scenario.head.verified).toBe(false);
		expect(scenario.errors.some((error) => error.includes("not the one that was published"))).toBe(true);
	});

	test("settle launches are required: without launches after the bad update nothing shows it is not tried again", async () => {
		await expect(runUpdatesScenario(new ClientWorld(), { ...options, settleLaunches: 0 })).rejects.toThrow("at least 1");
	});

	test("a device that cannot check (offline) gives no evidence that the bad update was refused: badRetried is not measured, and the run says why", async () => {
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		let publishedBad = false;
		const originalPublish = world.publish.bind(world);
		world.publish = async (kind, fault) => { if (kind === "bad") publishedBad = true; return originalPublish(kind, fault); };
		// Offline from the start of the bad phase on: the bad update is never even downloaded, so nothing ever runs it.
		world.launch = async (phase) => { world.offline = publishedBad; return launch(phase); };
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot"] });
		expect(updatesMetrics(file(scenario, bootComparison([], [], null), { faults: ["boot"] }))["updates.badRetried"]).toBeNull();
	});

	test("launches after the bad update that time out, log no check or fail it are errors and leave no evidence", async () => {
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		let ran = false;
		world.launch = async (phase) => {
			const result = await launch(phase);
			if (phase === "bad" && result.crashes > 0) ran = true;
			if (ran && phase === "settled" && result.index % 2 === 0) return { ...result, check: null, settledBy: "timeout" as const };
			if (ran && phase === "settled") return { ...result, check: { outcome: "failed" as const } };
			return result;
		};
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot"] });
		expect(scenario.bads[0]?.evidence).toBe(false);
		expect(scenario.errors.some((error) => error.includes("ended in the timeout"))).toBe(true);
		expect(scenario.errors.some((error) => error.includes("could not check"))).toBe(true);
		expect(updatesMetrics(file(scenario, bootComparison([], [], null), { faults: ["boot"] }))["updates.badRetried"]).toBeNull();
		expect(scenario.unexpectedFaults).toBeNull();
	});

	test("a run that did not read some launch to its end cannot say there were no faults", async () => {
		const world = new ClientWorld();
		world.silentLaunch = 3;
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.unexpectedFaults).toBeNull();
		expect(updatesMetrics(file(scenario))["updates.unexpectedFaults"]).toBeNull();
	});

	test("only some of the fault kinds ran: rollback is not measured", async () => {
		const world = new ClientWorld();
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot", "mount"] });
		expect(scenario.bads.every((bad) => bad.rolledBack)).toBe(true);
		const metrics = updatesMetrics(file(scenario, bootComparison([], [], null), { faults: ["boot", "mount"] }));
		expect(metrics["updates.rolledBack"]).toBeNull();
		// What ran was read to its end, so what it shows is measured.
		expect(metrics["updates.badRetried"]).toBe(0);
		expect(metrics["updates.rolledBack.boot"]).toBe(1);
	});

	test("the clean-up runs when a bad step fails, and a publish whose answer was lost still counts as an attempt", async () => {
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		world.launch = async (phase) => {
			if (phase === "rollback") throw new Error("the device went away");
			return launch(phase);
		};
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot"] });
		expect(scenario.errors.some((error) => error.includes("boot bad update: the device went away"))).toBe(true);
		expect(world.published.map((update) => update.kind)).toEqual(["head", "good", "bad", "cleanup"]);
		expect(world.channel.at(-1)?.kind).toBe("cleanup");
	});

	test("a bad publish that errors after the server took it is an attempt, and the channel is still cleaned up", async () => {
		const world = new ClientWorld();
		world.failPublish = "bad";
		world.serverTakesIt = true;
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot"] });
		expect(scenario.attempts.filter((attempt) => attempt.kind === "bad").map((attempt) => attempt.outcome)).toEqual(["failed"]);
		expect(scenario.errors.some((error) => error.includes("eas update failed"))).toBe(true);
		// The bad update did reach the channel; the clean-up went out after it.
		expect(world.channel.map((update) => update.kind)).toEqual(["head", "good", "bad", "cleanup"]);
		expect(scenario.cleanup.healthy).toBe(true);
	});

	test("a clean-up that cannot be published is retried once and then reported loudly", async () => {
		const world = new ClientWorld();
		world.failPublish = "cleanup";
		const scenario = await runUpdatesScenario(world, { ...options, faults: ["boot"] });
		expect(scenario.attempts.filter((attempt) => attempt.kind === "cleanup")).toHaveLength(2);
		expect(scenario.cleanup.healthy).toBe(false);
		expect(scenario.errors.some((error) => error.includes("may end on an unhealthy update"))).toBe(true);
	});

	test("a signal during the run: the clean-up is published once, and not again when it already went out", async () => {
		const world = new ClientWorld();
		let live: UpdatesScenario | null = null;
		const originalLaunch = world.launch.bind(world);
		let interrupted = false;
		let cleanupsAtTheSignal = -1;
		world.launch = async (phase) => {
			if (phase === "rollback" && !interrupted) {
				interrupted = true;
				// Two signals in a row: the clean-up goes out once.
				if (live) await ensureHealthyChannel(world, live);
				if (live) await ensureHealthyChannel(world, live);
				cleanupsAtTheSignal = world.published.filter((update) => update.kind === "cleanup").length;
			}
			return originalLaunch(phase);
		};
		await runUpdatesScenario(world, { ...options, faults: ["boot"] }, (state) => { live = state; });
		expect(cleanupsAtTheSignal).toBe(1);
	});

	test("a failed publish of the starting update leaves nothing to clean up when nothing was published", async () => {
		const world = new ClientWorld();
		world.publish = async () => {
			throw new Error("eas update failed (exit 1)");
		};
		const scenario = await runUpdatesScenario(world, options);
		expect(scenario.errors.filter((error) => error.includes("eas update failed")).length).toBeGreaterThan(1);
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

	test("a run that expects the app to reset itself notes it when the first start reports no reset", async () => {
		const honoured = await runUpdatesScenario(new ClientWorld(), { ...options, expectReset: true });
		expect(honoured.notes).toEqual([]);
		const world = new ClientWorld();
		const launch = world.launch.bind(world);
		world.launch = async (phase) => ({ ...(await launch(phase)), reset: null });
		const ignored = await runUpdatesScenario(world, { ...options, expectReset: true });
		expect(ignored.notes[0]).toContain("reported no QA reset");
		expect(ignored.errors).toEqual([]);
	});

	test("faults in launches other than the bad ones are counted", async () => {
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

function file(scenario: Awaited<ReturnType<typeof runUpdatesScenario>>, boot = bootComparison([], [], null), override: Partial<typeof options> = {}): UpdatesFile {
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
		eas: { command: "npx", version: "eas-cli/27.2.0", environment: "development" },
		channelInfo: null,
		deviceState: { finalBuild: "plain", resetSettingRemoved: true, storeCleared: true, note: null },
		options: { ...options, ...override },
		scenario,
		boot,
		notes: [],
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

describe("a device that restarts under the run", () => {
	test("a changed boot id is a problem that says where it was noticed; the same id, or one that could not be read, is not", () => {
		expect(restartProblem("aaaa", "aaaa", "before launch 2")).toBeNull();
		expect(restartProblem("aaaa", null, "before launch 2")).toBeNull();
		expect(restartProblem(null, "bbbb", "before launch 2")).toBeNull();
		const problem = restartProblem("aaaa", "bbbb", "before launch 2 (baseline)");
		expect(problem).toContain("restarted before launch 2 (baseline)");
		expect(problem).toContain("from aaaa to bbbb");
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

	test("the OVH emulator provides the updates run; the Samsung does not yet, and the iPhone is never judged by it", () => {
		const devices = gatesJson.devices;
		// The run has not been made on the shared phone yet; the app resets itself, so it can be.
		expect(devices.R58Y90KNGRP?.runs).not.toContain("updates");
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
			fault: null,
			id: "01a19688-6ec1-7357-a10e-89ef0ba5fa07",
			group: "786464e3-332d-4d84-a793-efe37f7541c0",
			branch: "qa",
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
	test("a bad bundle carries its fault, a good one an empty one whatever the shell exports, and the cache is cleared", () => {
		for (const fault of badFaults) expect(publishEnvironment("bad", "m", "qa", fault)).toMatchObject({ EXPO_PUBLIC_QA_UPDATE_FAULT: fault, EXPO_PUBLIC_QA_UPDATE_MARKER: "m", UPDATES_CHANNEL: "qa" });
		for (const kind of ["head", "good", "cleanup"] as const) expect(publishEnvironment(kind, "m", "qa", "mount").EXPO_PUBLIC_QA_UPDATE_FAULT).toBe("");
		const args = publishArguments("qa", "development", "hello");
		expect(args).toEqual(["update", "--channel", "qa", "--platform", "android", "--environment", "development", "--message", "hello", "--clear-cache", "--non-interactive", "--json"]);
	});
});
