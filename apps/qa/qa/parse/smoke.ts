import type { SmokeCompletion, SmokeModuleResult } from "../lib/types.ts";
import { parseLines } from "./logcat.ts";

const prefix = "[Svelte smoke] ";

/** `[Svelte smoke] <module> ok|fail|skip path=<path> ms=<n> <detail>`, which the app logs as one string (a quoted one when a console call had several arguments). */
const moduleLine = /^([a-z0-9-]+) (ok|fail|skip)(?: path=(\S+))?(?: ms=(\d+))?(?: (.*))?$/;

function body(message: string): string | null {
	const at = message.indexOf(prefix);
	if (at < 0) return null;
	return message.slice(at + prefix.length).replace(/'\s*$/, "");
}

/** Parses the text after `[Svelte smoke] `; null for the completion line or anything else. */
export function parseSmokeBody(text: string): SmokeModuleResult | null {
	const m = moduleLine.exec(text);
	if (!m?.[1] || !m[2]) return null;
	return {
		module: m[1],
		status: m[2] as SmokeModuleResult["status"],
		path: m[3] ?? "none",
		ms: m[4] === undefined ? null : Number(m[4]),
		detail: m[5] ?? "",
	};
}

/**
 * The modules a run reported, in the order they first reported. A module that reported twice (the app was started again, or
 * the page was run by hand) keeps its last line: the lab clears logcat before a launch, so a second line is a second run.
 */
export function parseSmokeResults(text: string): SmokeModuleResult[] {
	const byModule = new Map<string, SmokeModuleResult>();
	for (const line of parseLines(text)) {
		const content = body(line.message);
		const result = content === null ? null : parseSmokeBody(content);
		if (result) byModule.set(result.module, result);
	}
	return [...byModule.values()];
}

/** The `[Svelte smoke] complete {...}` line, or null when the app never logged it (or logged it cut off). */
export function parseSmokeCompletion(text: string): SmokeCompletion | null {
	for (const line of parseLines(text)) {
		const content = body(line.message);
		if (content === null || !content.startsWith("complete ")) continue;
		try {
			const value = JSON.parse(content.slice("complete ".length)) as Partial<SmokeCompletion>;
			if (typeof value.total === "number" && typeof value.ok === "number" && typeof value.fail === "number" && typeof value.skip === "number" && typeof value.os === "string")
				return { os: value.os, total: value.total, ok: value.ok, fail: value.fail, skip: value.skip };
		} catch {
			// A line logcat cut off is the same as no line: the run is incomplete.
		}
	}
	return null;
}
