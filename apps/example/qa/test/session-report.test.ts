import { describe, expect, test } from "bun:test";
import { sessionFindings, type ReportFile } from "../commands/report.ts";
import { reportProblems } from "../commands/gates.ts";

const lost = [
	"night mode: adb -s localhost:5555 shell cmd uimode night no exited with 1: error: device 'localhost:5555' not found",
	"font_scale: adb -s localhost:5555 shell settings delete system font_scale exited with 1: error: device 'localhost:5555' not found",
];

describe("what the suites' sessions say of the device in the report", () => {
	test("a run that could not put the device back is a warning that names the run and what stayed changed", () => {
		const { warnings, notes } = sessionFindings("localhost:5555", [
			["parity", { restoreFailures: [] }],
			["accessibility", { restoreFailures: lost }],
			["resilience", null],
		]);
		expect(notes).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/^localhost:5555: the device was left in a changed state by the accessibility run \(night mode: /);
		expect(warnings[0]).toContain("font_scale: ");
	});

	test("leftovers an earlier run left are a note, not a warning: the run cleared them before it measured", () => {
		const { warnings, notes } = sessionFindings("localhost:5555", [
			["parity", { leftovers: ['http_proxy was "localhost:33699", the failing proxy of an earlier run that did not restore it: cleared'] }],
		]);
		expect(warnings).toEqual([]);
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("localhost:5555: the parity run found what an earlier run left on the device");
		expect(notes[0]).toContain("localhost:33699");
	});

	test("run files written before the record existed, or with nothing in it, say nothing", () => {
		expect(
			sessionFindings("localhost:5555", [
				["parity", {}],
				["accessibility", { leftovers: [], restoreFailures: [] }],
			]),
		).toEqual({ warnings: [], notes: [] });
	});

	test("gates fail on the warning, for the device's platform only, like the cross-build ones", () => {
		const { warnings } = sessionFindings("localhost:5555", [["accessibility", { restoreFailures: lost }]]);
		const report = {
			schema: 1,
			generatedAt: "2026-10-27T10:00:00.000Z",
			builds: {},
			devices: { E74A: { platform: "ios" }, "localhost:5555": { platform: "android" } },
			warnings,
			gates: [],
		} as unknown as ReportFile;
		expect(reportProblems(report, [])).toEqual([`the report warns: ${warnings[0]}`]);
		expect(reportProblems(report, [], "android")).toHaveLength(1);
		expect(reportProblems(report, [], "ios")).toEqual([]);
	});
});
