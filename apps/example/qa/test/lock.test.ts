import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	channelLock,
	forwardHost,
	isHeld,
	remoteArguments,
	resolveEmulatorLock,
	runPlain,
	runUnderLock,
	tunnelHost,
	type Lock,
} from "../lib/lock.ts";

const dir = mkdtempSync(join(tmpdir(), "native-qa-lock-"));
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
	rmSync(channelLock("qa-locktest"), { force: true });
});

/** A stand-in for `ssh`: the last argument is the remote command and the "remote" host is this machine. */
const fakeBin = join(dir, "bin");
spawnSync("mkdir", ["-p", fakeBin]);
writeFileSync(join(fakeBin, "ssh"), '#!/usr/bin/env bash\ncmd="${@: -1}"\nexec bash -c "$cmd"\n');
chmodSync(join(fakeBin, "ssh"), 0o755);
process.env.PATH = `${fakeBin}:${process.env.PATH}`;

let counter = 0;
const fresh = (name: string): string => join(dir, `${name}-${++counter}`);
const free = (file: string): boolean => spawnSync("flock", ["-n", file, "true"]).status === 0;
const local = (file: string): Lock => ({ kind: "local", file });
const remote = (file: string): Lock => ({ kind: "remote", host: "ovh-root", file });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A command that says (by creating `marker`) that it holds the lock, then keeps it for `seconds`. */
const holding = (marker: string, seconds: number): string[] => ["bash", "-c", `touch ${marker}; sleep ${seconds}`];
async function until(path: string): Promise<void> {
	for (let waited = 0; !existsSync(path); waited += 25) {
		if (waited > 10_000) throw new Error(`${path} never appeared`);
		await sleep(25);
	}
}

describe("which lock a serial takes", () => {
	const noTunnel = () => null;
	test("only the emulator takes one", () => {
		expect(resolveEmulatorLock("R58Y90KNGRP", {}, noTunnel)).toBeNull();
		expect(resolveEmulatorLock("E74A5608-BF8E-5806-8699-1605F82ADED9", {}, noTunnel)).toBeNull();
	});
	test("without a tunnel and without the shared directory it is the old local file", () => {
		expect(resolveEmulatorLock("localhost:5555", {}, noTunnel, false)).toEqual(local("/tmp/svelte-qa-emulator.lock"));
	});
	test("on the OVH host the shared directory makes the local lock the shared file", () => {
		expect(resolveEmulatorLock("localhost:5555", {}, noTunnel, true)).toEqual(local("/run/svelte-qa/emulator.lock"));
	});
	test("an ssh tunnel on the port makes the lock the tunnel host's", () => {
		expect(resolveEmulatorLock("localhost:5555", {}, (port) => (port === 5555 ? "ovh-root" : null), false)).toEqual(
			remote("/run/svelte-qa/emulator.lock"),
		);
		expect(resolveEmulatorLock("emulator-5554", {}, () => "ovh-root", false)).toEqual(local("/tmp/svelte-qa-emulator.lock"));
	});
	test("NATIVE_QA_LOCK_HOST decides, and local turns the tunnel off", () => {
		expect(resolveEmulatorLock("localhost:5555", { NATIVE_QA_LOCK_HOST: "qa@host" }, noTunnel, false)).toEqual({
			kind: "remote",
			host: "qa@host",
			file: "/run/svelte-qa/emulator.lock",
		});
		expect(resolveEmulatorLock("localhost:5555", { NATIVE_QA_LOCK_HOST: "local" }, () => "ovh-root", false)).toEqual(
			local("/tmp/svelte-qa-emulator.lock"),
		);
	});
	test("NATIVE_QA_LOCK_FILE names the file on either side", () => {
		expect(resolveEmulatorLock("localhost:5555", { NATIVE_QA_LOCK_FILE: "/x/y.lock" }, noTunnel)).toEqual(local("/x/y.lock"));
		expect(resolveEmulatorLock("localhost:5555", { NATIVE_QA_LOCK_FILE: "/x/y.lock", NATIVE_QA_LOCK_HOST: "h" }, noTunnel)).toEqual({
			kind: "remote",
			host: "h",
			file: "/x/y.lock",
		});
	});
});

describe("finding the tunnel", () => {
	test("-L from the local port to the destination's own loopback", () => {
		expect(forwardHost(["ssh", "-f", "-N", "-L", "5555:127.0.0.1:5555", "ovh-root"], 5555)).toBe("ovh-root");
		expect(forwardHost(["ssh", "-N", "-L5555:localhost:5555", "root@51.1.2.3"], 5555)).toBe("root@51.1.2.3");
		expect(forwardHost(["ssh", "-N", "-L", "127.0.0.1:5555:127.0.0.1:5555", "ovh-root"], 5555)).toBe("ovh-root");
	});
	test("not a tunnel to the emulator: another port, another target, no forward", () => {
		expect(forwardHost(["ssh", "-N", "-L", "8181:127.0.0.1:8181", "ovh-root"], 5555)).toBeNull();
		expect(forwardHost(["ssh", "-N", "-L", "5555:10.0.0.9:5555", "ovh-root"], 5555)).toBeNull();
		expect(forwardHost(["ssh", "-N", "-R", "5555:127.0.0.1:5555", "ovh-root"], 5555)).toBeNull();
		expect(forwardHost(["ssh", "-N", "-L", "5555:127.0.0.1:5555"], 5555)).toBeNull();
	});
	test("the listener of the port is read from ss and /proc", () => {
		const listener = 'LISTEN 0 128 127.0.0.1:5555 0.0.0.0:* users:(("ssh",pid=4242,fd=5))\n';
		const cmdline = (pid: string) => (pid === "4242" ? "ssh\0-f\0-N\0-L\0 5555:127.0.0.1:5555\0ovh-root\0".replace(" ", "") : "");
		expect(tunnelHost(5555, () => listener, cmdline)).toBe("ovh-root");
		expect(tunnelHost(5555, () => 'LISTEN 0 4096 127.0.0.1:5555 0.0.0.0:* users:(("adb",pid=7,fd=9))', cmdline)).toBeNull();
		expect(tunnelHost(5555, () => "", cmdline)).toBeNull();
	});
});

describe("a local lock", () => {
	test("runs the command with the lock marked held, returns its status and lets go", async () => {
		const file = fresh("local.lock");
		const out = fresh("out");
		const code = await runUnderLock(local(file), ["bash", "-c", `echo "$NATIVE_QA_LOCK_HELD" > ${out}; ! flock -n ${file} true; exit 7`]);
		expect(code).toBe(7);
		expect(readFileSync(out, "utf8").trim()).toBe(file);
		expect(isHeld(local(file), { NATIVE_QA_LOCK_HELD: readFileSync(out, "utf8").trim() })).toBe(true);
		expect(free(file)).toBe(true);
	});
	test("a second command waits for the first", async () => {
		const file = fresh("local.lock");
		const log = fresh("log");
		const marker = fresh("marker");
		const first = runUnderLock(local(file), ["bash", "-c", `echo a-start >> ${log}; touch ${marker}; sleep 1; echo a-end >> ${log}`]);
		await until(marker);
		const second = runUnderLock(local(file), ["bash", "-c", `echo b >> ${log}`]);
		expect(await first).toBe(0);
		expect(await second).toBe(0);
		expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["a-start", "a-end", "b"]);
	});
	test("gives up after the wait", async () => {
		const file = fresh("local.lock");
		const marker = fresh("marker");
		const holder = runUnderLock(local(file), holding(marker, 3));
		await until(marker);
		await expect(runUnderLock(local(file), ["true"], { wait: 1 })).rejects.toThrow("gave up waiting");
		await holder;
	}, 15_000);
	test("a command with no lock just runs", async () => {
		expect(await runPlain(["bash", "-c", "exit 3"])).toBe(3);
	});
});

describe("the emulator lock and a channel lock together (native-qa updates)", () => {
	test("the channel lock is a local lock of its own, taken inside the emulator lock, and both are marked held", async () => {
		const emulator = { kind: "remote" as const, host: "ovh-root", file: fresh("emulator.lock") };
		const channel = local(channelLock("qa-locktest"));
		const out = fresh("out");
		// What `updates` does after the emulator lock re-ran it: take the channel's lock in the process the first one started.
		const script = fresh("inner.ts");
		writeFileSync(
			script,
			`import { runUnderLock } from ${JSON.stringify(join(import.meta.dirname, "../lib/lock.ts"))};
process.exit(await runUnderLock(${JSON.stringify(channel)}, ["bash", "-c", 'echo "$NATIVE_QA_LOCK_HELD" > ${out}']));
`,
		);
		const code = await runUnderLock(emulator, [process.execPath, script]);
		expect(code).toBe(0);
		const held = readFileSync(out, "utf8").trim();
		expect(held).toBe(`${emulator.host}:${emulator.file}|${channel.file}`);
		expect(isHeld(emulator, { NATIVE_QA_LOCK_HELD: held })).toBe(true);
		expect(isHeld(channel, { NATIVE_QA_LOCK_HELD: held })).toBe(true);
		expect(free(emulator.file)).toBe(true);
		expect(free(channel.file)).toBe(true);
	}, 20_000);
	test("a run that holds the channel lock does not hold the emulator's, and the other way round", async () => {
		const channel = local(fresh("channel.lock"));
		const emulator = local(fresh("emulator.lock"));
		const marker = fresh("marker");
		const holder = runUnderLock(channel, holding(marker, 1));
		await until(marker);
		expect(free(emulator.file)).toBe(true);
		expect(await runUnderLock(emulator, ["true"])).toBe(0);
		await holder;
	});
});

describe("a remote lock", () => {
	test("is taken over ssh, held for the command, released after it", async () => {
		const file = fresh("remote.lock");
		const out = fresh("out");
		const code = await runUnderLock(remote(file), ["bash", "-c", `echo "$NATIVE_QA_LOCK_HELD" > ${out}; ! flock -n ${file} true; exit 5`]);
		expect(code).toBe(5);
		expect(readFileSync(out, "utf8").trim()).toBe(`ovh-root:${file}`);
		expect(free(file)).toBe(true);
	});
	test("excludes a local flock on the same file, which is how the host's own jobs take it", async () => {
		const file = fresh("remote.lock");
		const log = fresh("log");
		const marker = fresh("marker");
		const remoteRun = runUnderLock(remote(file), ["bash", "-c", `echo r-start >> ${log}; touch ${marker}; sleep 1; echo r-end >> ${log}`]);
		await until(marker);
		const localRun = runUnderLock(local(file), ["bash", "-c", `echo l >> ${log}`]);
		expect(await remoteRun).toBe(0);
		expect(await localRun).toBe(0);
		expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["r-start", "r-end", "l"]);
	});
	test("waits for a local holder and says so", async () => {
		const file = fresh("remote.lock");
		const marker = fresh("marker");
		const holder = runUnderLock(local(file), holding(marker, 1));
		await until(marker);
		expect(await runUnderLock(remote(file), ["true"])).toBe(0);
		await holder;
	});
	test("gives up after the wait", async () => {
		const file = fresh("remote.lock");
		const marker = fresh("marker");
		const holder = runUnderLock(local(file), holding(marker, 3));
		await until(marker);
		await expect(runUnderLock(remote(file), ["true"], { wait: 1 })).rejects.toThrow("gave up waiting");
		await holder;
	}, 15_000);
	test("heartbeats keep it past the dead man's time", async () => {
		const file = fresh("remote.lock");
		const code = await runUnderLock(remote(file), ["bash", "-c", "sleep 3"], { deadmanSeconds: 2, heartbeatMs: 400 });
		expect(code).toBe(0);
	}, 15_000);
	test("a session that goes silent loses it, and the command is stopped", async () => {
		const file = fresh("remote.lock");
		const started = Date.now();
		const code = await runUnderLock(remote(file), ["bash", "-c", "sleep 30"], { deadmanSeconds: 1, heartbeatMs: 600_000 });
		expect(code).toBe(1);
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(free(file)).toBe(true);
	}, 20_000);
	test("a command that cannot start is an error, not a held lock", async () => {
		const file = fresh("remote.lock");
		await expect(runUnderLock(remote(file), ["/nonexistent/program"])).rejects.toThrow();
		expect(free(file)).toBe(true);
	});
	test("the ssh invocation never asks a question and leaves multiplexing to the user's configuration", () => {
		const args = remoteArguments({ kind: "remote", host: "ovh-root", file: "/run/svelte-qa/emulator.lock" }, 0, 300);
		expect(args).toContain("BatchMode=yes");
		expect(args.join(" ")).not.toContain("Control");
		expect(args[args.length - 2]).toBe("ovh-root");
		expect(args[args.length - 1]).toMatch(/^bash -c '.*' bash '\/run\/svelte-qa\/emulator.lock' 0 300$/s);
	});
});
