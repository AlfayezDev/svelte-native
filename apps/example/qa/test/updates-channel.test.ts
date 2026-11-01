import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelOutDir, channelPrebuildReason, generatedChannel, qaChannel, recordGeneratedChannel } from "../lib/channel.ts";
import { latestRunFiles, runKinds } from "../lib/runs.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import { readFileSync } from "node:fs";
import { checkGatesFile, type GatesFile } from "../lib/gates.ts";
import { comparisonNotes, runUpdatesScenario, type UpdatesDriver } from "../lib/updates.ts";

describe("the channel of a QA build", () => {
	test("only QA channels are accepted: preview and production can never be built for or published to", () => {
		expect(qaChannel(undefined)).toBeNull();
		expect(qaChannel("qa")).toBe("qa");
		expect(qaChannel("qa-nightly")).toBe("qa-nightly");
		for (const refused of ["preview", "production", "", "qa nightly", "qa;rm", "QA", "myqa", "qa-", "staging"])
			expect(() => qaChannel(refused)).toThrow("must name a QA channel");
		expect(() => qaChannel("production", "channel")).toThrow("--channel must name a QA channel");
	});

	test("a build for a channel is kept apart from the plain QA build", () => {
		expect(channelOutDir(null, "/out")).toBe("/out");
		expect(channelOutDir("qa", "/out")).toBe("/out/channel-qa");
	});

	test("the generated android/ project is regenerated whenever its channel is not the build's", () => {
		expect(channelPrebuildReason("", null)).toBeNull();
		expect(channelPrebuildReason("qa", "qa")).toBeNull();
		expect(channelPrebuildReason("", "qa")).toContain("no updates channel");
		expect(channelPrebuildReason("qa", null)).toContain("for the qa channel and this build has none");
		expect(channelPrebuildReason("qa", "qa-b")).toContain("qa-b");
	});

	test("the channel is recorded next to the generated project; a project without a record has none", async () => {
		const directory = await mkdtemp(join(tmpdir(), "native-qa-channel-"));
		try {
			expect(await generatedChannel(directory)).toBe("");
			await recordGeneratedChannel("qa", directory);
			expect(await generatedChannel(directory)).toBe("qa");
			await recordGeneratedChannel(null, directory);
			expect(await generatedChannel(directory)).toBe("");
			await writeFile(join(directory, ".native-qa-updates-channel"), "qa\n");
			expect(await generatedChannel(directory)).toBe("qa");
		} finally {
			await rm(directory, { recursive: true });
		}
	});
});

describe("the updates run in the report", () => {
	test("updates is a run kind, and the newest file of each device is the one the report reads", async () => {
		expect(runKinds).toContain("updates");
		const directory = await mkdtemp(join(tmpdir(), "native-qa-runs-"));
		try {
			for (const name of ["updates-localhost_5555-20261101T100000Z.json", "updates-localhost_5555-20261101T120000Z.json", "updates-R58Y90KNGRP-20261031T090000Z.json", "boot-R58Y90KNGRP-20261031T090000Z.json"])
				await writeFile(join(directory, name), "{}");
			const files = await latestRunFiles(directory);
			expect([...files.updates.keys()].sort()).toEqual(["R58Y90KNGRP", "localhost_5555"]);
			expect(files.updates.get("localhost_5555")).toBe(join(directory, "updates-localhost_5555-20261101T120000Z.json"));
			expect(files.boot.has("R58Y90KNGRP")).toBe(true);
		} finally {
			await rm(directory, { recursive: true });
		}
	});

	test("gates.json stays a valid table, and the updates run adds its metrics next to the other runs'", async () => {
		const gates = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
		checkGatesFile(gates);
		const driver: UpdatesDriver = {
			launch: async () => { throw new Error("no device"); },
			publish: async () => { throw new Error("no eas"); },
			bootSeries: async () => [],
		};
		const scenario = await runUpdatesScenario(driver, { maxLaunches: 2, settleLaunches: 1 });
		expect(scenario.good.applied).toBe(false);
		const metrics = deviceMetrics(null, null, [], null, null, { parity: null, a11y: null, resilience: null }, {
			schema: 1, kind: "updates", startedAt: "", finishedAt: "", source: { commit: "a", dirty: false },
			device: { serial: "s", platform: "android", kind: "device", model: "m", osVersion: "16", sdk: 36, abi: "x86_64", refreshHz: null },
			app: { package: "p", versionName: null, versionCode: null, lastUpdateTime: null, installedSha256: null, apk: null },
			channel: "qa", runtimeVersion: null, build: null, eas: { command: "npx", version: null, environment: "development" }, channelInfo: null, deviceState: { finalBuild: "plain", resetSettingRemoved: true, storeCleared: true, note: null },
			options: { maxLaunches: 2, settleLaunches: 1 }, scenario, notes: [], boot: { enabled: null, baseline: null, baselineBuild: null, delta: null, enabledLaunches: [], baselineLaunches: [] }, logFile: "",
		});
		expect(metrics["updates.applied"]).toBe(0);
		// Nothing ran, so nothing was seen: no evidence that the bad update was kept out, which is not a 0.
		expect(metrics["updates.badRetried"]).toBeNull();
		expect("log.fatals" in metrics).toBe(false);
	});
});

describe("the boot comparison's builds", () => {
	test("one source tree, clean: nothing to say; different commits or a dirty tree are noted, a missing build says nothing", () => {
		expect(comparisonNotes({ commit: "abc", dirty: false }, { commit: "abc", dirty: false })).toEqual([]);
		expect(comparisonNotes({ commit: "abc", dirty: false }, { commit: "def", dirty: false })[0]).toContain("at abc and the build without a channel at def");
		expect(comparisonNotes({ commit: "abc", dirty: true }, { commit: "abc", dirty: false })[0]).toContain("the channel build came from a tree with uncommitted changes");
		expect(comparisonNotes({ commit: "abc", dirty: true }, { commit: "abc", dirty: true })[0]).toContain("the channel build and the build without a channel");
		expect(comparisonNotes(null, { commit: "abc", dirty: false })).toEqual([]);
	});
});
