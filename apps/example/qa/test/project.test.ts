import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, buildEnv, prebuildInputs } from "../commands/build.ts";
import { generatedChannel, recordGeneratedChannel } from "../lib/channel.ts";
import { generatedFor, interruptedPath, prebuildProject, selectVariantProject, staleReason } from "../lib/project.ts";
import { iosPrebuildLines } from "../lib/ios-project.ts";
import { repoRoot } from "../lib/paths.ts";

const made: string[] = [];
const temporary = (prefix: string): string => {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	made.push(directory);
	return directory;
};
afterAll(() => {
	for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

/** A generated project as `expo prebuild` and `build` leave it: `app/build.gradle`, and a marker when the build finished it. */
function project(dir: string, variant: string | null, content: string): void {
	mkdirSync(join(dir, "app"), { recursive: true });
	writeFileSync(join(dir, "app/build.gradle"), content);
	if (variant !== null) writeFileSync(join(dir, ".native-qa-variant"), `${variant}\n`);
}
const read = (dir: string) => readFileSync(join(dir, "app/build.gradle"), "utf8");

describe("android/ holds one variant, and only a finished project counts", () => {
	test("switching parks the project as android-<variant> and brings the other back", async () => {
		const base = temporary("native-qa-project-");
		const dir = join(base, "android");
		const entries = () => readdirSync(base).toSorted();
		expect(await generatedFor(dir)).toBeNull();
		expect(await selectVariantProject("qa", dir)).toMatch(/is missing/);
		project(dir, "qa", "qa 1");
		expect(await generatedFor(dir)).toBe("qa");
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(entries()).toEqual(["android"]);
		expect(await selectVariantProject("smoke", dir)).toMatch(/was generated for the qa app, and none is parked for smoke/);
		expect(entries()).toEqual(["android-qa"]);
		await prebuildProject("smoke", dir, async () => project(dir, null, "smoke 1"));
		expect(await generatedFor(dir)).toBe("smoke");
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(entries()).toEqual(["android", "android-smoke"]);
		expect(read(dir)).toBe("qa 1");
		expect(await selectVariantProject("smoke", dir)).toBeNull();
		expect(read(dir)).toBe("smoke 1");
		expect(entries()).toEqual(["android", "android-qa"]);
	});

	test("a project without a marker is of unknown origin: it is never read as the QA app, and never parked", async () => {
		const base = temporary("native-qa-project-");
		const dir = join(base, "android");
		project(dir, null, "made by hand");
		expect(await generatedFor(dir)).toBe("unknown");
		project(`${dir}-qa`, "qa", "parked qa");
		// Asked for the QA app, it does not assemble the unknown project, and the real QA project is the one that comes back.
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(read(dir)).toBe("parked qa");
		expect(readdirSync(base).toSorted()).toEqual(["android"]);
		// With nothing parked, the unknown project is removed and the caller prebuilds.
		rmSync(dir, { recursive: true });
		project(dir, null, "made by hand");
		expect(await selectVariantProject("smoke", dir)).toMatch(/no variant marker/);
		expect(existsSync(dir)).toBe(false);
	});

	test("a prebuild that fails leaves no project behind, and the parked one is still there on the retry and the QA build after it", async () => {
		const base = temporary("native-qa-project-");
		const dir = join(base, "android");
		project(dir, "qa", "real qa");
		expect(await selectVariantProject("smoke", dir)).not.toBeNull();
		const half = async () => {
			project(dir, null, "half a smoke project");
			throw new Error("expo prebuild failed");
		};
		await expect(prebuildProject("smoke", dir, half)).rejects.toThrow("expo prebuild failed");
		expect(existsSync(dir)).toBe(false);
		expect(existsSync(interruptedPath(dir))).toBe(false);
		expect(read(`${dir}-qa`)).toBe("real qa");
		// The retry parks nothing (there is nothing in the way) and removes nothing.
		expect(await selectVariantProject("smoke", dir)).not.toBeNull();
		expect(read(`${dir}-qa`)).toBe("real qa");
		await expect(prebuildProject("smoke", dir, half)).rejects.toThrow();
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(read(dir)).toBe("real qa");
		expect(await generatedFor(dir)).toBe("qa");
	});

	test("a prebuild that was killed (the marker file of its start is still there) is removed, not finished or parked", async () => {
		const base = temporary("native-qa-project-");
		const dir = join(base, "android");
		project(`${dir}-qa`, "qa", "real qa");
		project(dir, null, "half a smoke project");
		writeFileSync(interruptedPath(dir), "smoke\n");
		expect(await generatedFor(dir)).toBe("unknown");
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(read(dir)).toBe("real qa");
		expect(existsSync(interruptedPath(dir))).toBe(false);
		expect(readdirSync(base).toSorted()).toEqual(["android"]);
	});

	test("a finished prebuild writes the marker and removes the one of its start; a complete project of the variant is current", async () => {
		const base = temporary("native-qa-project-");
		const dir = join(base, "android");
		let sawStartMarker = false;
		await prebuildProject("qa", dir, async () => {
			sawStartMarker = existsSync(interruptedPath(dir));
			project(dir, null, "qa");
		});
		expect(sawStartMarker).toBe(true);
		expect(existsSync(interruptedPath(dir))).toBe(false);
		expect(readFileSync(join(dir, ".native-qa-variant"), "utf8")).toBe("qa\n");
		expect(await generatedFor(dir)).toBe("qa");
	});
});

describe("when a generated project has to be made again", () => {
	test("every input that changes the generated project is on the list, and exists", async () => {
		const inputs = (await prebuildInputs()).map((path) => path.slice(repoRoot.length + 1));
		for (const name of ["apps/platform/app.config.ts", "apps/platform/package.json", "apps/platform/react-native.config.js", "apps/platform/qa/smoke-modules.json", "apps/platform/qa/smoke-packages.cjs", "apps/platform/qa/firebase-fake/google-services.json", "packages/svelte-native/src/expo.ts"])
			expect(inputs).toContain(name);
		for (const input of await prebuildInputs()) expect([input, existsSync(input)]).toEqual([input, true]);
	});
	test("an input newer than the generated project is a reason, the oldest and the missing are not", async () => {
		const base = temporary("native-qa-stale-");
		const generated = join(base, "build.gradle");
		const older = join(base, "older");
		const newer = join(base, "smoke-packages.cjs");
		for (const file of [generated, older, newer]) writeFileSync(file, "x");
		const now = Date.now() / 1000;
		utimesSync(older, now - 100, now - 100);
		utimesSync(generated, now - 50, now - 50);
		utimesSync(newer, now, now);
		expect(await staleReason(generated, [older, join(base, "missing")])).toBeNull();
		expect(await staleReason(generated, [older, newer])).toContain("smoke-packages.cjs is newer");
		expect(await staleReason(join(base, "absent"), [older])).toMatch(/is missing/);
	});
});

describe("builds", () => {
	test("the environment of a build sets the variant, whatever the shell has", () => {
		const before = process.env.APP_VARIANT;
		process.env.APP_VARIANT = "production";
		try {
			expect(buildEnv("qa").APP_VARIANT).toBe("");
			expect(buildEnv("smoke").APP_VARIANT).toBe("smoke");
			expect(buildEnv("qa").SENTRY_DISABLE_AUTO_UPLOAD).toBe("true");
		} finally {
			if (before === undefined) delete process.env.APP_VARIANT;
			else process.env.APP_VARIANT = before;
		}
	});

	test("the channel is always set, empty for a build without one whatever the shell exports, and composes with the variant", () => {
		const before = process.env.UPDATES_CHANNEL;
		process.env.UPDATES_CHANNEL = "production";
		try {
			expect(buildEnv("qa").UPDATES_CHANNEL).toBe("");
			expect(buildEnv("smoke").UPDATES_CHANNEL).toBe("");
			expect(buildEnv("qa", "qa")).toMatchObject({ UPDATES_CHANNEL: "qa", APP_VARIANT: "", SENTRY_DISABLE_AUTO_UPLOAD: "true" });
		} finally {
			if (before === undefined) delete process.env.UPDATES_CHANNEL;
			else process.env.UPDATES_CHANNEL = before;
		}
	});

	test("a channel build is the QA app: the smoke app, which never checks for updates, is refused before anything runs", async () => {
		await expect(build(["--variant", "smoke", "--updates-channel", "qa"])).rejects.toThrow("--updates-channel builds the QA app, not the smoke app");
		await expect(build(["--updates-channel", "production"])).rejects.toThrow("must name a QA channel");
	});

	test("the channel a project was generated for is written inside it, so parking the project parks the channel with it", async () => {
		const base = temporary("native-qa-project-");
		const dir = join(base, "android");
		await prebuildProject("qa", dir, async () => {
			project(dir, null, "qa for the channel");
			await recordGeneratedChannel("qa", dir);
		});
		expect(await generatedChannel(dir)).toBe("qa");
		// The smoke app is generated beside it, without a channel; the QA project returns with its channel.
		expect(await selectVariantProject("smoke", dir)).toMatch(/none is parked for smoke/);
		await prebuildProject("smoke", dir, async () => {
			project(dir, null, "smoke");
			await recordGeneratedChannel(null, dir);
		});
		expect(await generatedChannel(dir)).toBe("");
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(read(dir)).toBe("qa for the channel");
		expect(await generatedChannel(dir)).toBe("qa");
		// A prebuild that dies after it wrote the channel leaves no finished project, so the channel it wrote is never read as a current one.
		await expect(prebuildProject("qa", join(base, "other"), async () => { await recordGeneratedChannel("qa", join(base, "other")); throw new Error("killed"); })).rejects.toThrow("killed");
		expect(existsSync(join(base, "other"))).toBe(false);
	});
});

describe("the iOS project of the Mac checkout holds one variant too", () => {
	/** Runs the prebuild lines in a fresh platform directory with a fake `npx`; `fail` makes it exit 1 after it wrote half a project. */
	function run(directory: string, variant: "qa" | "smoke", fail = false): { status: number | null; calls: string[] } {
		const bin = join(directory, "bin");
		mkdirSync(bin, { recursive: true });
		const npx = join(bin, "npx");
		writeFileSync(npx, '#!/bin/sh\necho "$APP_VARIANT $*" >> "$FAKE_NPX_LOG"\nmkdir -p ios\ncase " $* " in *" --clean "*) rm -rf ios; mkdir -p ios;; esac\necho generated > ios/Podfile\n[ -n "$FAKE_NPX_FAIL" ] && exit 1\nexit 0\n');
		chmodSync(npx, 0o755);
		const log = join(directory, "calls.log");
		const done = spawnSync("sh", ["-c", iosPrebuildLines(variant, join(directory, "prebuild.log")).join(" && ")], {
			cwd: directory,
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_NPX_LOG: log, ...(fail ? { FAKE_NPX_FAIL: "1" } : { FAKE_NPX_FAIL: "" }) },
		});
		return { status: done.status, calls: existsSync(log) ? readFileSync(log, "utf8").replace(/\n$/, "").split("\n") : [] };
	}
	test("a variant switch regenerates ios/ from nothing, the same variant again does not", () => {
		const directory = temporary("native-qa-ios-");
		const first = run(directory, "qa");
		expect(first.status).toBe(0);
		expect(first.calls.at(-1)).toBe(" expo prebuild --platform ios --clean");
		expect(readFileSync(join(directory, "ios/.native-qa-variant"), "utf8")).toBe("qa\n");
		expect(run(directory, "qa").calls.at(-1)).toBe(" expo prebuild --platform ios");
		const smoke = run(directory, "smoke");
		expect(smoke.calls.at(-1)).toBe("smoke expo prebuild --platform ios --clean");
		expect(readFileSync(join(directory, "ios/.native-qa-variant"), "utf8")).toBe("smoke\n");
		// What the smoke app wrote (the static frameworks of expo-build-properties) is gone when the QA app is built again.
		writeFileSync(join(directory, "ios/Podfile.properties.json"), '{"ios.useFrameworks":"static"}');
		expect(run(directory, "qa").calls.at(-1)).toBe(" expo prebuild --platform ios --clean");
		expect(existsSync(join(directory, "ios/Podfile.properties.json"))).toBe(false);
	});
	test("a prebuild that fails leaves no marker, so the next one starts from nothing whichever variant it is for", () => {
		const directory = temporary("native-qa-ios-");
		expect(run(directory, "smoke").status).toBe(0);
		const failed = run(directory, "smoke", true);
		expect(failed.status).not.toBe(0);
		expect(existsSync(join(directory, "ios/.native-qa-variant"))).toBe(false);
		const retry = run(directory, "smoke");
		expect(retry.status).toBe(0);
		expect(retry.calls.at(-1)).toContain("--clean");
		expect(readFileSync(join(directory, "ios/.native-qa-variant"), "utf8")).toBe("smoke\n");
	});
});

describe(".gitignore", () => {
	const ignored = (path: string) => spawnSync("git", ["check-ignore", "-q", path], { cwd: repoRoot }).status === 0;
	test("ignores the generated Android projects of the harness, not the tracked parity references named like them", () => {
		expect(ignored("apps/platform/android/app/build.gradle")).toBe(true);
		expect(ignored("apps/platform/android-qa/app/build.gradle")).toBe(true);
		expect(ignored("apps/platform/android-smoke/app/build.gradle")).toBe(true);
		expect(ignored("apps/platform/qa/screenshots/android-api36-sdk/screens-menu--light-ltr.png")).toBe(false);
	});
	test("no tracked file is ignored", () => {
		const tracked = spawnSync("git", ["ls-files", "-ci", "--exclude-standard"], { cwd: repoRoot, encoding: "utf8" });
		expect(tracked.stdout.trim().split("\n").filter((line) => line.startsWith("apps/platform/qa/") || line.startsWith("apps/platform/android"))).toEqual([]);
	});
});
