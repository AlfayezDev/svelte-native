import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { latestRunFiles } from "../lib/runs.ts";

describe("run files of the three suites", () => {
	test("the newest of each suite per device is picked, next to lab and boot", async () => {
		const dir = await mkdtemp(join(tmpdir(), "native-qa-runs-"));
		for (const name of [
			"parity-localhost_5555-20261026T090000Z.json",
			"parity-localhost_5555-20261026T100000Z.json",
			"a11y-localhost_5555-20261026T090500Z.json",
			"resilience-localhost_5555-20261026T091000Z.json",
			"parity-R58Y90KNGRP-20261026T080000Z.json",
			"lab-localhost_5555-20261026T070000Z.json",
			"parity-localhost_5555-20261026T100000Z.log",
		])
			await writeFile(join(dir, name), "{}");
		const files = await latestRunFiles(dir);
		expect([...files.parity.keys()].sort()).toEqual(["R58Y90KNGRP", "localhost_5555"]);
		expect(files.parity.get("localhost_5555")).toBe(
			join(dir, "parity-localhost_5555-20261026T100000Z.json"),
		);
		expect(files.a11y.get("localhost_5555")).toBe(
			join(dir, "a11y-localhost_5555-20261026T090500Z.json"),
		);
		expect(files.resilience.get("localhost_5555")).toBe(
			join(dir, "resilience-localhost_5555-20261026T091000Z.json"),
		);
		expect(files.lab.has("localhost_5555")).toBe(true);
		expect(files.boot.size).toBe(0);
	});
});
