import { flagString, parseFlags } from "../lib/flags.ts";
import { evaluate } from "../lib/gates.ts";
import { reportPath } from "../lib/paths.ts";
import { readJson } from "../lib/runs.ts";
import { loadGates, printVerdict, reportDevices, type ReportFile } from "./report.ts";

/** Evaluates gates.json against the measurements in report.json and sets the exit code: 0 only if every gate passed. */
export async function gates(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { platform: { type: "string" }, all: { type: "boolean" } });
	const platform = flagString(values.platform);
	if (platform !== undefined && platform !== "android" && platform !== "ios")
		throw new Error("--platform must be android or ios");
	const reportFile = await readJson<ReportFile>(reportPath).catch((error: unknown) => {
		throw new Error(
			`cannot read qa/report.json (run \`native-qa report\` first): ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	const rows = evaluate((await loadGates()).gates, reportDevices(reportFile), platform);
	const ok = printVerdict(rows, values.all === true);
	process.exitCode = ok ? 0 : 1;
}
