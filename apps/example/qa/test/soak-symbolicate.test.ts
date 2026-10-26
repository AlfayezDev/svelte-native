import { describe, expect, test } from "bun:test";
import { TraceMap } from "@jridgewell/trace-mapping";
import type { CrashSignature } from "../lib/types.ts";
import {
	extractCrashes,
	frameLines,
	maxSignatures,
	recordSignature,
	signatureKey,
} from "../soak/signatures.ts";
import {
	parseNdkStack,
	symbolicateCrash,
	symbolicateJs,
	symbolicateJsLine,
	type Symbolizer,
} from "../soak/symbolicate.ts";
import { sample } from "./sample.ts";

const pkg = "io.rasheed.svelteqa";

/**
 * A Hermes-style map: one generated line, columns are bytecode offsets. Segments (offset, source, line, column, name):
 * 0 init.ts 1:1; 120 init.ts 65:11 setGlobalHandler; 300 Stress.svelte 12:5; 480 init.ts 70:3.
 * The mappings string is `encode([[[0,0,0,0],[120,0,64,10,0],[300,1,11,4],[480,0,69,2]]])` of @jridgewell/sourcemap-codec.
 */
const map = new TraceMap({
	version: 3,
	sources: [
		"/packages/svelte-native/src/init.ts",
		"/apps/platform/src/lib/native/dev/Stress.svelte",
	],
	names: ["setGlobalHandler"],
	mappings: "AAAA,wHAgEUA,oLCrDN,oLD0DF",
});

describe("symbolicateJsLine", () => {
	test("a Hermes address frame becomes the original name and position", () => {
		expect(symbolicateJsLine("    at doThing (address at index.android.bundle:1:130)", map)).toBe(
			"    at setGlobalHandler (packages/svelte-native/src/init.ts:65:11)",
		);
	});
	test("the position comes with the log prefix intact", () => {
		expect(
			symbolicateJsLine(
				"10-26 12:41:00.200  5002  5034 E ReactNativeJS:     at anonymous (address at index.android.bundle:1:310)",
				map,
			),
		).toBe(
			"10-26 12:41:00.200  5002  5034 E ReactNativeJS:     at anonymous (apps/platform/src/lib/native/dev/Stress.svelte:12:5)",
		);
	});
	test("React Native's name@line:offset form of a fatal exception", () => {
		expect(
			symbolicateJsLine("10-26 12:40:00.110  5001  5033 E AndroidRuntime: flush@1:310", map),
		).toBe(
			"10-26 12:40:00.110  5001  5033 E AndroidRuntime: at flush (apps/platform/src/lib/native/dev/Stress.svelte:12:5)",
		);
	});
	test("name@line:offset only counts on line 1, where Hermes puts every bytecode frame", () => {
		expect(symbolicateJsLine("foo@12:3", map)).toBe("foo@12:3");
	});
	test("native frames, source frames and lines without a frame stay as they are", () => {
		for (const line of [
			"    at native",
			"    at fn (index.android.bundle:1:130)",
			"E ReactNativeJS: [TypeError: x]",
			"",
		])
			expect(symbolicateJsLine(line, map)).toBe(line);
	});
	test("a map with nothing at the offset leaves the frame", () => {
		const empty = new TraceMap({ version: 3, sources: [], names: [], mappings: "" });
		expect(symbolicateJsLine("    at x (address at index.android.bundle:1:130)", empty)).toBe(
			"    at x (address at index.android.bundle:1:130)",
		);
	});
	test("a whole capture, line by line", () => {
		const out = symbolicateJs(sample("crash-hermes-frames.log"), map).split("\n");
		expect(out[1]?.endsWith("at setGlobalHandler (packages/svelte-native/src/init.ts:65:11)")).toBe(
			true,
		);
		expect(
			out[2]?.endsWith("at anonymous (apps/platform/src/lib/native/dev/Stress.svelte:12:5)"),
		).toBe(true);
		expect(out[3]?.endsWith("    at native")).toBe(true);
		expect(out[4]?.endsWith("at helper (packages/svelte-native/src/init.ts:70:3)")).toBe(true);
		expect(out[5]?.endsWith("foo@12:3 is not a bytecode frame")).toBe(true);
	});
});

describe("parseNdkStack", () => {
	const frames = parseNdkStack(sample("ndk-stack-output.txt"), "/repo/");
	test("symbolized frames show the innermost function and a path relative to the repository", () => {
		expect(frames[0]).toBe(
			"#00 expo::svelteengine::encodeProps(expo::svelteengine::Batch&, expo::svelteengine::Kind, facebook::react::ShadowView const&, float) (apps/platform/modules/svelte-engine/android/src/main/cpp/PropsEncoder.cpp:264:0)",
		);
		expect(frames[1]?.startsWith("#01 expo::svelteengine::encodeState(")).toBe(true);
		expect(frames[1]?.endsWith("PropsEncoder.cpp:323:0)")).toBe(true);
	});
	test("a frame the symbols did not cover keeps its library and offset", () => {
		expect(frames[2]).toBe("#02 libreactnative.so+0x7f3c1");
		expect(frames).toHaveLength(3);
	});
});

describe("extractCrashes", () => {
	test("a JavaScript fatal is a Java crash that carries the JS stack; other processes' crashes are left out", () => {
		const crashes = extractCrashes(sample("crash-js.log"), pkg);
		expect(crashes).toHaveLength(1);
		expect(crashes[0]?.kind).toBe("java");
		expect(crashes[0]?.title).toBe(
			"com.facebook.react.common.JavascriptException: TypeError: undefined is not a function, js engine: hermes, stack:",
		);
		expect(frameLines(crashes[0]?.raw ?? [])).toEqual([
			"anonymous@1:130",
			"flush@1:310",
			"anonymous@1:490",
			"at com.facebook.react.modules.core.ExceptionsManagerModule.reportException(ExceptionsManagerModule.kt:82)",
			"at com.facebook.jni.NativeRunnable.run(Native Method)",
			"at android.os.Handler.handleCallback(Handler.java:995)",
		]);
	});
	test("a JavaScript fatal of a release build is the host's handleHostException, with no FATAL EXCEPTION after it", () => {
		const text = sample("crash-js-host.log");
		expect(text.includes("FATAL EXCEPTION")).toBe(false);
		const crashes = extractCrashes(text, pkg);
		expect(crashes).toHaveLength(1);
		expect(crashes[0]?.kind).toBe("js");
		expect(crashes[0]?.title).toBe("Error: qa crash-js: uncaught error from a timer, stack:");
		expect(frameLines(crashes[0]?.raw ?? [])).toEqual(["anonymous@1:130"]);
	});
	test("a plain Java crash from the captured sample", () => {
		const crashes = extractCrashes(sample("crash-java.log"), pkg);
		expect(crashes.map((crash) => crash.kind)).toEqual(["java"]);
		expect(crashes[0]?.title).toBe(
			"android.app.RemoteServiceException$CrashedByAdbException: shell-induced crash",
		);
	});
	test("a native crash takes the tombstone lines that follow the libc line and none from other processes", () => {
		const crashes = extractCrashes(sample("crash-native-tombstone.log"), pkg);
		expect(crashes).toHaveLength(1);
		expect(crashes[0]?.kind).toBe("native");
		expect(crashes[0]?.title).toBe(
			"Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR) in tid (mqt_v_js)",
		);
		expect(frameLines(crashes[0]?.raw ?? [])).toHaveLength(3);
		expect(crashes[0]?.raw.some((line) => line.includes("PresentationStatsEventLogger"))).toBe(
			false,
		);
	});
	test("a native crash with no tombstone in the capture is still a crash", () => {
		const crashes = extractCrashes(sample("crash-native.log"), pkg);
		expect(crashes.map((crash) => crash.kind)).toEqual(["native"]);
		expect(frameLines(crashes[0]?.raw ?? [])).toEqual([]);
	});
	test("an ANR with its reason", () => {
		const anr = [
			"10-26 13:00:00.100  1000  1100 E ActivityManager: ANR in io.rasheed.svelteqa (io.rasheed.svelteqa/.MainActivity)",
			"10-26 13:00:00.100  1000  1100 E ActivityManager: PID: 5001",
			"10-26 13:00:00.100  1000  1100 E ActivityManager: Reason: Input dispatching timed out (Application does not have a focused window)",
		].join("\n");
		const crashes = extractCrashes(anr, pkg);
		expect(crashes).toHaveLength(1);
		expect(crashes[0]?.kind).toBe("anr");
		expect(crashes[0]?.title).toBe(
			"ANR in io.rasheed.svelteqa Reason: Input dispatching timed out (Application does not have a focused window)",
		);
	});
	test("a clean capture has none", () => {
		expect(extractCrashes(sample("boot-launch.log"), pkg)).toEqual([]);
	});
});

describe("symbolicateCrash", () => {
	const none: Symbolizer = { map: null, symbolsDir: null, ndkStack: null };
	test("JavaScript frames go through the map; the Java frames after them stay", async () => {
		const crash = extractCrashes(sample("crash-js.log"), pkg)[0];
		if (!crash) throw new Error("no crash in the sample");
		const result = await symbolicateCrash(crash, { ...none, map });
		expect(result.symbolicated).toBe(true);
		expect(result.frames.slice(0, 3)).toEqual([
			"at setGlobalHandler (packages/svelte-native/src/init.ts:65:11)",
			"at flush (apps/platform/src/lib/native/dev/Stress.svelte:12:5)",
			"at anonymous (packages/svelte-native/src/init.ts:70:3)",
		]);
	});
	test("the frame of a JavaScript fatal resolves to the line that threw", async () => {
		const crash = extractCrashes(sample("crash-js-host.log"), pkg)[0];
		if (!crash) throw new Error("no crash in the sample");
		const result = await symbolicateCrash(crash, { ...none, map });
		expect(result.symbolicated).toBe(true);
		expect(result.frames).toEqual([
			"at setGlobalHandler (packages/svelte-native/src/init.ts:65:11)",
		]);
	});
	test("a hermes offset the map has no entry for stays as it was, and says so", async () => {
		const crash = extractCrashes(sample("crash-js.log"), pkg)[0];
		if (!crash) throw new Error("no crash in the sample");
		const result = await symbolicateCrash(crash, none);
		expect(result.symbolicated).toBe(false);
		expect(result.frames[0]).toBe("anonymous@1:130");
	});
});

describe("signatures", () => {
	test("the key ignores pids, fault addresses, install paths and build ids", () => {
		const a = signatureKey("native", "Fatal signal 11 in tid (mqt_v_js)", [
			"#00 pc 0000000000024720  /data/app/~~Qm1x==/io.rasheed.svelteqa-Zy8w==/base.apk!/lib/x86_64/libsvelteengine.so (BuildId: aaaa)",
		]);
		const b = signatureKey("native", "Fatal signal 11 in tid (mqt_v_js)", [
			"#00 pc 0000000000024720  /data/app/~~Other==/io.rasheed.svelteqa-Other==/base.apk!/lib/x86_64/libsvelteengine.so (BuildId: bbbb)",
		]);
		expect(a).toBe(b);
		expect(signatureKey("java", "x", ["at a"])).not.toBe(signatureKey("native", "x", ["at a"]));
		expect(signatureKey("java", "x", ["at a"])).not.toBe(signatureKey("java", "x", ["at b"]));
	});
	test("a repeat raises the count, and only the first 20 distinct failures are kept", () => {
		const list: CrashSignature[] = [];
		const candidate = (title: string) => ({
			kind: "java" as const,
			title,
			frames: ["at a"],
			symbolicated: false,
			firstSeen: "cold start 1",
		});
		recordSignature(list, candidate("same"));
		recordSignature(list, candidate("same"));
		recordSignature(list, candidate("same"));
		expect(list).toHaveLength(1);
		expect(list[0]?.count).toBe(3);
		for (let index = 0; index < 30; index++) recordSignature(list, candidate(`distinct ${index}`));
		expect(list).toHaveLength(maxSignatures);
		expect(list[0]?.count).toBe(3);
	});
});
