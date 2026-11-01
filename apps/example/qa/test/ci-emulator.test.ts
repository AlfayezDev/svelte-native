import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "ci", "emulator.sh");
const root = mkdtempSync(join(tmpdir(), "native-qa-emulator-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;

/**
 * A host with no emulator: `systemctl`, `sudo` and `adb` are scripts that log their calls and read their answers from files,
 * and /proc is a directory with one qemu in it. The script under test runs unchanged.
 */
function host(options: { rssGb?: number; booted?: number; adb?: string } = {}) {
	const dir = join(root, `host-${++counter}`);
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	mkdirSync(join(dir, "proc", "4242"), { recursive: true });
	const put = (name: string, text: string) => writeFileSync(join(dir, name), text);
	const stub = (name: string, body: string) => {
		writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
		chmodSync(join(bin, name), 0o755);
	};
	const rss = (gb: number) => put("proc/4242/status", `Name:\tqemu\nVmRSS:\t${gb * 1048576} kB\n`);
	rss(options.rssGb ?? 3);
	put("adb-state", options.adb ?? "device");
	put("boot-count", String(options.booted ?? 0));
	stub("sudo", '[ "$1" = -n ] && shift\nexec "$@"');
	stub("pgrep", "exit 1");
	stub(
		"systemctl",
		`echo "systemctl $*" >> "${dir}/calls"
case "$1" in
  show) echo 4242 ;;
  is-active) echo active ;;
  restart) echo 0 > "${dir}/boot-count-now"; ;;
esac`,
	);
	// the guest reports sys.boot_completed=1 after `booted` polls
	stub(
		"adb",
		`echo "adb $*" >> "${dir}/calls"
case "$*" in
  *sys.boot_completed*) n=$(cat "${dir}/boot-count"); if [ "$n" -le 0 ]; then echo 1; else echo $((n - 1)) > "${dir}/boot-count"; echo 0; fi ;;
  *get-state*) cat "${dir}/adb-state" ;;
  *ro.product.cpu.abi*) echo x86_64 ;;
esac
exit 0`,
	);
	const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		ADB: join(bin, "adb"),
		PROC: join(dir, "proc"),
		POLL: "0.05",
		BOOT_WAIT: "2",
		NATIVE_QA_LOCK_FILE: join(dir, "lock"),
		...extra,
	});
	const run = (args: string[], extra: Record<string, string> = {}) => spawnSync("bash", [script, ...args], { env: env(extra), encoding: "utf8" });
	const calls = (): string => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8") : "");
	return { dir, env, run, calls, rss, put };
}


/** Holds the emulator lock of `machine` for `seconds` and returns once it does. */
async function holdLock(machine: { dir: string }, seconds: number) {
	const marker = join(machine.dir, "holding");
	const holder = spawn("flock", [join(machine.dir, "lock"), "bash", "-c", `touch ${marker}; sleep ${seconds}`]);
	for (let waited = 0; !existsSync(marker); waited += 25) {
		if (waited > 10_000) throw new Error("the lock holder never started");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return holder;
}

describe("emulator.sh", () => {
	test("rss is qemu's resident set in whole GB", () => {
		expect(host({ rssGb: 12 }).run(["rss"]).stdout.trim()).toBe("12");
		const empty = host();
		rmSync(join(empty.dir, "proc", "4242"), { recursive: true });
		expect(empty.run(["rss"]).stdout.trim()).toBe("0");
	});
	test("guard leaves a small emulator alone and restarts a big one", () => {
		const small = host({ rssGb: 6 });
		const quiet = small.run(["guard"]);
		expect(quiet.status).toBe(0);
		expect(quiet.stdout).toContain("no restart");
		expect(small.calls()).not.toContain("systemctl restart");
		const big = host({ rssGb: 12 });
		const restarted = big.run(["guard"]);
		expect(restarted.status).toBe(0);
		expect(big.calls()).toContain("systemctl restart svelte-qa-emulator.service");
		expect(big.calls()).toContain("adb connect localhost:5555");
	});
	test("guard also restarts an emulator adb no longer answers", () => {
		const machine = host({ rssGb: 3, adb: "offline" });
		machine.run(["guard"]);
		expect(machine.calls()).toContain("systemctl restart");
	});
	test("the thresholds are settable", () => {
		const machine = host({ rssGb: 6 });
		machine.run(["guard"], { SOFT_GB: "5" });
		expect(machine.calls()).toContain("systemctl restart");
	});
	test("restart waits for the guest to boot and for adb on the harness's name", () => {
		const machine = host({ booted: 3 });
		const result = machine.run(["restart"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("up after");
		expect(machine.calls().indexOf("systemctl restart")).toBeLessThan(machine.calls().indexOf("adb connect localhost:5555"));
	});
	test("restart fails when the guest never boots", () => {
		const result = host({ booted: 10_000 }).run(["restart"], { BOOT_WAIT: "1" });
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("no boot within");
	});
	test("a user other than root restarts through sudo -n systemctl", () => {
		const machine = host();
		writeFileSync(join(machine.dir, "bin", "sudo"), `#!/usr/bin/env bash\necho "sudo $*" >> "${machine.dir}/calls"\n[ "$1" = -n ] && shift\nexec "$@"\n`);
		machine.run(["start"]);
		if (process.getuid?.() !== 0) expect(machine.calls()).toContain("sudo -n systemctl start svelte-qa-emulator.service");
	});
	test("status is one line", () => {
		expect(host({ rssGb: 4 }).run(["status"]).stdout.trim()).toBe("unit=active boot=1 adb=device rss=4 GB");
	});
});

describe("emulator.sh watchdog", () => {
	const watch = { ITERATIONS: "1", INTERVAL: "0" };
	test("does nothing to a healthy emulator", () => {
		const machine = host({ rssGb: 5 });
		machine.run(["watchdog"], watch);
		expect(machine.calls()).not.toContain("systemctl restart");
	});
	test("restarts at once above the hard limit, lock or no lock", async () => {
		const machine = host({ rssGb: 19 });
		const holder = await holdLock(machine, 5);
		machine.run(["watchdog"], { ...watch, LOCK_WAIT: "1" });
		holder.kill();
		expect(machine.calls()).toContain("systemctl restart");
	});
	test("above the soft limit it waits for the lock and restarts once it has it", async () => {
		const machine = host({ rssGb: 12 });
		const holder = await holdLock(machine, 1);
		const result = machine.run(["watchdog"], { ...watch, LOCK_WAIT: "10" });
		holder.kill();
		expect(result.stdout).toContain("waiting for");
		expect(machine.calls()).toContain("systemctl restart");
	}, 20_000);
	test("above the soft limit with the lock held too long it defers", async () => {
		const machine = host({ rssGb: 12 });
		const holder = await holdLock(machine, 5);
		const result = machine.run(["watchdog"], { ...watch, LOCK_WAIT: "1" });
		holder.kill();
		expect(result.stdout).toContain("deferring");
		expect(machine.calls()).not.toContain("systemctl restart");
	}, 20_000);
	test("restarts after two offline checks, not after one", () => {
		const once = host({ adb: "offline" });
		once.run(["watchdog"], watch);
		expect(once.calls()).not.toContain("systemctl restart");
		const twice = host({ adb: "offline" });
		const result = twice.run(["watchdog"], { ITERATIONS: "2", INTERVAL: "0" });
		expect(result.stdout).toContain("adb offline (2)");
		expect(twice.calls()).toContain("systemctl restart");
	});
});
