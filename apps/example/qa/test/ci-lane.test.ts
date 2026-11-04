import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "native-qa-lane-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;

/**
 * A checkout of just `qa/ci`, so the lane's `cd ../..` lands in a directory of its own, with a stand-in harness that logs its
 * arguments (one line per call in `calls`) and fails the commands named in FAIL_ON, and a stand-in emulator script.
 */
function lane() {
	const checkout = join(root, `checkout-${++counter}`);
	const platform = join(checkout, "apps", "platform");
	mkdirSync(join(platform, "qa"), { recursive: true });
	cpSync(join(import.meta.dirname, "..", "ci"), join(platform, "qa", "ci"), { recursive: true });
	const calls = join(checkout, "calls");
	const cli = join(checkout, "cli.sh");
	writeFileSync(
		cli,
		`#!/usr/bin/env bash
echo "cli $*" >> "${calls}"
cmd=$1
if [ "$cmd" = hold ]; then shift; while [ "$1" != -- ]; do shift; done; shift; exec "$@"; fi
for a in "$@"; do
  if [ "$prev" = --markdown ]; then echo "### Gates stand-in for $cmd" > "$a"; fi
  prev=$a
done
echo "output of $cmd"
case ",\${FAIL_ON:-}," in *",$cmd,"*) echo "$cmd broke" >&2; exit 1 ;; esac
if [ "$cmd" = crashes ] && [ -n "\${CRASHES_FAIL_FIRST:-}" ] && [ ! -e "${checkout}/crashed" ]; then touch "${checkout}/crashed"; exit 1; fi
exit 0
`,
	);
	const emulator = join(checkout, "emulator.sh");
	writeFileSync(
		emulator,
		`#!/usr/bin/env bash
echo "emulator $*" >> "${calls}"
case "$1" in
  rss) echo 5 ;;
  restart) [ -n "\${FAIL_RESTART:-}" ] && { echo "no boot"; exit 1; }; echo restarted ;;
  *) echo "$1 ok" ;;
esac
`,
	);
	for (const file of [cli, emulator]) chmodSync(file, 0o755);
	const summary = join(checkout, "summary.md");
	const run = (phase: string, env: Record<string, string> = {}) =>
		spawnSync("bash", [join(platform, "qa", "ci", "lane.sh"), phase], {
			cwd: platform,
			env: { ...process.env, QA_CLI: `bash ${cli}`, QA_EMULATOR_SH: emulator, GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: "0123456789abcdef", RASHEED_QA_EMAIL: "", ...env },
			encoding: "utf8",
		});
	const lines = (): string[] => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
	const stages = (): string[][] => {
		const file = join(platform, "qa", "out", "lane-stages.tsv");
		return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((line) => line.split("\t")) : [];
	};
	const read = (path: string): string => readFileSync(join(platform, path), "utf8");
	return { platform, run, lines, stages, read, summary: () => (existsSync(summary) ? readFileSync(summary, "utf8") : "") };
}

const harness = (calls: string[]): string[] => calls.filter((line) => line.startsWith("cli ")).map((line) => line.slice(4));

describe("lane.sh emulator on a push", () => {
	test("a fresh emulator, then the quick lane, the product boot check, report and the gates of what ran", () => {
		const machine = lane();
		const result = machine.run("emulator", { QA_REPEAT: "3" });
		expect(result.status).toBe(0);
		expect(machine.lines()[0]).toBe("emulator restart fresh instance for the lane");
		expect(harness(machine.lines())).toEqual([
			"lab --device localhost:5555 --repeat 3",
			"parity --device localhost:5555 --quick",
			"a11y --device localhost:5555 --no-install --quick",
			"gestures --device localhost:5555 --no-install --input both",
			"product --device localhost:5555",
			"report",
			"gates --platform android --runs lab,parity,a11y,gestures,product --except lab.runs,parity.signedIn.missing,a11y.signedIn.missing --markdown qa/out/gates.md",
		]);
		expect(machine.stages().every((row) => row[1] === "pass")).toBe(true);
		expect(machine.stages().map((row) => row[0])).toEqual([
			"emulator-restart", "lab", "guard-parity", "parity", "guard-a11y", "a11y", "guard-gestures", "gestures", "guard-product", "product", "report", "gates",
		]);
	});
	test("the emulator is checked before every stage that follows the first", () => {
		const machine = lane();
		machine.run("emulator");
		const sequence = machine.lines().map((line) => line.split(" ").slice(0, 2).join(" "));
		expect(sequence.indexOf("emulator guard")).toBeGreaterThan(sequence.indexOf("cli lab"));
		expect(sequence.filter((entry) => entry === "emulator guard")).toHaveLength(4);
	});
	test("a stage that fails does not stop the others, and the lane fails", () => {
		const machine = lane();
		const result = machine.run("emulator", { FAIL_ON: "parity" });
		expect(result.status).toBe(1);
		expect(harness(machine.lines()).map((line) => line.split(" ")[0])).toEqual(["lab", "parity", "a11y", "gestures", "product", "report", "gates"]);
		expect(machine.stages().find((row) => row[0] === "parity")?.[1]).toBe("fail(1)");
		expect(machine.stages().find((row) => row[0] === "gates")?.[1]).toBe("pass");
		expect(result.stdout).toContain("::error title=parity failed::");
		expect(machine.read("qa/out/lane-parity.log")).toContain("parity broke");
	});
	test("a product that does not boot fails the lane, after every stage of the QA app and before the report", () => {
		const machine = lane();
		const result = machine.run("emulator", { FAIL_ON: "product" });
		expect(result.status).toBe(1);
		expect(machine.stages().find((row) => row[0] === "product")?.[1]).toBe("fail(1)");
		expect(machine.stages().filter((row) => row[1] === "pass").map((row) => row[0])).toContain("gestures");
		expect(machine.stages().find((row) => row[0] === "gates")?.[1]).toBe("pass");
		expect(harness(machine.lines()).slice(-2)[0]).toBe("report");
		expect(result.stdout).toContain("::error title=product failed::");
		expect(machine.read("qa/out/lane-product.log")).toContain("product broke");
	});
	test("failing gates fail the lane", () => {
		const machine = lane();
		expect(machine.run("emulator", { FAIL_ON: "gates" }).status).toBe(1);
	});
	test("an emulator that does not come back ends the lane before anything is measured", () => {
		const machine = lane();
		const result = machine.run("emulator", { FAIL_RESTART: "1" });
		expect(result.status).toBe(1);
		expect(harness(machine.lines())).toEqual([]);
		expect(result.stdout).toContain("no emulator");
	});
});

describe("lane.sh emulator on a dispatch", () => {
	test("boot, the full matrices, resilience, the smoke app, and every gate judged", () => {
		const machine = lane();
		const result = machine.run("emulator", { QA_MODE: "full", QA_REPEAT: "10", QA_WARM: "30", QA_COLD: "30", QA_SMOKE: "1" });
		expect(result.status).toBe(0);
		expect(harness(machine.lines())).toEqual([
			"lab --device localhost:5555 --repeat 10",
			"boot --device localhost:5555 --warm 30 --cold 30",
			"parity --device localhost:5555",
			"a11y --device localhost:5555 --no-install",
			"resilience --device localhost:5555 --no-install",
			"gestures --device localhost:5555 --no-install --input both",
			"smoke --device localhost:5555",
			"product --device localhost:5555",
			"report",
			"gates --platform android --runs lab,boot,parity,a11y,resilience,gestures,product --except parity.signedIn.missing,a11y.signedIn.missing --markdown qa/out/gates.md",
			"gates --smoke --platform android --runs smoke --markdown qa/out/gates-smoke.md",
		]);
	});
	test("with the QA account the signed-in gates are judged on a dispatch, and without it the lane says they are not", () => {
		const without = lane();
		const warned = without.run("emulator", { QA_MODE: "full", RASHEED_QA_EMAIL: "" });
		expect(warned.stdout).toContain("::warning title=no QA account::");
		expect(harness(without.lines()).at(-1)).toContain("--except parity.signedIn.missing,a11y.signedIn.missing");
		const withAccount = lane();
		const judged = withAccount.run("emulator", { QA_MODE: "full", RASHEED_QA_EMAIL: "qa-account-stand-in" });
		expect(judged.stdout).not.toContain("no QA account");
		expect(judged.stdout).not.toContain("qa-account-stand-in");
		const ran = harness(withAccount.lines());
		expect(ran.at(-2)).toBe("gates --platform android --runs lab,boot,parity,a11y,resilience,gestures,product --markdown qa/out/gates.md");
		// The run files are uploaded as an artifact: with the account in hand the lane reads them for it after the gates and deletes what holds it.
		expect(ran.at(-1)).toBe("leakcheck --staged --purge");
		expect(harness(without.lines()).some((line) => line.startsWith("leakcheck"))).toBe(false);
	});
	test("without QA_SMOKE the smoke app is neither run nor judged", () => {
		const machine = lane();
		machine.run("emulator", { QA_MODE: "full" });
		expect(harness(machine.lines()).some((line) => line.includes("smoke"))).toBe(false);
	});
	test("the update scenario runs after the others, on the channel, then the product boot check, and the run kinds are judged", () => {
		const machine = lane();
		const result = machine.run("emulator", { QA_MODE: "full", QA_REPEAT: "10", QA_WARM: "30", QA_COLD: "30", QA_SMOKE: "1", QA_UPDATES: "1" });
		expect(result.status).toBe(0);
		expect(harness(machine.lines()).slice(-6)).toEqual([
			"smoke --device localhost:5555",
			"updates --device localhost:5555 --channel qa --warm 30",
			"product --device localhost:5555",
			"report",
			"gates --platform android --runs lab,boot,parity,a11y,resilience,gestures,updates,product --except parity.signedIn.missing,a11y.signedIn.missing --markdown qa/out/gates.md",
			"gates --smoke --platform android --runs smoke --markdown qa/out/gates-smoke.md",
		]);
		expect(machine.stages().map((row) => row[0])).toContain("guard-updates");
	});
	test("a channel of its own is used for the build, the run and nothing else", () => {
		const machine = lane();
		machine.run("emulator", { QA_MODE: "full", QA_UPDATES: "1", QA_CHANNEL: "qa-ci" });
		expect(harness(machine.lines()).find((line) => line.startsWith("updates"))).toBe("updates --device localhost:5555 --channel qa-ci --warm 30");
	});
	test("a push never runs the update scenario, whatever the environment says: it publishes to EAS", () => {
		const machine = lane();
		machine.run("emulator", { QA_UPDATES: "1" });
		expect(harness(machine.lines()).some((line) => line.includes("updates"))).toBe(false);
		const build = lane();
		build.run("build", { QA_UPDATES: "1" });
		expect(harness(build.lines())).toEqual(["build --abi x86_64", "build --abi x86_64 --variant production"]);
	});
	test("a failed update scenario fails the lane and the others still ran", () => {
		const machine = lane();
		const result = machine.run("emulator", { QA_MODE: "full", QA_UPDATES: "1", FAIL_ON: "updates" });
		expect(result.status).toBe(1);
		expect(machine.stages().find((row) => row[0] === "updates")?.[1]).toBe("fail(1)");
		expect(machine.stages().find((row) => row[0] === "gates")?.[1]).toBe("pass");
	});
});

describe("lane.sh with QA_ONLY (one kind of stage, from a terminal)", () => {
	test("the product boot check alone: its build, a fresh emulator, its stage, and only its gates", () => {
		const machine = lane();
		expect(machine.run("build", { QA_ONLY: "product" }).status).toBe(0);
		expect(harness(machine.lines())).toEqual(["build --abi x86_64 --variant production"]);
		const result = machine.run("emulator", { QA_ONLY: "product" });
		expect(result.status).toBe(0);
		expect(harness(machine.lines()).slice(1)).toEqual([
			"product --device localhost:5555",
			"report",
			"gates --platform android --runs product --except lab.runs,parity.signedIn.missing,a11y.signedIn.missing --markdown qa/out/gates.md",
		]);
		expect(machine.lines()).toContain("emulator restart fresh instance for the lane");
	});
	test("kinds the mode does not have are not run, and a list with none of the mode's is an error", () => {
		const push = lane();
		push.run("emulator", { QA_ONLY: "lab,boot,smoke" });
		expect(harness(push.lines()).map((line) => line.split(" ")[0])).toEqual(["lab", "report", "gates"]);
		expect(harness(push.lines()).at(-1)).toContain("--runs lab ");
		const none = lane();
		const result = none.run("emulator", { QA_ONLY: "boot" });
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("::error title=nothing to run::");
		expect(harness(none.lines())).toEqual([]);
	});
	test("a build for the QA app's kinds (the crash volume's too) leaves the product's out", () => {
		const machine = lane();
		machine.run("build", { QA_ONLY: "lab,parity" });
		expect(harness(machine.lines())).toEqual(["build --abi x86_64"]);
		const crashes = lane();
		crashes.run("build", { QA_ONLY: "crashes" });
		expect(harness(crashes.lines())).toEqual(["build --abi x86_64"]);
	});
});

describe("lane.sh build, reset and summary", () => {
	test("build makes the QA app and the product for x86_64 only, and the smoke app only in full mode when asked", () => {
		const push = lane();
		expect(push.run("build", { QA_SMOKE: "1" }).status).toBe(0);
		expect(harness(push.lines())).toEqual(["build --abi x86_64", "build --abi x86_64 --variant production"]);
		expect(push.stages().map((row) => row[0])).toEqual(["build-qa", "build-product"]);
		const full = lane();
		full.run("build", { QA_MODE: "full", QA_SMOKE: "1", QA_SAMSUNGPAY_JAR: "/nonexistent" });
		expect(harness(full.lines())).toEqual(["build --abi x86_64", "build --abi x86_64 --variant production", "build --abi x86_64 --variant smoke"]);
		for (const call of [...harness(push.lines()), ...harness(full.lines())]) expect(call).not.toContain("arm64");
	});
	test("the channel build follows the others in full mode when the update scenario is asked for", () => {
		const machine = lane();
		expect(machine.run("build", { QA_MODE: "full", QA_UPDATES: "1", QA_CHANNEL: "qa" }).status).toBe(0);
		expect(harness(machine.lines())).toEqual(["build --abi x86_64", "build --abi x86_64 --variant production", "build --abi x86_64 --updates-channel qa"]);
		expect(machine.stages().map((row) => row[0])).toEqual(["build-qa", "build-product", "build-updates"]);
	});
	test("a failed build is a failed step, and a failed QA build does not hide the product's", () => {
		expect(lane().run("build", { FAIL_ON: "build" }).status).toBe(1);
		const machine = lane();
		machine.run("build", { FAIL_ON: "build" });
		expect(machine.stages().map((row) => row[0])).toEqual(["build-qa", "build-product"]);
	});
	test("reset forgets the last lane", () => {
		const machine = lane();
		mkdirSync(join(machine.platform, "qa", "runs"), { recursive: true });
		mkdirSync(join(machine.platform, "qa", "out"), { recursive: true });
		for (const file of ["qa/runs/lab-x.json", "qa/report.json", "qa/out/lane-stages.tsv", "qa/out/gates.md", "qa/out/build-qa.log", "qa/out/app-x86_64.apk"])
			writeFileSync(join(machine.platform, file), "old");
		machine.run("reset");
		expect(existsSync(join(machine.platform, "qa/runs"))).toBe(false);
		expect(existsSync(join(machine.platform, "qa/report.json"))).toBe(false);
		expect(existsSync(join(machine.platform, "qa/out/lane-stages.tsv"))).toBe(false);
		expect(existsSync(join(machine.platform, "qa/out/build-qa.log"))).toBe(false);
		expect(existsSync(join(machine.platform, "qa/out/app-x86_64.apk"))).toBe(true);
	});
	test("the summary has the stage table, the gate table and the tail of a failed stage", () => {
		const machine = lane();
		machine.run("emulator", { FAIL_ON: "a11y" });
		const summary = machine.run("summary");
		expect(summary.status).toBe(0);
		const text = machine.summary();
		expect(text).toContain("## Android emulator lane (push, 012345678)");
		expect(text).toContain("| lab | pass | 0m0");
		expect(text).toContain("| a11y | **fail(1)** |");
		expect(text).toContain("### Gates stand-in for gates");
		expect(text).toContain("Last lines of stage <code>a11y</code>");
		expect(text).toContain("a11y broke");
	});
	test("a lane that never started says so", () => {
		const machine = lane();
		machine.run("summary");
		expect(machine.summary()).toContain("No stage ran");
	});
});

describe("lane.sh crashes", () => {
	test("a chunk that failed is resumed, and the attempt that made it up is the lane's result", () => {
		const machine = lane();
		const result = machine.run("crashes", { CRASHES_FAIL_FIRST: "1" });
		expect(result.status).toBe(0);
		const crashes = harness(machine.lines()).filter((line) => line.startsWith("crashes"));
		expect(crashes).toEqual([
			"crashes --device localhost:5555 --starts 1000 --suites 100 --chunk 100",
			"crashes --device localhost:5555 --starts 1000 --suites 100 --chunk 100 --resume",
		]);
		expect(harness(machine.lines()).at(-1)).toBe("gates --platform android --runs crashes --except lab.runs --markdown qa/out/gates.md");
	});
	test("a volume that never completes fails the lane after six attempts", () => {
		const machine = lane();
		const result = machine.run("crashes", { FAIL_ON: "crashes" });
		expect(result.status).toBe(1);
		expect(harness(machine.lines()).filter((line) => line.startsWith("crashes"))).toHaveLength(6);
	});
});
