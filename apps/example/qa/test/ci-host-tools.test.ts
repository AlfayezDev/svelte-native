import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "ci", "host-tools.sh");
const root = mkdtempSync(join(tmpdir(), "native-qa-host-tools-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;

const kotlinVersion = /^KOTLIN_VERSION=(\S+)$/m.exec(readFileSync(script, "utf8"))?.[1] ?? "";
const jsonVersion = /^JSON_VERSION=(\S+)$/m.exec(readFileSync(script, "utf8"))?.[1] ?? "";

function executable(path: string, body: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(path, 0o755);
}

/** A machine for the script: stand-ins for curl (logs its calls, serves `served`), java and g++ first on the path, a cache directory of its own. */
function machine(served: string | null, kotlincSays: string = `kotlinc-jvm ${kotlinVersion} (JRE 17)`) {
	const home = join(root, `machine-${++counter}`);
	const bin = join(home, "bin");
	const cache = join(home, "cache");
	const calls = join(home, "curl-calls");
	executable(
		join(bin, "curl"),
		served === null
			? `echo "curl $*" >> "${calls}"; exit 22`
			: `echo "curl $*" >> "${calls}"; while [ "$#" -gt 0 ]; do [ "$1" = -o ] && { printf '%s' '${served}' > "$2"; exit 0; }; shift; done; exit 22`,
	);
	executable(join(bin, "java"), 'echo "openjdk version \\"17\\"" >&2');
	executable(join(bin, "g++"), 'echo "g++ (stand-in) 13"');
	const install = () => {
		const kotlinc = join(cache, `kotlinc-${kotlinVersion}`, "kotlinc", "bin", "kotlinc");
		executable(kotlinc, `echo "info: ${kotlincSays}" >&2`);
		writeFileSync(join(cache, `json-${jsonVersion}.jar`), "jar");
		return kotlinc;
	};
	mkdirSync(cache, { recursive: true });
	const run = (env: Record<string, string> = {}) =>
		spawnSync("bash", [script, cache], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_PATH: "", GITHUB_ENV: "", ...env } });
	const downloads = (): string[] => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
	return { home, cache, run, install, downloads };
}

describe("host-tools.sh", () => {
	test("pins the Kotlin the Android build compiles with, and a checksum for each download", () => {
		const text = readFileSync(script, "utf8");
		expect(kotlinVersion).toBe("2.1.20");
		expect(/^KOTLIN_SHA256=[0-9a-f]{64}$/m.test(text)).toBe(true);
		expect(/^JSON_SHA256=[0-9a-f]{64}$/m.test(text)).toBe(true);
	});
	test("refuses a download that is not the pinned file and installs nothing", () => {
		const tampered = machine("not the compiler");
		const result = tampered.run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("not the pinned");
		expect(result.stderr).toContain("kotlin-compiler-");
		expect(readdirSync(tampered.cache)).toEqual([]);
		expect(tampered.downloads()).toHaveLength(1);
	});
	test("a download that fails says which", () => {
		const offline = machine(null);
		const result = offline.run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("cannot download https://github.com/JetBrains/kotlin/releases/download/");
		expect(readdirSync(offline.cache)).toEqual([]);
	});
	test("what is installed is not downloaded again; a terminal gets the lines to run", () => {
		const installed = machine(null);
		const kotlinc = installed.install();
		const result = installed.run();
		expect(result.status).toBe(0);
		expect(installed.downloads()).toEqual([]);
		expect(result.stdout).toBe(`export PATH="${join(kotlinc, "..")}:$PATH" ORG_JSON_JAR="${join(installed.cache, `json-${jsonVersion}.jar`)}"\n`);
		expect(result.stderr).toContain(kotlinVersion);
	});
	test("in a workflow it adds kotlinc to PATH and sets the jar for the steps after it", () => {
		const installed = machine(null);
		const kotlinc = installed.install();
		const path = join(installed.home, "github-path");
		const env = join(installed.home, "github-env");
		const result = installed.run({ GITHUB_PATH: path, GITHUB_ENV: env });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
		expect(readFileSync(path, "utf8")).toBe(`${join(kotlinc, "..")}\n`);
		expect(readFileSync(env, "utf8")).toBe(`ORG_JSON_JAR=${join(installed.cache, `json-${jsonVersion}.jar`)}\n`);
	});
	test("a kotlinc of another version stops it", () => {
		const other = machine(null, "kotlinc-jvm 1.9.0 (JRE 17)");
		other.install();
		const wrong = other.run();
		expect(wrong.status).toBe(1);
		expect(wrong.stderr).toContain(`not ${kotlinVersion}`);
	});
});
