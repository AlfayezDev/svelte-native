import { createHash } from "node:crypto";
import { elapsedMs, isJsFatal, parseLine, type LogLine } from "../parse/logcat.ts";
import type { CrashKind, CrashSignature } from "../lib/types.ts";

/** One failure found in a logcat capture: the original log lines that make it up, so a symbolizer can read them as logcat. */
export type RawCrash = {
	kind: CrashKind;
	title: string;
	/** Original `logcat -v threadtime` lines, in order. */
	raw: string[];
};

type Entry = { line: LogLine; raw: string };

const tombstoneWindowMs = 5000;

function entries(text: string): Entry[] {
	const found: Entry[] = [];
	for (const raw of text.split("\n")) {
		const line = parseLine(raw);
		if (line) found.push({ line, raw });
	}
	return found;
}

/** libc names the dying process by the last 15 characters of its name. */
function namesProcess(message: string, packageName: string): boolean {
	const name = /\bpid \d+ \(([^)]+)\)/.exec(message)?.[1];
	return name !== undefined && packageName.endsWith(name);
}

/** The fault address and the pid differ between runs of the same crash; the signal, the code and the thread name do not. */
function nativeTitle(message: string): string {
	return message
		.replace(/, fault addr \S+/, "")
		.replace(/, pid \d+ \([^)]*\)/, "")
		.replace(/ in tid \d+/, " in tid");
}

/**
 * Every crash of the package in a capture: Java `FATAL EXCEPTION`s (a JavaScript fatal is one of them: React Native
 * throws a `JavascriptException` carrying the JS stack), native `Fatal signal`s with the tombstone lines that follow,
 * and ANRs. Crashes of other processes are left out.
 */
export function extractCrashes(text: string, packageName: string): RawCrash[] {
	const all = entries(text);
	const crashes: RawCrash[] = [];
	for (let index = 0; index < all.length; index++) {
		const { line, raw } = all[index] as Entry;
		if (line.tag === "AndroidRuntime" && line.message.startsWith("FATAL EXCEPTION")) {
			const block: Entry[] = [{ line, raw }];
			for (let next = index + 1; next < all.length; next++) {
				const entry = all[next] as Entry;
				if (entry.line.tag !== "AndroidRuntime" || entry.line.pid !== line.pid) break;
				block.push(entry);
			}
			const process = block.find((entry) => entry.line.message.startsWith("Process: "));
			if (!process?.line.message.startsWith(`Process: ${packageName},`)) continue;
			const title = block
				.slice(block.indexOf(process) + 1)
				.find((entry) => entry.line.message.trim() !== "");
			crashes.push({
				kind: "java",
				title: title?.line.message.trim() ?? line.message,
				raw: block.map((entry) => entry.raw),
			});
			index += block.length - 1;
		} else if (isJsFatal(line)) {
			// `handleHostException(message = "<error>, stack:` then one `name@1:offset` line per frame, then `")`.
			const block: Entry[] = [{ line, raw }];
			for (let next = index + 1; next < all.length; next++) {
				const entry = all[next] as Entry;
				if (entry.line.tag !== line.tag || entry.line.pid !== line.pid) break;
				block.push(entry);
				if (entry.line.message.endsWith('")')) break;
			}
			crashes.push({
				kind: "js",
				title: line.message.slice(line.message.indexOf('message = "') + 'message = "'.length),
				raw: block.map((entry) => entry.raw),
			});
			index += block.length - 1;
		} else if (
			line.level === "F" &&
			line.tag === "libc" &&
			line.message.startsWith("Fatal signal") &&
			namesProcess(line.message, packageName)
		) {
			// The tombstone arrives as `DEBUG` lines within a moment, interleaved with other processes' lines.
			const block: Entry[] = [{ line, raw }];
			for (let next = index + 1; next < all.length; next++) {
				const entry = all[next] as Entry;
				if (elapsedMs(line.tsMs, entry.line.tsMs) > tombstoneWindowMs) break;
				if (entry.line.tag === "DEBUG") block.push(entry);
			}
			crashes.push({
				kind: "native",
				title: nativeTitle(line.message),
				raw: block.map((entry) => entry.raw),
			});
		} else if (line.message.startsWith(`ANR in ${packageName}`)) {
			const block: Entry[] = [{ line, raw }];
			for (let next = index + 1; next < all.length && block.length < 12; next++) {
				const entry = all[next] as Entry;
				if (entry.line.tag !== line.tag || entry.line.pid !== line.pid) break;
				block.push(entry);
			}
			const reason = block.find((entry) => entry.line.message.startsWith("Reason: "));
			crashes.push({
				kind: "anr",
				title: reason ? `${line.message.split(" (")[0]} ${reason.line.message}` : line.message,
				raw: block.map((entry) => entry.raw),
			});
			index += block.length - 1;
		}
	}
	return crashes;
}

const frameLine = /^\s*(?:at\s|#\d+\s+pc\s)|@\d+:\d+\s*$|address at /;

/** The message part of a raw logcat line, or the line itself when it is not in threadtime format. */
export function messageOf(raw: string): string {
	return parseLine(raw)?.message ?? raw;
}

/** The lines of a crash that are stack frames (Java `at`, native `#NN pc`, JavaScript `name@1:offset` and `address at`). */
export function frameLines(raw: string[]): string[] {
	return raw
		.map(messageOf)
		.filter((message) => frameLine.test(message))
		.map((message) => message.trim());
}

/** Drops what changes between runs of the same crash: install paths, build ids and the process's own addresses. */
function normalizeFrame(frame: string): string {
	return frame
		.replace(/\/data\/app\/\S*?\/([^/\s]+\.so)/g, "$1")
		.replace(/\(BuildId: [0-9a-f]+\)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Identity of a failure: its kind, its title and its top frames, so a thousand starts that crash alike are one signature with a count. */
export function signatureKey(kind: CrashKind, title: string, frames: string[]): string {
	const material = [kind, title, ...frames.slice(0, 4).map(normalizeFrame)].join("\n");
	return `${kind}-${createHash("sha1").update(material).digest("hex").slice(0, 10)}`;
}

export const maxSignatures = 20;

/**
 * Adds a failure to the list of distinct ones: a repeat of a known signature raises its count, a new one is kept until
 * the list holds [maxSignatures] (later distinct ones are not kept, their runs still count in the crash metrics).
 */
export function recordSignature(
	signatures: CrashSignature[],
	candidate: Omit<CrashSignature, "key" | "count">,
): void {
	const key = signatureKey(candidate.kind, candidate.title, candidate.frames);
	const known = signatures.find((signature) => signature.key === key);
	if (known) known.count++;
	else if (signatures.length < maxSignatures) signatures.push({ ...candidate, key, count: 1 });
}
