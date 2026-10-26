import { parseLines } from "../parse/logcat.ts";
import type { EngineStats, HermesHeap, JsSample, SoakPhase } from "../lib/types.ts";

const phases: readonly string[] = ["start", "sample", "baseline", "final"] satisfies SoakPhase[];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numbers<const K extends string>(
	value: unknown,
	keys: readonly K[],
): Record<K, number> | null {
	if (!isRecord(value)) return null;
	const out: Partial<Record<K, number>> = {};
	for (const key of keys) {
		const entry = value[key];
		if (typeof entry !== "number") return null;
		out[key] = entry;
	}
	return out as Record<K, number>;
}

const heapKeys = ["allocated", "heapSize", "malloc", "va", "gcs"] as const;
const engineKeys = [
	"alive",
	"pooled",
	"held",
	"created",
	"deleted",
	"lateWrites",
	"staleWrites",
	"replayedWrites",
	"expiredWrites",
	"overflowWrites",
	"earlyPending",
] as const;

const prefix = "'[Svelte soak]', '";

/**
 * The lab's `[Svelte soak]` lines, in log order: the phase, the milliseconds since the soak began, the Hermes heap and
 * the engine's counts. A line that is cut off or that does not carry the expected fields throws: a sample that cannot
 * be read must not shorten the series unnoticed.
 */
export function parseSoakSamples(text: string): JsSample[] {
	const samples: JsSample[] = [];
	for (const line of parseLines(text)) {
		if (!line.message.startsWith(prefix)) continue;
		const json = line.message.slice(prefix.length).replace(/'\s*$/, "");
		let value: unknown;
		try {
			value = JSON.parse(json);
		} catch (cause) {
			throw new Error(
				`malformed [Svelte soak] line (logcat cuts lines near 4 KB): ${json.slice(0, 160)}`,
				{ cause },
			);
		}
		if (
			!isRecord(value) ||
			typeof value.phase !== "string" ||
			!phases.includes(value.phase) ||
			typeof value.cycle !== "number" ||
			typeof value.t !== "number"
		)
			throw new Error(`unexpected [Svelte soak] payload: ${json.slice(0, 160)}`);
		samples.push({
			phase: value.phase as SoakPhase,
			cycle: value.cycle,
			t: value.t,
			collected: typeof value.collected === "string" ? value.collected : null,
			heap: numbers(value.heap, heapKeys) satisfies HermesHeap | null,
			engine: numbers(value.engine, engineKeys) satisfies EngineStats | null,
		});
	}
	return samples;
}

/** The phase a `[Svelte soak]` line announces, read without parsing the payload, for the live sampler. */
export function soakPhaseOf(message: string): SoakPhase | null {
	if (!message.startsWith(prefix)) return null;
	const phase = /"phase":"([a-z]+)"/.exec(message)?.[1];
	return phase !== undefined && phases.includes(phase) ? (phase as SoakPhase) : null;
}
