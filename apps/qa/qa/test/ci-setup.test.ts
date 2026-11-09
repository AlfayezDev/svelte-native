import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "ci", "setup-runner.sh");
const root = mkdtempSync(join(tmpdir(), "native-qa-setup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const token = "ghr-TOKEN-must-not-be-printed-123";
const setup = (args: string[], env: Record<string, string> = {}) =>
	spawnSync("bash", [script, ...args], {
		encoding: "utf8",
		// Without the RUNNER_* variables of the environment: a GitHub Actions runner sets RUNNER_NAME (and others) for its own jobs, which the
		// script reads as its own settings.
		env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("RUNNER_"))), STATE_DIR: join(root, "state"), OPT_DIR: join(root, "opt"), ANDROID_HOME: join(root, "sdk"), RUNNER_URL: "https://github.com/o/r", RUNNER_TOKEN: token, ...env },
	});

describe("setup-runner.sh", () => {
	test("a dry run lists every step, changes nothing and never prints the token", () => {
		const result = setup(["--dry-run"]);
		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).not.toContain(token);
		for (const step of ["== packages", "== user svelte-qa", "== emulator lock directory", "== toolchain", "== android sdk", "== avd svelte-qa", "== systemd units, sudoers, emulator.sh", "== actions runner"])
			expect(result.stdout).toContain(step);
		expect(result.stdout).toContain("would write: /etc/sudoers.d/svelte-qa");
		expect(result.stdout).toContain("would write: /etc/systemd/system/svelte-qa-emulator.service");
		expect(result.stdout).toContain("registering ovh-svelte-qa with the labels svelte-qa-emulator at https://github.com/o/r");
		for (const dir of ["state", "opt", "sdk"]) expect(existsSync(join(root, dir))).toBe(false);
	});
	test("the repo's versions are used: node and pnpm from package.json, bun 1.3.14", () => {
		const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "package.json"), "utf8")) as { engines: { node: string }; packageManager: string };
		const pnpm = manifest.packageManager.replace(/^pnpm@/, "").replace(/\+.*/, "");
		expect(setup(["--dry-run"]).stdout).toContain(`node ${manifest.engines.node}, pnpm ${pnpm}, bun 1.3.14`);
	});
	test("--no-register prepares the host without a token", () => {
		const result = setup(["--dry-run", "--no-register"], { RUNNER_URL: "", RUNNER_TOKEN: "" });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("skipped (--no-register)");
	});
	test("registering without a URL says what to set", () => {
		const result = setup(["--dry-run"], { RUNNER_URL: "" });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("RUNNER_URL");
	});
	test("an unknown flag is refused", () => {
		const result = setup(["--bogus"]);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("unknown argument");
	});
	test("--uninstall lists the removal and keeps the state unless --purge", () => {
		const kept = setup(["--dry-run", "--uninstall"], { RUNNER_TOKEN: "" });
		expect(kept.status).toBe(0);
		expect(kept.stdout).toContain("kept:");
		const purged = setup(["--dry-run", "--uninstall", "--purge"], { RUNNER_TOKEN: "" });
		expect(purged.stdout).toContain("userdel --remove svelte-qa");
	});
});
