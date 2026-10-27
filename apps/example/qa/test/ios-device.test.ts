import { describe, expect, test } from "bun:test";
import type { ExecOptions, ExecResult } from "../lib/exec.ts";
import { appProcesses, launchApp, readAppFile } from "../lib/iphone/device.ts";
import { macFrom, sshArgs, words, type Run } from "../lib/iphone/mac.ts";
import { launchArguments } from "../lib/iphone/capture.ts";

type Call = { command: string; args: string[]; options?: ExecOptions };

function recorder(answers: ExecResult[]): { run: Run; calls: Call[] } {
	const calls: Call[] = [];
	const run: Run = async (command, args, options) => {
		calls.push({ command, args, ...(options ? { options } : {}) });
		return answers.shift() ?? { code: 0, stdout: "", stderr: "" };
	};
	return { run, calls };
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });
const remoteLine = (call: Call | undefined): string => call?.args[call.args.length - 1] ?? "";

describe("the Mac transport", () => {
	test("commands run through one shared ssh connection with the system tools on the PATH", () => {
		const { run } = recorder([]);
		const args = sshArgs(macFrom("me@mac", run), "echo hi");
		expect(args).toContain("BatchMode=yes");
		expect(args).toContain("ControlMaster=auto");
		expect(args[args.length - 2]).toBe("me@mac");
		expect(args[args.length - 1]).toBe("export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; echo hi");
	});

	test("the Mac must be named, by flag or environment", () => {
		const saved = process.env.NATIVE_QA_MAC;
		delete process.env.NATIVE_QA_MAC;
		try {
			expect(() => macFrom(undefined)).toThrow("--mac");
			process.env.NATIVE_QA_MAC = "env@mac";
			expect(macFrom(undefined).target).toBe("env@mac");
		} finally {
			if (saved === undefined) delete process.env.NATIVE_QA_MAC;
			else process.env.NATIVE_QA_MAC = saved;
		}
	});

	test("words quotes every word for the remote shell", () => {
		expect(words(["xcrun", "devicectl", "it's", "a b"])).toBe(`'xcrun' 'devicectl' 'it'\\''s' 'a b'`);
	});
});

describe("devicectl commands", () => {
	const launched = JSON.stringify({ result: { process: { processIdentifier: 4242 } } });

	test("launch ends a running instance, passes the payload URL and puts launch arguments after the bundle id", async () => {
		const { run, calls } = recorder([ok(launched)]);
		const target = { mac: macFrom("me@mac", run), id: "DEVICE-ID", bundleId: "io.rasheed.svelteqa" };
		const { pid } = await launchApp(target, { payloadUrl: "rasheed-svelte:///__dev?run=checks", args: launchArguments.rtl });
		expect(pid).toBe(4242);
		const line = remoteLine(calls[0]);
		expect(line).toContain("'--terminate-existing' '--device' 'DEVICE-ID' '--payload-url' 'rasheed-svelte:///__dev?run=checks' 'io.rasheed.svelteqa' '--' '-AppleLanguages' '(ar)' '-AppleLocale' 'ar_SA'");
		expect(line).toContain("'--json-output'");
	});

	test("a launch that is not to end a running instance says so", async () => {
		const { run, calls } = recorder([ok(launched)]);
		await launchApp({ mac: macFrom("me@mac", run), id: "D", bundleId: "b" }, { terminateExisting: false });
		expect(remoteLine(calls[0])).not.toContain("--terminate-existing");
	});

	test("a failing devicectl carries its own last lines", async () => {
		const { run } = recorder([{ code: 1, stdout: "", stderr: "ERROR: The device is locked." }]);
		await expect(launchApp({ mac: macFrom("me@mac", run), id: "D", bundleId: "b" })).rejects.toThrow("locked");
	});

	test("a file of the data container is read in one round trip, and null when it is not there", async () => {
		const { run, calls } = recorder([ok('{"a":1}'), { code: 1, stdout: "", stderr: "" }]);
		const target = { mac: macFrom("me@mac", run), id: "D", bundleId: "io.rasheed.svelteqa" };
		expect(await readAppFile(target, "Documents/lab-results.json")).toBe('{"a":1}');
		expect(calls).toHaveLength(1);
		expect(remoteLine(calls[0])).toContain("'--domain-type' 'appDataContainer' '--domain-identifier' 'io.rasheed.svelteqa' '--source' 'Documents/lab-results.json'");
		expect(await readAppFile(target, "Documents/missing.json")).toBeNull();
	});

	test("the app's processes are the ones running from inside its bundle", async () => {
		const processes = JSON.stringify({
			result: {
				runningProcesses: [
					{ processIdentifier: 1, executable: "file:///sbin/launchd" },
					{ processIdentifier: 77, executable: "file:///private/var/containers/Bundle/Application/ABC/RasheedSvelteQA.app/RasheedSvelteQA" },
					{ processIdentifier: 78, executable: "file:///private/var/containers/Bundle/Application/XYZ/Other.app/Other" },
				],
			},
		});
		const { run } = recorder([ok(processes)]);
		const target = { mac: macFrom("me@mac", run), id: "D", bundleId: "b" };
		const app = { bundleId: "b", name: "n", version: "1", bundleVersion: "1", bundleUrl: "file:///private/var/containers/Bundle/Application/ABC/RasheedSvelteQA.app/" };
		expect(await appProcesses(target, app)).toEqual([77]);
	});
});
