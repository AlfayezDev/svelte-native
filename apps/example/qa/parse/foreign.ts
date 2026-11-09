import type { ForeignCheck, ForeignPlace, ForeignSkip } from "../lib/types.ts";
import { parseLines, quotedArgument } from "./logcat.ts";

const checkPrefix = "'[Svelte foreign library]', '";
const skipPrefix = "'[Svelte foreign library skipped]', '";
const places: readonly ForeignPlace[] = ["inline", "row", "sheet"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON a string holds; null when it is not JSON. */
function readJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** A check as the lab records it (`{"library","where","name","passed","detail"}`), or null when the value is not one (a place the lab does not have, a missing field). */
export function foreignCheckOf(value: unknown): ForeignCheck | null {
	if (!isRecord(value) || typeof value.library !== "string" || typeof value.name !== "string" || typeof value.passed !== "boolean" || !places.includes(value.where as ForeignPlace)) return null;
	return { library: value.library, where: value.where as ForeignPlace, name: value.name, passed: value.passed, detail: typeof value.detail === "string" ? value.detail : "" };
}

/** A skip as the lab records it; `androidOnly` marks a check that exists on Android only. */
export function foreignSkipOf(value: unknown): ForeignSkip | null {
	if (!isRecord(value) || typeof value.library !== "string" || typeof value.name !== "string") return null;
	return { library: value.library, where: typeof value.where === "string" ? value.where : "", name: value.name, why: typeof value.why === "string" ? value.why : "", ...(value.androidOnly === true ? { androidOnly: true as const } : {}) };
}

/**
 * Every check the library lab logged (`[Svelte foreign library] {"library":...,"where":...,"name":...,"passed":...,"detail":...}`) and every one it skipped.
 * A line that carries one of the two tags and is not a record of it (cut by logcat, escaped in a way nobody expected, a place the lab does not have) is in
 * `unparsed`: a check nobody can read must fail the run, not leave it with fewer checks that all passed.
 */
export function parseForeignChecks(text: string): { checks: ForeignCheck[]; skips: ForeignSkip[]; unparsed: string[] } {
	const checks: ForeignCheck[] = [];
	const skips: ForeignSkip[] = [];
	const unparsed: string[] = [];
	for (const line of parseLines(text)) {
		const message = line.message;
		const isCheck = message.startsWith(checkPrefix);
		const isSkip = message.startsWith(skipPrefix);
		if (!isCheck && !isSkip) continue;
		const value = readJson(quotedArgument(message, isCheck ? checkPrefix : skipPrefix));
		const check = isCheck ? foreignCheckOf(value) : null;
		const skip = isSkip ? foreignSkipOf(value) : null;
		if (check) checks.push(check);
		else if (skip) skips.push(skip);
		else unparsed.push(message.slice(0, 240));
	}
	return { checks, skips, unparsed };
}
