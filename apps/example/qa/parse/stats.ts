/** Nearest-rank percentile: the smallest sample with at least p percent of the samples at or below it. */
export function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

export type Summary = {
	samples: number;
	min: number | null;
	p50: number | null;
	p90: number | null;
	max: number | null;
};

export function summarize(values: number[]): Summary {
	return {
		samples: values.length,
		min: values.length ? Math.min(...values) : null,
		p50: percentile(values, 50),
		p90: percentile(values, 90),
		max: values.length ? Math.max(...values) : null,
	};
}
