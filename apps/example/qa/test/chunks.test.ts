import { describe, expect, test } from "bun:test";
import { chunkArgs, emulatorScript, limitReached, planCases, restartEmulator, resumeMismatch, runChunks } from "../lib/chunks.ts";
import type { Lock } from "../lib/lock.ts";

const names = ["a--1", "b--1", "c--1", "d--1", "e--1"];

describe("planCases", () => {
	test("without a limit it takes every case the file lacks, in order", () => {
		const plan = planCases(names, new Set(["b--1"]), 0);
		expect([...plan.run]).toEqual(["a--1", "c--1", "d--1", "e--1"]);
		expect(plan.left).toBe(0);
	});
	test("a limit takes the first cases that are not done and counts the rest", () => {
		const plan = planCases(names, new Set(["a--1", "c--1"]), 2);
		expect([...plan.run]).toEqual(["b--1", "d--1"]);
		expect(plan.left).toBe(1);
	});
	test("a limit that covers what is left leaves nothing", () => {
		expect(planCases(names, new Set(["a--1", "b--1", "c--1", "d--1"]), 3)).toEqual({ run: new Set(["e--1"]), left: 0 });
		expect(planCases(names, new Set(names), 3)).toEqual({ run: new Set(), left: 0 });
	});
	test("chunks of 2 over 5 cases, each continuing the file the one before wrote, end after three", () => {
		const done = new Set<string>();
		const sizes: number[] = [];
		for (;;) {
			const plan = planCases(names, done, 2);
			if (plan.run.size === 0) break;
			sizes.push(plan.run.size);
			for (const name of plan.run) done.add(name);
			if (plan.left === 0) break;
		}
		expect(sizes).toEqual([2, 2, 1]);
		expect(done.size).toBe(5);
	});
});

describe("resumeMismatch", () => {
	const selected = new Set(names);
	const same = { names: ["a--1", "b--1"], mode: "check", installedSha256: "abcdef0123456789" };
	const now = { selected, mode: "check", installedSha256: "abcdef0123456789aaaa" };
	test("the same selection, mode and build can be continued", () => {
		expect(resumeMismatch(same, now)).toBeNull();
	});
	test("a case the run does not select is another --filter or --quick", () => {
		expect(resumeMismatch({ ...same, names: ["zzz--1"] }, now)).toContain("another --filter or --quick");
	});
	test("an update is not continued by a check", () => {
		expect(resumeMismatch({ ...same, mode: "update" }, now)).toContain("mode");
	});
	test("another build, or one that cannot be identified, is refused", () => {
		expect(resumeMismatch({ ...same, installedSha256: "ffffffffffffffff" }, now)).toContain("installed build");
		expect(resumeMismatch({ ...same, installedSha256: null }, now)).toContain("could not be identified");
		expect(resumeMismatch(same, { ...now, installedSha256: null })).toContain("could not be identified");
	});
});

describe("chunkArgs", () => {
	const values = { device: "localhost:5555", apk: "qa/out/app.apk", quick: true, filter: "login", chunk: "40", "no-install": false, fresh: undefined, resume: undefined };
	test("the first chunk carries the caller's flags and its own limit, without the chunking flags", () => {
		expect(chunkArgs("parity", values, 40, 0)).toEqual(["parity", "--limit", "40", "--device", "localhost:5555", "--apk", "qa/out/app.apk", "--quick", "--filter", "login"]);
	});
	test("a chunk after the first continues the file on a fresh emulator and installs nothing", () => {
		expect(chunkArgs("a11y", values, 40, 2)).toEqual(["a11y", "--limit", "40", "--resume", "--fresh", "--no-install", "--device", "localhost:5555", "--quick", "--filter", "login"]);
	});
	test("the caller's --resume and --fresh apply to the first chunk too", () => {
		const args = chunkArgs("parity", { ...values, resume: true, fresh: true }, 10, 0);
		expect(args.slice(0, 5)).toEqual(["parity", "--limit", "10", "--resume", "--fresh"]);
		expect(args.filter((arg) => arg === "--resume" || arg === "--fresh")).toHaveLength(2);
	});
	test("--no-install of the caller stays for the first chunk", () => {
		expect(chunkArgs("parity", { device: "x", "no-install": true }, 5, 0)).toEqual(["parity", "--limit", "5", "--device", "x", "--no-install"]);
	});
});

describe("runChunks", () => {
	const quiet = (run: () => number): number => {
		const log = console.log;
		console.log = () => undefined;
		try {
			return run();
		} finally {
			console.log = log;
		}
	};
	test("goes on while a chunk ends with the limit status and stops at 0, counting the chunks", () => {
		const seen: string[][] = [];
		const statuses = [limitReached, limitReached, 0];
		const count = quiet(() => runChunks("parity", { device: "x" }, 7, (args, index) => { seen.push(args); return statuses[index] as number; }, { restartable: true }));
		expect(count).toBe(3);
		expect(seen[0]).toEqual(["parity", "--limit", "7", "--device", "x"]);
		expect(seen[1]).toContain("--resume");
		expect(seen[2]).toContain("--fresh");
	});
	test("a chunk that fails stops the run with the command to continue it", () => {
		expect(() => quiet(() => runChunks("a11y", { device: "x" }, 7, (_, index) => (index === 0 ? limitReached : 1), { restartable: true }))).toThrow("chunk 2 ended with status 1; continue with the same command plus --resume");
	});
	test("a phone has nothing to restart: its chunks only continue the file", () => {
		const seen: string[][] = [];
		quiet(() => runChunks("a11y", { device: "R58Y90KNGRP" }, 7, (args, index) => { seen.push(args); return index === 0 ? limitReached : 0; }, { restartable: false }));
		expect(seen[1]).toEqual(["a11y", "--limit", "7", "--resume", "--no-install", "--device", "R58Y90KNGRP"]);
	});
	test("a loop that never finishes is bounded", () => {
		expect(() => quiet(() => runChunks("parity", { device: "x" }, 1, () => limitReached, { maxChunks: 4, restartable: true }))).toThrow("4 chunks and the matrix is not done");
	});
});

describe("the script that restarts the emulator", () => {
	const remote: Lock = { kind: "remote", host: "ovh-root", file: "/run/svelte-qa/emulator.lock" };
	const local: Lock = { kind: "local", file: "/tmp/x.lock" };
	test("QA_EMULATOR_SH names it", () => {
		expect(emulatorScript("localhost:5555", { QA_EMULATOR_SH: "/home/x/ctl.sh" }, remote)).toBe("/home/x/ctl.sh");
	});
	test("an emulator behind a tunnel is restarted over ssh, one on this machine through the unit", () => {
		expect(emulatorScript("localhost:5555", {}, remote)).toMatch(/qa\/ci\/emulator-remote\.sh$/);
		expect(emulatorScript("emulator-5554", {}, local)).toMatch(/qa\/ci\/emulator\.sh$/);
	});
	test("a phone has none, even with QA_EMULATOR_SH set (it would restart the emulator without its lock)", () => {
		expect(emulatorScript("R58Y90KNGRP", {}, null)).toBeNull();
		expect(emulatorScript("R58Y90KNGRP", { QA_EMULATOR_SH: "/home/x/ctl.sh" }, null)).toBeNull();
	});
	test("restart runs `restart` and then checks the device answers", async () => {
		const calls: string[] = [];
		await restartEmulator("localhost:5555", "between chunks", {
			script: "/ctl.sh",
			run: async (script, reason) => { calls.push(`run ${script} ${reason}`); return 0; },
			online: async (serial) => { calls.push(`online ${serial}`); },
		});
		expect(calls).toEqual(["run /ctl.sh between chunks", "online localhost:5555"]);
	});
	test("a restart that fails, or a device that is not the emulator, is an error", async () => {
		await expect(restartEmulator("localhost:5555", "r", { script: "/ctl.sh", run: async () => 7, online: async () => undefined })).rejects.toThrow("restart ended with status 7");
		await expect(restartEmulator("R58Y90KNGRP", "r", { script: null })).rejects.toThrow("is not one");
	});
});
