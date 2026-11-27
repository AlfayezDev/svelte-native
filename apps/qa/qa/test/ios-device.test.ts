import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import type { ExecOptions, ExecResult } from "../lib/exec.ts";
import { appProcesses, launchApp, readAppFile } from "../lib/iphone/device.ts";
import { macFrom, remote, remoteOk, scriptOf, sshArgs, words, type Run } from "../lib/iphone/mac.ts";
import { launchArguments } from "../lib/iphone/capture.ts";

type Call = { command: string; args: string[]; options?: ExecOptions };

function recorder(answers: ExecResult[]): { run: Run; calls: Call[] } {
	const calls: Call[] = [];
	const run: Run = async (command, args, options) => {
		calls.push({ command, args, ...(options ? { options } : {}) });
		// As the Mac answers: ssh exits 0 whatever happened, the command's status is the line the wrapper prints last.
		const answer = answers.shift() ?? { code: 0, stdout: "", stderr: "" };
		return { code: 0, stdout: `${answer.stdout}\n__native_qa_status=${answer.code}\n`, stderr: answer.stderr };
	};
	return { run, calls };
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });
const remoteLine = (call: Call | undefined): string => scriptOf(call?.args[call.args.length - 1] ?? "");

describe("the Mac transport", () => {
	test("commands run through one shared ssh connection with the system tools on the PATH", () => {
		const { run } = recorder([]);
		const args = sshArgs(macFrom("me@mac", run), "echo hi");
		expect(args).toContain("BatchMode=yes");
		expect(args).toContain("ControlMaster=auto");
		expect(args[args.length - 2]).toBe("me@mac");
		// The whole script is one argument of an explicit `/bin/sh -c`: the Mac's login shell (zsh) only starts that.
		expect(args[args.length - 1]).toBe("/bin/sh -c 'export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; (\necho hi\n); printf '\\''\\n__native_qa_status=%d\\n'\\'' $?'");
		expect(scriptOf(args[args.length - 1] ?? "")).toBe("export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; (\necho hi\n); printf '\\n__native_qa_status=%d\\n' $?");
	});

	test("a script with quotes, dollars and a variable zsh ties to its PATH reaches the Mac's shell as it was written, under sh and under zsh", async () => {
		const script = `echo "it's $HOME" | wc -c > /dev/null; printf '%s\\n' "a'b"; while IFS= read -r path; do echo "$path"; done <<EOF\nx\nEOF\ncode=$?; echo "$PATH" | grep -q . && echo pathkept`;
		expect(scriptOf(sshArgs(macFrom("me@mac", async () => ({ code: 0, stdout: "", stderr: "" })), script).at(-1) ?? "")).toContain(script);
		for (const shell of ["/bin/sh", ...(existsSync("/usr/bin/zsh") ? ["/usr/bin/zsh"] : [])]) {
			const mac = macFrom("me@mac", (_command, args) => new Promise((resolve) => execFile(shell, ["-c", args[args.length - 1] ?? ""], (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }))));
			const result = await remote(mac, script);
			// Whatever shell receives the line, the script runs under `/bin/sh`: `path` is a plain variable there, and PATH is still there afterwards.
			expect(result).toEqual({ code: 0, stdout: "a'b\nx\npathkept\n", stderr: "" });
		}
	});

	test("the exit status comes from the status line, because the Mac's ssh answers 0 for a failed command", async () => {
		const answering = (stdout: string, code = 0) => macFrom("me@mac", async () => ({ code, stdout, stderr: "" }));
		const failed = await remote(answering("partial\n\n__native_qa_status=3\n"), "false");
		expect(failed.code).toBe(3);
		expect(failed.stdout).toBe("partial\n");
		const passed = await remote(answering("out\n__native_qa_status=0\n"), "true");
		expect(passed).toEqual({ code: 0, stdout: "out", stderr: "" });
		await expect(remoteOk(answering("\n__native_qa_status=1\n"), "false")).rejects.toThrow("exited with 1");
		// No status line: ssh failed (its own code stands) or the run was cut off (a 0 is not believed).
		expect((await remote(answering("", 255), "true")).code).toBe(255);
		expect((await remote(answering("cut off"), "true")).code).toBe(255);
	});

	test("the wrapped command reports its real status through a real shell, an exit inside it included", async () => {
		const shell = macFrom("me@mac", (_command, args) =>
			new Promise((resolve) =>
				execFile("/bin/sh", ["-c", args[args.length - 1] ?? ""], (error, stdout, stderr) =>
					resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
				),
			),
		);
		expect((await remote(shell, "echo a; exit 3")).code).toBe(3);
		expect(await remote(shell, "printf done")).toEqual({ code: 0, stdout: "done", stderr: "" });
		expect((await remote(shell, "false && echo no")).code).toBe(1);
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
		const target = { mac: macFrom("me@mac", run), id: "DEVICE-ID", bundleId: "dev.alfayez.exposvelte.qa" };
		const { pid } = await launchApp(target, { payloadUrl: "expo-svelte:///__dev?run=checks", args: launchArguments.rtl });
		expect(pid).toBe(4242);
		const line = remoteLine(calls[0]);
		expect(line).toContain("'--terminate-existing' '--device' 'DEVICE-ID' '--payload-url' 'expo-svelte:///__dev?run=checks' 'dev.alfayez.exposvelte.qa' '--' '-AppleLanguages' '(ar)' '-AppleLocale' 'ar_SA'");
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
		const target = { mac: macFrom("me@mac", run), id: "D", bundleId: "dev.alfayez.exposvelte.qa" };
		expect(await readAppFile(target, "Documents/lab-results.json")).toBe('{"a":1}');
		expect(calls).toHaveLength(1);
		expect(remoteLine(calls[0])).toContain("'--domain-type' 'appDataContainer' '--domain-identifier' 'dev.alfayez.exposvelte.qa' '--source' 'Documents/lab-results.json'");
		expect(await readAppFile(target, "Documents/missing.json")).toBeNull();
	});

	test("the app's processes are the ones running from inside its bundle", async () => {
		const processes = JSON.stringify({
			result: {
				runningProcesses: [
					{ processIdentifier: 1, executable: "file:///sbin/launchd" },
					{ processIdentifier: 77, executable: "file:///private/var/containers/Bundle/Application/ABC/ExpoSvelteQA.app/ExpoSvelteQA" },
					{ processIdentifier: 78, executable: "file:///private/var/containers/Bundle/Application/XYZ/Other.app/Other" },
				],
			},
		});
		const { run } = recorder([ok(processes)]);
		const target = { mac: macFrom("me@mac", run), id: "D", bundleId: "b" };
		const app = { bundleId: "b", name: "n", version: "1", bundleVersion: "1", bundleUrl: "file:///private/var/containers/Bundle/Application/ABC/ExpoSvelteQA.app/" };
		expect(await appProcesses(target, app)).toEqual([77]);
	});
});
