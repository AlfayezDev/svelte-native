import { describe, expect, test } from "bun:test";
import { afterRetry, launchFrom, missingPairError, shouldRetry } from "../lib/boot-launch.ts";
import { bootMetrics } from "../lib/metrics.ts";
import type { BootFile } from "../lib/types.ts";
import { parseAmStart } from "../parse/adb.ts";
import { sample } from "./sample.ts";

const pkg = "io.example.svelteqa";
const am = parseAmStart(sample("am-start.txt"));
const withoutDisplayed = () =>
	sample("boot-launch.log")
		.split("\n")
		.filter((line) => !line.includes("Displayed "))
		.join("\n");

describe("launchFrom", () => {
	test("the boot fixture is a launch that produced its pair, on its first attempt", () => {
		const launch = launchFrom(3, sample("boot-launch.log"), am, pkg);
		expect(launch.displayMs).not.toBeNull();
		expect(launch.error).toBeNull();
		expect(launch.attempts).toBe(1);
		expect(launch.index).toBe(3);
	});
	test("the same log without its Displayed line is the missing pair the cold launch 20 of the A16 had", () => {
		const launch = launchFrom(20, withoutDisplayed(), am, pkg);
		expect(launch.displayMs).toBeNull();
		expect(launch.runningMainMs).not.toBeNull();
		expect(launch.crashes).toBe(0);
		expect(launch.error).toBe(missingPairError);
	});
});

describe("shouldRetry", () => {
	const complete = launchFrom(1, sample("boot-launch.log"), am, pkg);
	const missing = launchFrom(1, withoutDisplayed(), am, pkg);
	test("a missing pair with the app alive and no fault is run again", () => {
		expect(shouldRetry(missing, true)).toBe(true);
	});
	test("a launch that produced its pair is never run again, alive or not", () => {
		expect(shouldRetry(complete, true)).toBe(false);
		expect(shouldRetry(complete, false)).toBe(false);
	});
	test("a missing pair with no process left is a failure kept as it is", () => {
		expect(shouldRetry(missing, false)).toBe(false);
	});
	test("a missing pair next to a crash is a failure kept as it is", () => {
		const crashed = launchFrom(1, `${withoutDisplayed()}\n${sample("crash-java.log")}`, am, pkg);
		expect(crashed.crashes).toBeGreaterThan(0);
		expect(shouldRetry(crashed, true)).toBe(false);
	});
	test("the second miss is not run a third time", () => {
		const second = afterRetry(missing);
		expect(second.attempts).toBe(2);
		expect(second.error).toBe(missingPairError);
		expect(shouldRetry(second, true)).toBe(false);
	});
});

describe("a retried launch in the metrics", () => {
	const file = (warm: BootFile["warm"]): BootFile => ({ warm, cold: [] }) as unknown as BootFile;
	test("a retry that produced the pair is a sample and is counted as retried; a second miss is retried and failed", () => {
		const got = afterRetry(launchFrom(1, sample("boot-launch.log"), am, pkg));
		const missed = afterRetry(launchFrom(2, withoutDisplayed(), am, pkg));
		const plain = launchFrom(3, sample("boot-launch.log"), am, pkg);
		const metrics = bootMetrics(file([got, missed, plain]));
		expect(metrics["boot.warm.attempts"]).toBe(3);
		expect(metrics["boot.warm.samples"]).toBe(2);
		expect(metrics["boot.warm.failed"]).toBe(1);
		expect(metrics["boot.warm.retried"]).toBe(2);
	});
	test("launches recorded without the field, and iOS launches, count none", () => {
		const old = launchFrom(1, sample("boot-launch.log"), am, pkg);
		delete old.attempts;
		expect(bootMetrics(file([old]))["boot.warm.retried"]).toBe(0);
	});
});
