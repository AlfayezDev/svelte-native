/** A source map as Metro writes it: one map with `sources`, or, since Metro 0.87 when a module brings a map of its own, an index map whose `sections` each hold one. */
export type RawSourceMap = { sources?: unknown; sections?: { map?: RawSourceMap }[] };

/** The modules a source map lists, each once, from a plain map or an index map. */
export function sourcesOfMap(map: RawSourceMap): string[] {
	const found = new Set<string>();
	const walk = (entry: RawSourceMap): void => {
		if (Array.isArray(entry.sources)) for (const source of entry.sources) if (typeof source === "string") found.add(source);
		for (const section of entry.sections ?? []) if (section.map) walk(section.map);
	};
	walk(map);
	return [...found];
}
