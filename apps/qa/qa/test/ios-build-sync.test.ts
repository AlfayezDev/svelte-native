import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { macSyncExcludes } from "../commands/ios-build.ts";
import { repoRoot } from "../lib/paths.ts";

describe("what `build --platform ios` copies to the Mac", () => {
	test("the library's committed dist/node goes along (the Expo plugin, Metro and the CLI load it); node_modules and the native projects do not", () => {
		const target = mkdtempSync(join(tmpdir(), "mac-sync-"));
		try {
			const run = spawnSync("rsync", ["-rlpc", "--dry-run", "--itemize-changes", ...macSyncExcludes.flatMap((pattern) => ["--exclude", pattern]), `${repoRoot}/`, `${target}/`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
			expect(run.status).toBe(0);
			const files = run.stdout.split("\n").map((line) => line.slice(12)).filter(Boolean);
			expect(files).toContain("packages/expo-svelte/dist/node/expo.cjs");
			expect(files).toContain("packages/expo-svelte/dist/node/metro.cjs");
			expect(files.filter((file) => file.startsWith("node_modules/") || file.includes("/node_modules/"))).toEqual([]);
			expect(files.filter((file) => file.startsWith("apps/qa/android/") || file.startsWith("apps/qa/ios/"))).toEqual([]);
		} finally {
			rmSync(target, { recursive: true, force: true });
		}
	});

	test("the Android build's native intermediates and caches stay behind (a Gradle build in the same checkout changes them while rsync reads)", () => {
		const source = mkdtempSync(join(tmpdir(), "mac-sync-source-"));
		const target = mkdtempSync(join(tmpdir(), "mac-sync-"));
		try {
			for (const file of ["packages/expo-svelte/native/svelte-core/android/.cxx/RelWithDebInfo/x86_64/a.o", "apps/qa/android/.gradle/8.14/cache.bin", "examples/app/android/.gradle/b.lock", "packages/expo-svelte/src/index.ts"]) {
				mkdirSync(dirname(join(source, file)), { recursive: true });
				writeFileSync(join(source, file), "x");
			}
			const run = spawnSync("rsync", ["-rlpc", "--dry-run", "--itemize-changes", ...macSyncExcludes.flatMap((pattern) => ["--exclude", pattern]), `${source}/`, `${target}/`], { encoding: "utf8" });
			expect(run.status).toBe(0);
			const files = run.stdout.split("\n").map((line) => line.slice(12)).filter((file) => file && !file.endsWith("/"));
			expect(files).toEqual(["packages/expo-svelte/src/index.ts"]);
		} finally {
			rmSync(source, { recursive: true, force: true });
			rmSync(target, { recursive: true, force: true });
		}
	});
});
