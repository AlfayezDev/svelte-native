import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test as bunTest } from "bun:test";
import { artifactHits, diffHits, leakcheck, runTextFile, uploadedOutFile } from "../commands/leakcheck.ts";
import { useAccount } from "../lib/qa-account.ts";

/**
 * Every test starts with no QA account, whatever the environment or the repository's .env.local of the machine running it says (a developer's has one); a test
 * that needs an account sets its own with `useAccount`, and `afterEach` gives the machine's back.
 */
const test = (name: string, body: () => void | Promise<void>, timeoutMs?: number): void =>
	bunTest(
		name,
		() => {
			useAccount(null);
			return body();
		},
		timeoutMs,
	);

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

/** A directory laid out like the one the workflow uploads: qa/runs with the evidence of a failed try, qa/out with the lane's files, the report. */
function uploaded(files: Record<string, string>) {
	const root = mkdtempSync(join(tmpdir(), "native-qa-leakcheck-"));
	const places = { runs: join(root, "runs"), out: join(root, "out"), report: join(root, "report.json") };
	for (const [name, text] of Object.entries(files)) {
		const path = join(root, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, text);
	}
	return { root, places };
}

describe("what leakcheck reads of the files the CI uploads", () => {
	test("the raw dumps of a failed try and the lane's files are text it reads, the screenshots and the rest of qa/out are not", () => {
		for (const name of ["parity-x.json", "a.log", "a.logcat.txt", "case.attempt1.uidump.xml"]) expect(runTextFile(name)).toBe(true);
		for (const name of ["case.attempt1.png", "notes.md"]) expect(runTextFile(name)).toBe(false);
		for (const name of ["lane-parity.log", "build-x86_64.log", "build-x86_64.json", "lane-stages.tsv", "gates.md", "gates-smoke.md"]) expect(uploadedOutFile(name)).toBe(true);
		for (const name of ["app-x86_64.apk", "device-state-localhost_5555.json", "notes.txt"]) expect(uploadedOutFile(name)).toBe(false);
	});

	test("a dump, a log, a lane log, a gates table or the report that holds the address is a hit, and with purge it is deleted; a clean file and a file nobody uploads stay", async () => {
		useAccount(address);
		const { root, places } = uploaded({
			"runs/parity-localhost_5555-x/case.attempt1.uidump.xml": `<node text="${address}"/>`,
			"runs/parity-localhost_5555-x/case.attempt1.logcat.txt": `signed in as ${address.toUpperCase()}`,
			"runs/parity-localhost_5555-x/case.attempt1.windows.txt": "mCurrentFocus=Window{1}",
			"runs/parity-localhost_5555-x.json": "{}",
			"out/lane-parity.log": `console copy: ${address}`,
			"out/gates.md": `| row | ${address} |`,
			"out/lane-stages.tsv": "parity\tpass\t10\t5",
			"out/device-state-localhost_5555.json": `{"owner":"${address}"}`,
			"report.json": `{"x":"${encodeURIComponent(address)}"}`,
		});
		try {
			const found = await artifactHits(places, root);
			expect(found.map((hit) => hit.path).sort()).toEqual(["out/gates.md", "out/lane-parity.log", "report.json", "runs/parity-localhost_5555-x/case.attempt1.logcat.txt", "runs/parity-localhost_5555-x/case.attempt1.uidump.xml"]);
			expect(found.every((hit) => hit.kind === "address" && !hit.deleted)).toBe(true);

			const purged = await artifactHits(places, root, true);
			expect(purged.map((hit) => hit.path).sort()).toEqual(found.map((hit) => hit.path).sort());
			expect(purged.every((hit) => hit.deleted)).toBe(true);
			expect((await readdir(join(root, "runs", "parity-localhost_5555-x"))).sort()).toEqual(["case.attempt1.windows.txt"]);
			expect((await readdir(join(root, "out"))).sort()).toEqual(["device-state-localhost_5555.json", "lane-stages.tsv"]);
			expect(existsSync(places.report)).toBe(false);
			expect(await artifactHits(places, root, true)).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a file with only the sign-in code is reported and kept, even with purge: six digits can be a pixel count", async () => {
		useAccount(address, "123456");
		const { root, places } = uploaded({
			"runs/parity-localhost_5555-x.json": '{"differingPixels": 123456}',
			"out/lane-a11y.log": "signed in with 123456",
			"out/lane-parity.log": `and ${address}`,
		});
		try {
			const found = await artifactHits(places, root, true);
			expect(found.map((hit) => [hit.path, hit.kind, hit.deleted]).sort()).toEqual([
				["out/lane-a11y.log", "code", false],
				["out/lane-parity.log", "address", true],
				["runs/parity-localhost_5555-x.json", "code", false],
			]);
			expect(existsSync(join(root, "runs", "parity-localhost_5555-x.json"))).toBe(true);
			expect(existsSync(join(root, "out", "lane-a11y.log"))).toBe(true);
			expect(existsSync(join(root, "out", "lane-parity.log"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a file that cannot be deleted is a hit that says so, not a pass", async () => {
		useAccount(address);
		const { root, places } = uploaded({ "out/lane-parity.log": address });
		try {
			chmodSync(places.out, 0o500);
			const found = await artifactHits(places, root, true);
			expect(found).toHaveLength(1);
			expect(found[0]?.deleted).toBe(false);
			expect(found[0]?.failed).toBeDefined();
			expect(JSON.stringify(found)).not.toContain("example.test");
		} finally {
			chmodSync(places.out, 0o700);
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("the command", () => {
	async function run(argv: string[], deps: Parameters<typeof leakcheck>[1]) {
		const out: string[] = [];
		const log = console.log;
		const error = console.error;
		console.log = (...parts: unknown[]) => void out.push(parts.join(" "));
		console.error = (...parts: unknown[]) => void out.push(parts.join(" "));
		try {
			await leakcheck(argv, deps);
		} finally {
			console.log = log;
			console.error = error;
		}
		const status = process.exitCode;
		process.exitCode = 0;
		return { out: out.join("\n"), status };
	}

	test("with no account configured, --artifacts has nothing to look for and passes", async () => {
		const result = await run(["--artifacts", "--purge"], {});
		expect(result.status ?? 0).toBe(0);
		expect(result.out).toContain("no QA account is configured");
	});

	test("the uploaded files are purged before git is asked anything, and a git that fails cannot skip it", async () => {
		useAccount(address);
		const { root, places } = uploaded({ "runs/parity-localhost_5555-x/a.attempt1.uidump.xml": `<node text="${address}"/>`, "out/lane-parity.log": `copy ${address}` });
		const asked: string[] = [];
		try {
			const result = await run(["--purge"], {
				places,
				git: async (args) => {
					// By now the uploaded files are gone.
					asked.push(`${args[0]} (files left: ${existsSync(join(root, "out", "lane-parity.log")) ? "yes" : "no"})`);
					throw new Error("fatal: not a git repository");
				},
			});
			expect(result.status).toBe(1);
			expect(asked[0]).toBe("diff (files left: no)");
			expect(existsSync(join(root, "runs", "parity-localhost_5555-x", "a.attempt1.uidump.xml"))).toBe(false);
			expect(result.out).toContain("uploaded (deleted): ");
			expect(result.out).toContain("git could not read the staged diff: fatal: not a git repository");
			expect(result.out).not.toContain("example.test");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("--artifacts never calls git", async () => {
		useAccount(address);
		const { root, places } = uploaded({ "out/lane-parity.log": `copy ${address}` });
		try {
			const result = await run(["--artifacts", "--purge"], {
				places,
				git: async () => {
					throw new Error("git was called");
				},
			});
			expect(result.status).toBe(1);
			expect(result.out).not.toContain("git");
			expect(existsSync(join(root, "out", "lane-parity.log"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
