import { parseArgs } from "node:util";

type Option = { type: "string" | "boolean" };

/** Strict flag parsing: an unknown flag is an error, so a typo never silently falls back to a default. */
export function parseFlags<const O extends Record<string, Option>>(argv: string[], options: O) {
	const { values, positionals } = parseArgs({
		args: argv,
		options,
		strict: true,
		allowPositionals: false,
	});
	return { values, positionals };
}

export function requireString(value: string | boolean | undefined, name: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required`);
	return value;
}

export function flagString(value: string | boolean | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function integerFlag(
	value: string | boolean | undefined,
	name: string,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	const parsed = typeof value === "string" ? Number(value) : Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 0)
		throw new Error(`--${name} must be a non-negative integer`);
	return parsed;
}
