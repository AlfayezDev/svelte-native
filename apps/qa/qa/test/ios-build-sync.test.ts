import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { macSyncExcludes } from "../commands/ios-build.ts";
import { repoRoot } from "../lib/paths.ts";

describe("what `build --platform ios` copies to the Mac", () => {
	test("the library's committed dist/node goes along (the Expo plugin, Metro and the CLI load it); node_modules and the native projects do not", () => {
		const target = mkdtempSync(join(tmpdir(), "mac-sync-"));
		try {
			const run = spawnSync("rsync", ["-rlpc", "--dry-run", "--itemize-changes", ...macSyncExcludes.flatMap((pattern) => ["--exclude", pattern]), `${repoRoot}/`, `${target}/`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
			expect(run.status).toBe(0);
			const files = run.stdout.split("\n").map((line) => line.slice(12)).filter(Boolean);
			expect(files).toContain("packages/svelte-native/dist/node/expo.cjs");
			expect(files).toContain("packages/svelte-native/dist/node/metro.cjs");
			expect(files.filter((file) => file.startsWith("node_modules/") || file.includes("/node_modules/"))).toEqual([]);
			expect(files.filter((file) => file.startsWith("apps/qa/android/") || file.startsWith("apps/qa/ios/"))).toEqual([]);
		} finally {
			rmSync(target, { recursive: true, force: true });
		}
	});
});
