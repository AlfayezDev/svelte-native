/** What one `dumpsys meminfo <package>` says about the app process, in kilobytes and object counts. */
export type MemInfo = {
	pid: number;
	nativePssKb: number;
	/** Live malloc bytes: what native allocations the process still holds, free of the arena's slack. */
	nativeAllocKb: number;
	nativeSizeKb: number;
	dalvikPssKb: number;
	dalvikAllocKb: number;
	totalPssKb: number;
	/** `Objects` section: Android view objects, root views, activities, contexts alive in the process. */
	views: number;
	viewRootImpls: number;
	activities: number;
	appContexts: number;
};

type HeapRow = { pss: number; alloc: number; size: number };

/** One row of the first table: Pss, Private Dirty, Private Clean, Swap, Rss, Heap Size, Heap Alloc, Heap Free. */
function heapRow(text: string, name: string): HeapRow | null {
	const m = new RegExp(
		`^\\s*${name}\\s+(\\d+)\\s+\\d+\\s+\\d+\\s+\\d+\\s+\\d+\\s+(\\d+)\\s+(\\d+)\\s+\\d+\\s*$`,
		"m",
	).exec(text);
	if (!m?.[1] || !m[2] || !m[3]) return null;
	return { pss: Number(m[1]), size: Number(m[2]), alloc: Number(m[3]) };
}

function pair(text: string, first: string, second: string): [number, number] | null {
	const m = new RegExp(`${first}:\\s+(\\d+)\\s+${second}:\\s+(\\d+)`).exec(text);
	if (!m?.[1] || !m[2]) return null;
	return [Number(m[1]), Number(m[2])];
}

/**
 * Parses `dumpsys meminfo <package>`. Returns null when the system reports no such process (the app died or was
 * never started); throws when the process is there but the output has a shape this parser does not know, so a changed
 * format never reads as zero growth.
 */
export function parseMeminfo(text: string): MemInfo | null {
	if (/No process found for/.test(text)) return null;
	const pid = /\*\* MEMINFO in pid (\d+) \[/.exec(text)?.[1];
	const native = heapRow(text, "Native Heap");
	const dalvik = heapRow(text, "Dalvik Heap");
	const total = /^\s*TOTAL\s+(\d+)\s/m.exec(text)?.[1];
	const views = pair(text, "Views", "ViewRootImpl");
	const activities = pair(text, "AppContexts", "Activities");
	if (!pid || !native || !dalvik || !total || !views || !activities)
		throw new Error(`unrecognized dumpsys meminfo output: ${text.slice(0, 200)}`);
	return {
		pid: Number(pid),
		nativePssKb: native.pss,
		nativeAllocKb: native.alloc,
		nativeSizeKb: native.size,
		dalvikPssKb: dalvik.pss,
		dalvikAllocKb: dalvik.alloc,
		totalPssKb: Number(total),
		views: views[0],
		viewRootImpls: views[1],
		activities: activities[1],
		appContexts: activities[0],
	};
}
