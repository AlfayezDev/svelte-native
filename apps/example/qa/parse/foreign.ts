import type { ForeignCheck, ForeignPlace, ForeignSkip } from "../lib/types.ts";
import { parseLines } from "./logcat.ts";

const checkPrefix = "'[Svelte foreign library]', '";
const skipPrefix = "'[Svelte foreign library skipped]', '";
const places: readonly ForeignPlace[] = ["inline", "row", "sheet"];

/**
 * A string argument of `console.info` as it reaches logcat: Hermes prints it in single quotes, a quote inside as `\'` and a backslash as `\\`
 * (so the `\"` of a JSON detail that is JSON itself is `\\"`), which has to be undone before the text is JSON.
 */
export function unescapeLogcat(text: string): string {
	return text.replace(/\\(['\\])/g, "$1");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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
		let value: unknown = null;
		try {
			value = JSON.parse(unescapeLogcat(message.slice((isCheck ? checkPrefix : skipPrefix).length).replace(/'\s*$/, "")));
		} catch {
			value = null;
		}
		if (isCheck && isRecord(value) && typeof value.library === "string" && typeof value.name === "string" && typeof value.passed === "boolean" && places.includes(value.where as ForeignPlace)) {
			checks.push({ library: value.library, where: value.where as ForeignPlace, name: value.name, passed: value.passed, detail: typeof value.detail === "string" ? value.detail : "" });
		} else if (isSkip && isRecord(value) && typeof value.library === "string" && typeof value.name === "string") {
			skips.push({ library: value.library, where: typeof value.where === "string" ? value.where : "", name: value.name, why: typeof value.why === "string" ? value.why : "" });
		} else {
			unparsed.push(message.slice(0, 240));
		}
	}
	return { checks, skips, unparsed };
}
