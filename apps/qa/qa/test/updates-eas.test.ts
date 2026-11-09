import { describe, expect, test } from "bun:test";
import { channelLockName } from "../lib/lock.ts";
import { easCommand, easEnvironment, easName, redact, tail } from "../lib/eas.ts";
import { assertManifestMatches, parseManifestUpdates } from "../lib/manifest.ts";
import { parseChannelView } from "../lib/updates.ts";
import { sample } from "./sample.ts";

describe("what eas-cli gets and what is kept of its output", () => {
	const source = { PATH: "/bin", HOME: "/home/x", EXPO_TOKEN: "expo-secret-token-123", AWS_SECRET_ACCESS_KEY: "aws-secret-value-456", GITHUB_TOKEN: "ghp_abcdefghijkl", DATABASE_URL: "postgres://u:p@h/db", TMPDIR: "/tmp/x" };

	test("the child gets the variables it needs to run and to log in, plus the bundle's own, and none of the rest of the environment", () => {
		const environment = easEnvironment(source, { EXPO_PUBLIC_QA_UPDATE_MARKER: "m", CI: "1" });
		expect(environment).toEqual({ PATH: "/bin", HOME: "/home/x", EXPO_TOKEN: "expo-secret-token-123", TMPDIR: "/tmp/x", EXPO_PUBLIC_QA_UPDATE_MARKER: "m", CI: "1" });
		expect(Object.keys(environment)).not.toContain("AWS_SECRET_ACCESS_KEY");
		expect(Object.keys(environment)).not.toContain("DATABASE_URL");
	});

	test("a credential is removed from output wherever it appears: by value, by name, in a header, in a flag", () => {
		const output = [
			"EXPO_TOKEN=expo-secret-token-123 npx eas update",
			"env: GITHUB_TOKEN=ghp_abcdefghijkl and AWS_SECRET_ACCESS_KEY: aws-secret-value-456",
			"Authorization: Bearer abcdefghijklmnop",
			"eas --token hunter2hunter2 update",
			"export API_KEY='quoted value'",
			"failed with a password of aws-secret-value-456",
		].join("\n");
		const cleaned = redact(output, source);
		for (const secret of ["expo-secret-token-123", "ghp_abcdefghijkl", "aws-secret-value-456", "abcdefghijklmnop", "hunter2hunter2", "quoted value"]) expect(cleaned).not.toContain(secret);
		expect(cleaned).toContain("EXPO_TOKEN=<redacted>");
		expect(cleaned).toContain("npx eas update");
	});

	test("the tail of a failure is redacted too, and ordinary output is left alone", () => {
		expect(tail("a\nb\nc\nEXPO_TOKEN=expo-secret-token-123", 2, source)).toBe("c\nEXPO_TOKEN=<redacted>");
		expect(redact("✔ Published! group 786464e3", source)).toBe("✔ Published! group 786464e3");
	});

	test("only the name of the command is recorded, never its arguments", () => {
		const eas = easCommand("/opt/bin/npx -y eas-cli@27.2.0 --token should-not-be-recorded");
		expect(easName(eas)).toBe("npx");
		expect(easCommand(undefined, {}).args).toEqual(["-y", "eas-cli@27.2.0"]);
		expect(easCommand(undefined, { NATIVE_QA_EAS: "eas" })).toEqual({ command: "eas", args: [] });
		expect(() => easCommand("   ")).toThrow("--eas is empty");
	});
});

describe("the channel", () => {
	test("a channel that maps to exactly one branch of its own name, and its head", () => {
		const info = parseChannelView(sample("eas-channel-view.txt"), "qa");
		expect(info).toMatchObject({ name: "qa", id: "01a19680-594e-78db-a74d-f03b04683f23", branches: ["qa"], branch: "qa" });
		expect(info.head).toEqual({ id: "01a196b3-9892-7be3-b7b6-7aaaa0a3a126", createdAt: "2026-11-01T10:41:54.834Z", message: "native-qa updates qa-20261101T103206Z cleanup", platform: "android" });
	});

	test("a channel that could reach another branch is refused before anything is published", () => {
		const text = sample("eas-channel-view.txt");
		const rollout = text.replace('\\"branchMappingLogic\\":\\"true\\"', '\\"branchMappingLogic\\":\\"{\\\\\\"operator\\\\\\":\\\\\\"hash\\\\\\"}\\"');
		expect(() => parseChannelView(rollout, "qa")).toThrow("does not map to exactly one branch");
		const renamed = text.replace('"name": "qa",\n        "updateGroups"', '"name": "main",\n        "updateGroups"');
		expect(() => parseChannelView(renamed, "qa")).toThrow('points at the branch "main"');
		const two = text.replace('"updateBranches": [', '"updateBranches": [\n      { "id": "other", "name": "production", "updateGroups": [] },');
		expect(() => parseChannelView(two, "qa")).toThrow("does not map to exactly one branch");
		expect(() => parseChannelView(text, "preview")).toThrow('answered for "qa"');
		expect(() => parseChannelView("no json here", "qa")).toThrow("no JSON");
	});

	test("a channel with no updates has no head", () => {
		const text = sample("eas-channel-view.txt").replace(/"updateGroups": \[[\s\S]*\]\n {6}\}\n {4}\]/, '"updateGroups": []\n      }\n    ]');
		expect(parseChannelView(text, "qa").head).toBeNull();
	});
});

describe("the lock per channel", () => {
	test("a QA channel has its own lock file; anything else has none", () => {
		expect(channelLockName("qa")).toBe("channel-qa.lock");
		expect(channelLockName("qa-nightly")).toBe("channel-qa-nightly.lock");
		for (const refused of ["production", "preview", "../etc/x", "qa/x", ""]) expect(() => channelLockName(refused)).toThrow("not a QA channel");
	});
});

describe("the merged manifest of a build", () => {
	const attribute = (name: string, value: string) => `        <meta-data\n            android:name="expo.modules.updates.${name}"\n            android:value="${value}" />`;
	const manifest = (check: string, headers: string | null) =>
		`<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.example.svelteqa">\n    <application>\n${[
			attribute("ENABLED", "true"),
			attribute("EXPO_UPDATES_CHECK_ON_LAUNCH", check),
			attribute("EXPO_UPDATE_URL", "https://u.expo.dev/p"),
			...(headers === null ? [] : [attribute("UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY", headers)]),
		].join("\n")}\n    </application>\n</manifest>\n`;
	const qa = manifest("ALWAYS", "{&quot;expo-channel-name&quot;:&quot;qa&quot;}");
	const plain = manifest("NEVER", null);

	test("both formats are read, entities included", () => {
		expect(parseManifestUpdates(qa)).toEqual({ enabled: "true", checkOnLaunch: "ALWAYS", updateUrl: "https://u.expo.dev/p", requestHeaders: { "expo-channel-name": "qa" } });
		expect(parseManifestUpdates('<meta-data android:name="expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH" android:value="NEVER"/>').checkOnLaunch).toBe("NEVER");
		expect(parseManifestUpdates(plain).requestHeaders).toBeNull();
	});

	test("a build for a channel and a build for none each pass for what they are", () => {
		expect(() => assertManifestMatches(parseManifestUpdates(qa), "qa")).not.toThrow();
		expect(() => assertManifestMatches(parseManifestUpdates(plain), null)).not.toThrow();
	});

	test("the manifests Gradle merged for the channel build and the plain build are what the check expects", () => {
		const channelBuild = parseManifestUpdates(sample("merged-manifest-qa.xml"));
		expect(channelBuild).toMatchObject({ enabled: "true", checkOnLaunch: "ALWAYS", requestHeaders: { "expo-channel-name": "qa" } });
		expect(() => assertManifestMatches(channelBuild, "qa")).not.toThrow();
		expect(() => assertManifestMatches(channelBuild, null)).toThrow("plain QA build must not check");
		const plainBuild = parseManifestUpdates(sample("merged-manifest-plain.xml"));
		expect(plainBuild).toMatchObject({ enabled: "true", checkOnLaunch: "NEVER", requestHeaders: null });
		expect(() => assertManifestMatches(plainBuild, null)).not.toThrow();
		expect(() => assertManifestMatches(plainBuild, "qa")).toThrow("must check on launch");
	});

	test("a mismatch fails in both directions", () => {
		// A plain build that checks, or names a channel, would make the boot gates measure update checks.
		expect(() => assertManifestMatches(parseManifestUpdates(qa), null)).toThrow("plain QA build must not check");
		expect(() => assertManifestMatches(parseManifestUpdates(manifest("NEVER", "{&quot;expo-channel-name&quot;:&quot;qa&quot;}")), null)).toThrow("must not name a channel");
		// A channel build that does not check, or sends another channel (or more than the channel), cannot run the scenario.
		expect(() => assertManifestMatches(parseManifestUpdates(plain), "qa")).toThrow("must check on launch");
		expect(() => assertManifestMatches(parseManifestUpdates(manifest("ALWAYS", null)), "qa")).toThrow("must send exactly expo-channel-name=qa");
		expect(() => assertManifestMatches(parseManifestUpdates(manifest("ALWAYS", "{&quot;expo-channel-name&quot;:&quot;preview&quot;}")), "qa")).toThrow("must send exactly expo-channel-name=qa");
		expect(() => assertManifestMatches(parseManifestUpdates(manifest("ALWAYS", "{&quot;expo-channel-name&quot;:&quot;qa&quot;,&quot;x&quot;:&quot;1&quot;}")), "qa")).toThrow("must send exactly");
		expect(() => parseManifestUpdates(manifest("ALWAYS", "{not json"))).toThrow("not JSON");
	});
});
