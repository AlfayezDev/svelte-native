import { describe, expect, test } from "bun:test";
import { parseSoakSamples, soakPhaseOf } from "../soak/log.ts";
import { parseMeminfo } from "../soak/meminfo.ts";
import { sample } from "./sample.ts";

describe("parseMeminfo", () => {
	test("reads the heaps, the totals and the object counts of a captured dumpsys meminfo", () => {
		expect(parseMeminfo(sample("dumpsys-meminfo.txt"))).toEqual({
			pid: 4197,
			nativePssKb: 83706,
			nativeAllocKb: 68394,
			nativeSizeKb: 103664,
			dalvikPssKb: 11096,
			dalvikAllocKb: 6694,
			totalPssKb: Number(/^\s*TOTAL\s+(\d+)\s/m.exec(sample("dumpsys-meminfo.txt"))?.[1]),
			views: 233,
			viewRootImpls: 1,
			activities: 1,
			appContexts: 5,
		});
	});
	test("no process is null, not zero", () => {
		expect(parseMeminfo("No process found for: io.rasheed.svelteqa\n")).toBeNull();
	});
	test("an output this parser does not know throws instead of reading as zero growth", () => {
		expect(() =>
			parseMeminfo("Applications Memory Usage (in Kilobytes):\n\n** MEMINFO in pid 5 [x] **\n"),
		).toThrow("unrecognized dumpsys meminfo output");
	});
});

describe("parseSoakSamples", () => {
	const samples = parseSoakSamples(sample("soak-run.log"));
	test("every [Svelte soak] line becomes a sample, in log order", () => {
		expect(samples).toHaveLength(26);
		expect([samples[0]?.phase, samples[0]?.cycle, samples[0]?.t]).toEqual(["start", 0, 0]);
		expect(samples.map((entry) => entry.t)).toEqual(
			[...samples.map((entry) => entry.t)].sort((a, b) => a - b),
		);
	});
	test("the heap and the engine counts come through as numbers", () => {
		const start = samples[0];
		expect(start?.heap).toEqual({
			allocated: 8905720,
			heapSize: 12582912,
			malloc: 0,
			va: 12582912,
			gcs: 4,
		});
		expect(start?.engine?.alive).toBe(90);
		expect(start?.engine?.lateWrites).toBe(48);
		expect(start?.engine?.staleWrites).toBe(0);
	});
	test("the idle windows carry the collection that preceded them", () => {
		const baseline = samples.filter((entry) => entry.phase === "baseline");
		const final = samples.filter((entry) => entry.phase === "final");
		expect(baseline).toHaveLength(3);
		expect(final).toHaveLength(3);
		expect([...baseline, ...final].every((entry) => entry.collected === "gc")).toBe(true);
		expect(
			samples
				.filter((entry) => entry.phase === "sample")
				.every((entry) => entry.collected === null),
		).toBe(true);
	});
	test("the C++ table sizes and the worklet runtime heap are read when the build logs them, and absent otherwise", () => {
		expect(samples[0]?.engine?.emitters).toBeUndefined();
		const engine =
			'{"alive":90,"pooled":1,"held":0,"created":5,"deleted":4,"lateWrites":0,"staleWrites":0,"replayedWrites":0,"expiredWrites":0,"overflowWrites":0,"earlyPending":0,"emitters":96,"scrollStates":2}';
		const line = `10-26 08:58:33.538  4197  4219 I ReactNativeJS: '[Svelte soak]', '{"phase":"checkpoint","cycle":4,"t":1000,"collected":"gc","heap":null,"engine":${engine}}'`;
		const [entry] = parseSoakSamples(line);
		expect(entry?.phase).toBe("checkpoint");
		expect(entry?.engine?.emitters).toBe(96);
		expect(entry?.engine?.scrollStates).toBe(2);
		expect(entry?.ui).toBeNull();
		const withUi = line.replace('"heap":null', '"heap":null,"ui":{"collected":1,"allocated":463440,"heapSize":8388608}');
		expect(parseSoakSamples(withUi)[0]?.ui).toEqual({ collected: 1, allocated: 463440 });
	});
	test("a line cut off by logcat throws, a sample missing from the series must never go unnoticed", () => {
		const line = sample("soak-run.log").split("\n")[0] ?? "";
		expect(() => parseSoakSamples(line.slice(0, line.length - 40))).toThrow(
			"malformed [Svelte soak] line",
		);
	});
	test("a sample whose text has an apostrophe or a backslash, as the console quotes it, is read as written", () => {
		const payload = JSON.stringify({ phase: "checkpoint", cycle: 4, t: 1000, collected: "gc: the engine's \\ table", heap: null, engine: null });
		const quoted = `'${payload.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
		expect(quoted).toContain("engine\\'s \\\\\\\\ table");
		const [entry] = parseSoakSamples(`10-26 08:58:33.538  4197  4219 I ReactNativeJS: '[Svelte soak]', ${quoted}`);
		expect(entry?.collected).toBe("gc: the engine's \\ table");
	});
	test("a line that is not JSON says so, with the parser's reason, the length of the message and the end of the payload", () => {
		const message = `'[Svelte soak]', '{"phase":"sample","cycle":1,"t":5,"collected":null,"heap":{"allocated":1`;
		let error: unknown;
		try {
			parseSoakSamples(`10-26 08:58:33.538  4197  4219 I ReactNativeJS: ${message}`);
		} catch (caught) {
			error = caught;
		}
		expect((error as Error).message).toMatch(/malformed \[Svelte soak\] line, its payload is not JSON \(.+\)/);
		expect((error as Error).message).toContain(`the message is ${message.length} characters`);
		expect((error as Error).message.endsWith('"heap":{"allocated":1')).toBe(true);
	});
	test("a payload without the expected fields throws", () => {
		const line = `10-26 08:58:33.538  4197  4219 I ReactNativeJS: '[Svelte soak]', '{"phase":"later","cycle":0,"t":0}'`;
		expect(() => parseSoakSamples(line)).toThrow("unexpected [Svelte soak] payload");
	});
	test("lines of other tags are ignored", () => {
		expect(
			parseSoakSamples(
				"10-26 08:58:33.538  4197  4219 I ReactNativeJS: '[Svelte stress] complete', '{}'",
			),
		).toEqual([]);
	});
});

describe("soakPhaseOf", () => {
	test("reads the phase without parsing the payload", () => {
		expect(soakPhaseOf(`'[Svelte soak]', '{"phase":"baseline","cycle":2}'`)).toBe("baseline");
		expect(soakPhaseOf(`'[Svelte soak]', '{"phase":"final","cycle":9}'`)).toBe("final");
		expect(soakPhaseOf(`'[Svelte soak]', '{"phase":"checkpoint","cycle":9}'`)).toBe("checkpoint");
	});
	test("other messages and unknown phases are null", () => {
		expect(soakPhaseOf(`'[Svelte stress]', '{"phase":"final"}'`)).toBeNull();
		expect(soakPhaseOf(`'[Svelte soak]', '{"phase":"other"}'`)).toBeNull();
	});
});
