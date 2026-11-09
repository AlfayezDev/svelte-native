import { describe, expect, test } from "bun:test";
import { runPlan, restoreHints } from "../commands/ios-resilience.ts";
import type { ExecResult } from "../lib/exec.ts";
import { macFrom, scriptOf, type Run } from "../lib/iphone/mac.ts";
import type { IosSession } from "../lib/iphone/session.ts";
import { buildIosPlan, fullPlan, resultsFor, startedLine, whyStopped } from "../lib/iphone/resilience.ts";

// `runPlan` against a Mac that answers the way the real one does (ssh, xcodebuild in the background, devicectl copies), to see the wiring end to end:
// the command that starts the test, the wait, the reading of the output, the build the app reported and what the navigation module wrote.
const token = "tok9";
const identity = { jsbundleSha256: "a".repeat(64), cdHash: "b".repeat(40) };
const plan = buildIosPlan({ rotationCycles: 1, backgroundCycles: 2, killRounds: 1 }, token);

function printed(count: number): string {
	return [
		`${startedLine} {"steps":${plan.length}}`,
		...plan.slice(0, count).map((_, at) => `RESILIENCE-STEP ${JSON.stringify({ index: at + 1, ok: at !== 3, failures: at !== 3 ? [] : ["not on screen: the navigation bar \"Screen 1\""], recovered: at === 3, durationMs: 1000 })}`),
		"RESILIENCE-DONE",
		"Test Case '-[GesturesUITests.ResilienceUITests testPlan]' passed (60.0 seconds).",
	].join("\n");
}

function fakeMac(answers: { output: string; resilience?: string | null; last?: string | null; processes?: unknown[] }) {
	const scripts: string[] = [];
	let alive = true;
	const run: Run = async (_command, args): Promise<ExecResult> => {
		const script = scriptOf(args.at(-1) ?? "");
		scripts.push(script);
		let stdout = "";
		if (script.includes("nohup sh -c")) stdout = "4242\n";
		else if (script.includes("grep -c") && script.includes(startedLine)) stdout = "1\n";
		else if (script.includes("grep -c")) stdout = "3\n";
		else if (script.includes("kill -0 4242")) {
			stdout = alive ? "alive\n" : "";
			alive = false;
		} else if (script.includes("resilience-output-")) stdout = answers.output;
		else if (script.includes("Documents/resilience.json")) stdout = answers.resilience ?? "";
		else if (script.includes("svelte-navigation/last.json")) stdout = answers.last ?? "";
		else if (script.includes("info") && script.includes("processes")) stdout = JSON.stringify({ result: { runningProcesses: answers.processes ?? [] } });
		// devicectl copies of a file that is not there fail; everything else answers.
		const missing = (script.includes("Documents/resilience.json") && answers.resilience == null) || (script.includes("svelte-navigation/last.json") && answers.last == null);
		return { code: 0, stdout: `${stdout}\n__native_qa_status=${missing ? 1 : 0}\n`, stderr: "" };
	};
	return { mac: macFrom("me@mac", run), scripts };
}

function sessionOn(mac: ReturnType<typeof macFrom>): IosSession {
	return {
		target: { mac, id: "COREDEVICE", bundleId: "io.example.svelteqa" },
		udid: "00008110-001E10593410401E",
		installed: { bundleId: "io.example.svelteqa", name: "Example Svelte QA", version: "0.1.0", bundleVersion: "1", bundleUrl: "file:///private/var/containers/Bundle/Application/X/ExampleSvelteQA.app/" },
	} as IosSession;
}

describe("runPlan", () => {
	test("starts the test with the plan, waits for it, and brings back its steps, the build the app reported and the navigation module's account", async () => {
		const last = JSON.stringify({ at: 5, outcome: "restored", reason: "the surface started with the saved state", attempts: 1, systemKept: true, savedAt: 4 });
		const { mac, scripts } = fakeMac({ output: printed(plan.length), resilience: JSON.stringify({ schema: 1, token, build: identity }), last });
		const run = await runPlan(sessionOn(mac), plan, token, 60_000, { rotationCycles: 1, backgroundCycles: 2, killRounds: 1 }, 1);
		// The test is started once, in the background, with the plan in its environment and the only-testing selector.
		const started = scripts.filter((script) => script.includes("nohup sh -c"));
		expect(started).toHaveLength(1);
		expect(started[0]).toContain("TEST_RUNNER_RESILIENCE_PLAN=");
		expect(started[0]).toContain("-only-testing:GesturesUITests/ResilienceUITests/testPlan");
		expect(started[0]).toContain(token);
		expect(run.output?.done).toBe(true);
		expect(run.output?.steps).toHaveLength(plan.length);
		expect(run.ended).toBeNull();
		expect(run.identity).toEqual(identity);
		expect(run.navigation?.outcome).toBe("restored");
		// Nothing asked the phone while the test ran: the first devicectl call comes after the output was read.
		const firstDevicectl = scripts.findIndex((script) => script.includes("devicectl"));
		const outputRead = scripts.findIndex((script) => script.includes("resilience-output-"));
		expect(firstDevicectl).toBeGreaterThan(outputRead);
		// The steps become the run file's, one failed with its failure and the recovery noted.
		const results = resultsFor(plan, run.output, whyStopped(run.output, run.ended));
		expect(results.filter((step) => !step.ok).map((step) => [step.index, step.recovered])).toEqual([[4, true]]);
	});

	test("a file of an earlier run (another token) says nothing about this build", async () => {
		const { mac } = fakeMac({ output: printed(2), resilience: JSON.stringify({ schema: 1, token: "another", build: identity }), last: null });
		const run = await runPlan(sessionOn(mac), plan, token, 60_000, { rotationCycles: 1, backgroundCycles: 2, killRounds: 1 }, 1);
		expect(run.identity).toBeNull();
		expect(run.navigation).toBeNull();
		const results = resultsFor(plan, run.output, whyStopped(run.output, run.ended));
		// The steps the test never printed did not run, and say why.
		expect(results.slice(2).every((step) => !step.ok && step.failures[0]?.startsWith("the step did not run"))).toBe(true);
	});

	test("a test that printed nothing leaves every step not run", async () => {
		const { mac } = fakeMac({ output: "" });
		const run = await runPlan(sessionOn(mac), plan, token, 60_000, { rotationCycles: 1, backgroundCycles: 2, killRounds: 1 }, 1);
		expect(run.output).toBeNull();
		expect(resultsFor(plan, run.output, whyStopped(run.output, run.ended)).every((step) => step.failures[0]?.includes("produced no output"))).toBe(true);
	});

	test("--assume-system-kill reaches the plan the test receives", async () => {
		const { mac, scripts } = fakeMac({ output: printed(plan.length) });
		const options = { ...fullPlan, rotationCycles: 1, backgroundCycles: 2, killRounds: 1, assumeSystemKill: true };
		await runPlan(sessionOn(mac), buildIosPlan(options, token), token, 60_000, options, 1);
		expect(scripts.find((script) => script.includes("nohup sh -c"))).toContain("-SvelteNavigationAssumeSystemKill");
	});
});

describe("restoreHints", () => {
	test("is silent when every restart step passed", () => {
		expect(restoreHints(resultsFor(plan, null, "x").map((step) => ({ ...step, ok: true })), null)).toEqual([]);
	});
});

describe("the post-run reads when CoreDevice is wedged", () => {
	test("the build the app reported and the module's account come through house_arrest, with no devicectl call at all", async () => {
		const last = JSON.stringify({ at: 5, outcome: "none", reason: "no state was kept", attempts: 0, systemKept: false });
		const { mac, scripts } = fakeMac({ output: printed(plan.length), resilience: JSON.stringify({ schema: 1, token, build: identity }), last });
		const run = await runPlan(sessionOn(mac), plan, token, 60_000, { rotationCycles: 1, backgroundCycles: 2, killRounds: 1 }, 1);
		expect(run.identity).toEqual(identity);
		expect(run.navigation?.outcome).toBe("none");
		const afc = scripts.filter((script) => script.includes("afcclient"));
		expect(afc).toHaveLength(2);
		expect(afc[0]).toContain("io.example.svelteqa");
		expect(afc[0]).toContain("alarm shift; exec @ARGV");
		expect(afc[0]).toContain("Documents/resilience.json");
		expect(afc[1]).toContain("Library/Application Support/svelte-navigation/last.json");
		// The phone is asked once, for the process to end, after the files were read.
		const devicectl = scripts.filter((script) => script.includes("devicectl"));
		expect(devicectl.length).toBeGreaterThan(0);
		expect(scripts.findIndex((script) => script.includes("devicectl"))).toBeGreaterThan(scripts.findIndex((script) => script.includes("afcclient")));
	});
});
