import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { diffHits, runHits, runTextFile } from "../commands/leakcheck.ts";
import { useAccount } from "../lib/qa-account.ts";

// A made-up address: the real one is never written in a test either.
const address = "qa.person+tests@example.test";

afterEach(() => useAccount(undefined));

const diff = (name: string, ...lines: string[]) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${lines.join("\n")}\n`;

describe("what leakcheck reads of a diff", () => {
	test("an added line with the address is a hit, a removed one is the cure and is not", () => {
		useAccount(address);
		expect(diffHits(diff("README.md", `+owner ${address}`))).toEqual(["README.md"]);
		expect(diffHits(diff("README.md", `-owner ${address}`, "+owner <placeholder>"))).toEqual([]);
		expect(diffHits(diff("a.md", `-${address}`) + diff("b.md", "-x", `+${address.toUpperCase()}`))).toEqual(["b.md"]);
	});
});

describe("what leakcheck reads of the run directory", () => {
	test("the raw dumps of a failed try are text it reads, the screenshots are not", () => {
		for (const name of ["parity-x.json", "a.log", "a.logcat.txt", "case.attempt1.uidump.xml"]) expect(runTextFile(name)).toBe(true);
		for (const name of ["case.attempt1.png", "notes.md"]) expect(runTextFile(name)).toBe(false);
	});

	test("a dump or a log that holds the address is a hit, and with purge it is deleted; a clean file stays", async () => {
		useAccount(address);
		const root = await mkdtemp(join(tmpdir(), "native-qa-leakcheck-"));
		try {
			const evidence = join(root, "runs", "parity-localhost_5555-x");
			mkdirSync(evidence, { recursive: true });
			writeFileSync(join(evidence, "case.attempt1.uidump.xml"), `<node text="${address}"/>`);
			writeFileSync(join(evidence, "case.attempt1.logcat.txt"), `signed in as ${address.toUpperCase()}`);
			writeFileSync(join(evidence, "case.attempt1.windows.txt"), "mCurrentFocus=Window{1}");
			writeFileSync(join(root, "runs", "parity-localhost_5555-x.json"), "{}");

			const found = await runHits(join(root, "runs"), root);
			expect(found.sort()).toEqual(["runs/parity-localhost_5555-x/case.attempt1.logcat.txt", "runs/parity-localhost_5555-x/case.attempt1.uidump.xml"]);
			expect(await readdir(evidence)).toHaveLength(3);

			expect((await runHits(join(root, "runs"), root, true)).sort()).toEqual(found.sort());
			expect((await readdir(evidence)).sort()).toEqual(["case.attempt1.windows.txt"]);
			expect(await runHits(join(root, "runs"), root, true)).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
