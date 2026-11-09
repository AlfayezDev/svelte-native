import type { CrashesFile, JsSample, MemSample, Metrics, SoakFile } from "../lib/types.ts";

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] ?? null)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Percent growth of `final` over `base`; null when either was not measured or the base is not positive. */
function growthPct(base: number | null, final: number | null): number | null {
	if (base === null || final === null || base <= 0) return null;
	return ((final - base) / base) * 100;
}

/** Rounded to `digits` decimals; a tiny negative rounds to 0, not to -0. */
function round(value: number | null, digits: number): number | null {
	if (value === null) return null;
	const rounded = Number(value.toFixed(digits));
	return rounded === 0 ? 0 : rounded;
}

/** The window's heap, from samples the lab took right after a collection; without one the number would be garbage-phase noise, so it is not derived. */
function jsHeap(samples: JsSample[], phase: JsSample["phase"]): number | null {
	return median(
		samples
			.filter(
				(sample) =>
					sample.phase === phase &&
					sample.collected !== null &&
					sample.heap &&
					sample.heap.allocated >= 0,
			)
			.map((sample) => sample.heap?.allocated ?? 0),
	);
}

/** The worklet runtime's heap, from samples taken right after a full collection there. */
function uiHeapOf(samples: JsSample[], phase: JsSample["phase"]): number | null {
	return median(
		samples
			.filter((sample) => sample.phase === phase && sample.ui?.collected === 1 && sample.ui.allocated >= 0)
			.map((sample) => sample.ui?.allocated ?? 0),
	);
}

function memory(
	samples: MemSample[],
	tag: MemSample["tag"],
	pick: (sample: MemSample) => number,
): number | null {
	return median(samples.filter((sample) => sample.tag === tag).map(pick));
}

/**
 * The idle floors of the native heap over time, one per window: the baseline, every checkpoint (an idle window the lab
 * takes every two minutes) and the final window, each the median of its samples at the median of their times.
 * Windows are told apart by a gap of more than 30 s between samples of the same tag.
 */
export function idleFloors(samples: MemSample[]): { minutes: number; kb: number }[] {
	const windows: MemSample[][] = [];
	for (const sample of samples) {
		if (sample.tag === "series") continue;
		const last = windows.at(-1);
		const previous = last?.at(-1);
		if (last && previous && previous.tag === sample.tag && sample.atMs - previous.atMs <= 30_000) last.push(sample);
		else windows.push([sample]);
	}
	return windows.map((window) => ({
		minutes: (median(window.map((sample) => sample.atMs)) ?? 0) / 60_000,
		kb: median(window.map((sample) => sample.nativeAllocKb)) ?? 0,
	}));
}

/** Least-squares slope of `Native Heap` Heap Alloc over the idle floors, in KB per minute; null with fewer than two windows. */
function floorSlope(samples: MemSample[]): number | null {
	const floors = idleFloors(samples);
	if (floors.length < 2) return null;
	const n = floors.length;
	const meanX = floors.reduce((sum, point) => sum + point.minutes, 0) / n;
	const meanY = floors.reduce((sum, point) => sum + point.kb, 0) / n;
	let covariance = 0;
	let variance = 0;
	for (const point of floors) {
		covariance += (point.minutes - meanX) * (point.kb - meanY);
		variance += (point.minutes - meanX) ** 2;
	}
	return variance === 0 ? null : covariance / variance;
}

function lastOf(samples: JsSample[], phase: JsSample["phase"]): JsSample | null {
	return samples.findLast((sample) => sample.phase === phase) ?? null;
}

/**
 * The soak's derived measurements, from its raw series. Heap growth compares two idle windows of the same app state
 * (everything unmounted): the three samples taken after the warm-up cycles (`baseline`) and the three taken after the
 * last cycle (`final`), each the median of its window. The Hermes heap of both runtimes (the app's and the worklet runtime's)
 * is collected (`gc()`) before every such sample. The native heap is `Native Heap` Heap Alloc, the live malloc bytes (a
 * leak raises it; arena slack does not). Growth is the worst of the three. A missing window makes the metric null (not measured), never zero.
 */
export function soakMetrics(file: SoakFile): Metrics {
	const jsGrowth = growthPct(jsHeap(file.js, "baseline"), jsHeap(file.js, "final"));
	const uiGrowth = growthPct(uiHeapOf(file.js, "baseline"), uiHeapOf(file.js, "final"));
	const nativeGrowth = growthPct(
		memory(file.memory, "baseline", (sample) => sample.nativeAllocKb),
		memory(file.memory, "final", (sample) => sample.nativeAllocKb),
	);
	const nativePssGrowth = growthPct(
		memory(file.memory, "baseline", (sample) => sample.nativePssKb),
		memory(file.memory, "final", (sample) => sample.nativePssKb),
	);
	const javaGrowth = growthPct(
		memory(file.memory, "baseline", (sample) => sample.dalvikAllocKb),
		memory(file.memory, "final", (sample) => sample.dalvikAllocKb),
	);
	const viewsBase = memory(file.memory, "baseline", (sample) => sample.views);
	const viewsFinal = memory(file.memory, "final", (sample) => sample.views);

	const start = lastOf(file.js, "start");
	const baseline = lastOf(file.js, "baseline");
	const final = lastOf(file.js, "final");
	const leaked =
		baseline?.engine && final?.engine
			? Math.max(0, final.engine.alive - baseline.engine.alive)
			: null;
	const writes = (
		sample: JsSample | null,
		pick: (engine: NonNullable<JsSample["engine"]>) => number,
	) => (sample?.engine ? pick(sample.engine) : null);
	const dead = (sample: JsSample | null) =>
		writes(sample, (engine) => engine.staleWrites + engine.expiredWrites + engine.overflowWrites);
	const deadStart = dead(start);
	const deadFinal = dead(final);
	const emitterGrowth =
		baseline?.engine?.emitters !== undefined && final?.engine?.emitters !== undefined
			? Math.max(0, final.engine.emitters - baseline.engine.emitters)
			: null;
	const lateStart = writes(start, (engine) => engine.lateWrites);
	const lateFinal = writes(final, (engine) => engine.lateWrites);
	const lastFinalMem = file.memory.findLast((sample) => sample.tag === "final") ?? null;
	// A build that logs the worklet runtime's heap must have both of its collected windows: the growth it left out would be the worst one.
	const growths = file.js.some((sample) => sample.ui)
		? [jsGrowth, nativeGrowth, uiGrowth]
		: [jsGrowth, nativeGrowth];
	const worstGrowth = growths.some((growth) => growth === null)
		? null
		: Math.max(...(growths as number[]));

	return {
		"memory.heapGrowthPct": round(worstGrowth, 2),
		"memory.js.growthPct": round(jsGrowth, 2),
		"memory.ui.growthPct": round(uiGrowth, 2),
		"memory.native.growthPct": round(nativeGrowth, 2),
		"memory.native.pssGrowthPct": round(nativePssGrowth, 2),
		"memory.native.slopeKbPerMin": round(floorSlope(file.memory), 1),
		"memory.java.growthPct": round(javaGrowth, 2),
		"memory.leakedViews": leaked,
		"memory.leakedEmitters": emitterGrowth,
		"memory.deadTagWrites": deadStart !== null && deadFinal !== null ? deadFinal - deadStart : null,
		"memory.lateTagWrites": lateStart !== null && lateFinal !== null ? lateFinal - lateStart : null,
		"memory.androidViews.growth":
			viewsBase !== null && viewsFinal !== null ? viewsFinal - viewsBase : null,
		"memory.viewRootImpls": lastFinalMem?.viewRootImpls ?? null,
		"memory.activities": lastFinalMem?.activities ?? null,
		"soak.minutes": round(start && final ? (final.t - start.t) / 60_000 : null, 2),
		"soak.crashes": file.crashes.length,
		"soak.complete": file.complete ? 1 : 0,
	};
}

/**
 * Crash counts over the cold starts and the full lab suites. `coldStartCrashes` counts starts whose process crashed
 * or died; a start that hung without booting or crashing is `coldStartsNoBoot`; ANRs from both series are one count.
 */
export function crashMetrics(file: CrashesFile): Metrics {
	const starts = file.coldStarts;
	const crashed = (start: CrashesFile["coldStarts"][number]) => start.crash || start.died;
	const suiteCrashed = (suite: CrashesFile["suites"][number]) => suite.crashes > 0;
	return {
		// A file written before the run was recorded cannot say what its suites ran.
		"crashes.run": typeof file.run === "string" ? file.run : null,
		"crashes.coldStarts": starts.length,
		"crashes.coldStartCrashes": starts.filter(crashed).length,
		"crashes.coldStartsNoBoot": starts.filter(
			(start) => !start.reachedBoot && !crashed(start) && !start.anr,
		).length,
		"crashes.suites": file.suites.length,
		"crashes.suiteCrashes": file.suites.filter(suiteCrashed).length,
		"crashes.suitesIncomplete": file.suites.filter(
			(suite) => !suite.complete && !suiteCrashed(suite) && suite.anrs === 0,
		).length,
		"crashes.anrs":
			starts.filter((start) => start.anr).length +
			file.suites.reduce((sum, suite) => sum + suite.anrs, 0),
		"crashes.signatures": file.signatures.length,
	};
}
