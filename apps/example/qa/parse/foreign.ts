import type { ForeignCheck, ForeignPlace, ForeignSkip } from "../lib/types.ts";
import { parseLines } from "./logcat.ts";

const checkTag = "[Svelte foreign library]";
const skipTag = "[Svelte foreign library skipped]";
const places: readonly ForeignPlace[] = ["inline", "row", "sheet"];

/** The JSON of a console line `'<tag>', '{...}'`; null for another line. */
function payload(message: string, tag: string): unknown {
	const prefix = `'${tag}', '`;
	if (!message.startsWith(prefix)) return null;
	try {
		return JSON.parse(message.slice(prefix.length).replace(/'\s*$/, ""));
	} catch {
		// A line logcat cut is a check nobody can read; its library then has fewer checks than the run is pinned to, and the gate says so.
		return null;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every check the library lab logged (`[Svelte foreign library] {"library":...,"where":...,"name":...,"passed":...,"detail":...}`) and every one it skipped. */
export function parseForeignChecks(text: string): { checks: ForeignCheck[]; skips: ForeignSkip[] } {
	const checks: ForeignCheck[] = [];
	const skips: ForeignSkip[] = [];
	for (const line of parseLines(text)) {
		const check = payload(line.message, checkTag);
		if (isRecord(check) && typeof check.library === "string" && typeof check.name === "string" && typeof check.passed === "boolean" && places.includes(check.where as ForeignPlace)) {
			checks.push({ library: check.library, where: check.where as ForeignPlace, name: check.name, passed: check.passed, detail: typeof check.detail === "string" ? check.detail : "" });
			continue;
		}
		const skip = payload(line.message, skipTag);
		if (isRecord(skip) && typeof skip.library === "string" && typeof skip.name === "string")
			skips.push({ library: skip.library, where: typeof skip.where === "string" ? skip.where : "", name: skip.name, why: typeof skip.why === "string" ? skip.why : "" });
	}
	return { checks, skips };
}
