import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeScreen } from "../lib/a11y.ts";
import { judgeNodeInfo, judgeNodes, parseNodeInfo, standardActions, type InfoExpectation, type NodeInfo } from "../lib/a11y-state.ts";
import { a11yMetrics } from "../lib/suite-metrics.ts";
import { platformDir } from "../lib/paths.ts";
import { cases } from "../lib/screens.ts";
import { parseHierarchy } from "../lib/uia.ts";
import type { A11yFile, A11yScreenResult } from "../lib/types.ts";

type N = { id?: string; cls?: string; text?: string; desc?: string; hint?: string; checkable?: boolean; checked?: boolean; selected?: boolean; enabled?: boolean; clickable?: boolean; focusable?: boolean; children?: N[] };

function node(n: N, top: number): string {
	return `<node index="0" text="${n.text ?? ""}" resource-id="${n.id ?? ""}" class="${n.cls ?? "android.view.View"}" package="p" content-desc="${n.desc ?? ""}" hint="${n.hint ?? ""}" checkable="${n.checkable ?? false}" checked="${n.checked ?? false}" clickable="${n.clickable ?? false}" enabled="${n.enabled ?? true}" focusable="${n.focusable ?? false}" focused="false" scrollable="false" long-clickable="false" password="false" selected="${n.selected ?? false}" bounds="[0,${top}][1080,${top + 100}]">${(n.children ?? []).map((child) => node(child, top)).join("")}</node>`;
}

const tree = (...nodes: N[]) =>
	parseHierarchy(`<?xml version='1.0' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">${nodes.map((entry, index) => node(entry, 100 + index * 120)).join("")}</node></hierarchy>`);

describe("what the dump must show of a control", () => {
	const checkbox: N = { id: "a11y.terms", cls: "android.widget.CheckBox", desc: "Accept terms", checkable: true, checked: true, clickable: true };

	test("a node that matches in everything the expectation names is no finding, and what it does not name is not judged", () => {
		expect(judgeNodes(tree(checkbox), [{ id: "a11y.terms", className: "android.widget.CheckBox", says: "Accept terms", checkable: true, checked: true, clickable: true }], 1)).toEqual([]);
		expect(judgeNodes(tree(checkbox), [{ id: "a11y.terms", says: "Accept terms" }], 1)).toEqual([]);
	});

	test("every difference is named in one finding of the node", () => {
		const findings = judgeNodes(tree({ ...checkbox, checked: false, enabled: false }), [{ id: "a11y.terms", checked: true, enabled: true, says: "Accept" }], 1);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ kind: "state" });
		expect(findings[0]?.detail).toContain('says is "Accept terms", expected "Accept"');
		expect(findings[0]?.detail).toContain("checked is false, expected true");
		expect(findings[0]?.detail).toContain("enabled is false, expected true");
	});

	test("the label a service speaks is the text when there is no content description", () => {
		expect(judgeNodes(tree({ id: "a11y.last", text: "Last action: archive", cls: "android.widget.TextView" }), [{ id: "a11y.last", says: "Last action: archive" }], 1)).toEqual([]);
	});

	test("the hint attribute is the node's hint text, which React Native leaves empty", () => {
		expect(judgeNodes(tree({ id: "a11y.hint", desc: "Archive thread" }), [{ id: "a11y.hint", hint: "" }], 1)).toEqual([]);
		expect(judgeNodes(tree({ id: "a11y.hint", desc: "Archive thread", hint: "Moves the thread" }), [{ id: "a11y.hint", hint: "" }], 1)).toHaveLength(1);
	});

	test("a node missing from the tree is a finding at the normal text size and not at a larger one, where it may be below the fold", () => {
		expect(judgeNodes(tree(), [{ id: "a11y.terms", checked: true }], 1)).toEqual([{ kind: "state", element: "a11y.terms", detail: "not in the tree a service walks" }]);
		expect(judgeNodes(tree(), [{ id: "a11y.terms", checked: true }], 2)).toEqual([]);
		expect(judgeNodes(tree({ ...checkbox, checked: false }), [{ id: "a11y.terms", checked: true }], 2)).toHaveLength(1);
	});

	test("a hidden node is absent, and so is what it says", () => {
		const expectation = [{ id: "a11y.hidden", absent: true, label: "Hidden note" }];
		expect(judgeNodes(tree({ id: "visible", text: "Visible note" }), expectation, 1)).toEqual([]);
		expect(judgeNodes(tree({ id: "a11y.hidden" }), expectation, 1)).toHaveLength(1);
		expect(judgeNodes(tree({ text: "Hidden note", cls: "android.widget.TextView" }), expectation, 1)).toHaveLength(1);
	});
});

describe("the app's node info, read from logcat", () => {
	const info = (extra: Partial<NodeInfo> = {}): NodeInfo => ({
		id: "a11y.slider", class: "android.widget.SeekBar", text: "", desc: "Volume, 5 of 10", tooltip: "", stateDescription: "", hintText: "", roleDescription: "",
		heading: false, checkable: false, checked: false, selected: false, enabled: true, clickable: false, longClickable: false, focusable: true,
		liveRegion: 0, important: 0, range: { min: 0, max: 10, current: 5 }, actions: [{ id: 0x1000, label: "" }, { id: 0x2000, label: "" }], ...extra,
	});
	const line = (text: string) => `11-01 19:00:00.000  1000  1000 I ReactNativeJS: [Svelte a11y] ${text}`;

	test("the last probe's nodes are the ones before its done line", () => {
		const old = info({ id: "old" });
		const log = [line(`node ${JSON.stringify(old)}`), line("done 1"), "11-01 noise", line(`node ${JSON.stringify(info())}`), line(`node ${JSON.stringify(info({ id: "a11y.row" }))}`), line("done 2")].join("\n");
		expect(parseNodeInfo(log)?.map((entry) => entry.id)).toEqual(["a11y.slider", "a11y.row"]);
	});

	test("no done line is no result; a count that disagrees with the lines is an error", () => {
		expect(parseNodeInfo(line(`node ${JSON.stringify(info())}`))).toBeNull();
		expect(parseNodeInfo("")).toBeNull();
		expect(() => parseNodeInfo([line(`node ${JSON.stringify(info())}`), line("done 2")].join("\n"))).toThrow("2 nodes and 1");
		expect(() => parseNodeInfo([line("node {\"id\":"), line("done 1")].join("\n"))).toThrow();
	});

	test("range, tooltip, role description, live region, important and actions are compared with what React Native publishes", () => {
		const wanted: InfoExpectation = { id: "a11y.slider", className: "android.widget.SeekBar", range: { min: 0, max: 10, current: 5 }, actions: [{ name: "increment", label: "" }, { name: "decrement", label: "" }], liveRegion: 0, important: 0 };
		expect(judgeNodeInfo([info()], [wanted])).toEqual([]);
		const wrong = judgeNodeInfo([info({ range: { min: 0, max: 10, current: 6 }, liveRegion: 1, actions: [{ id: 0x1000, label: "" }] })], [wanted]);
		expect(wrong).toHaveLength(1);
		expect(wrong[0]?.detail).toContain("range is");
		expect(wrong[0]?.detail).toContain("live region is 1, expected 0");
		expect(wrong[0]?.detail).toContain("no action decrement");
		expect(judgeNodeInfo([info({ range: undefined })], [{ id: "a11y.slider", range: null }])).toEqual([]);
		expect(judgeNodeInfo([info()], [{ id: "a11y.slider", range: null }])[0]?.detail).toContain("range is");
		expect(judgeNodeInfo([info({ tooltip: "Moves the thread" })], [{ id: "a11y.slider", tooltip: "Moves the thread" }])).toEqual([]);
		expect(judgeNodeInfo([info({ tooltip: "x" })], [{ id: "a11y.slider", tooltip: "Moves the thread" }])).toHaveLength(1);
	});

	test("custom actions are found by label and their ids start at 0x3f000000; the standard ones by id", () => {
		const row = info({ id: "a11y.row", actions: [{ id: 16, label: "" }, { id: 0x3f000000, label: "Archive" }, { id: 0x3f000001, label: "Delete" }] });
		const wanted = { id: "a11y.row", actions: [{ name: "archive", label: "Archive" }, { name: "delete", label: "Delete" }] };
		expect(judgeNodeInfo([row], [wanted])).toEqual([]);
		expect(judgeNodeInfo([row], [{ id: "a11y.row", actions: [{ name: "archive", label: "Archive" }] }])[0]?.detail).toContain("2 custom actions, expected 1");
		expect(judgeNodeInfo([row], [{ id: "a11y.row", actions: [{ name: "archive", label: "Move" }] }])[0]?.detail).toContain("no action archive");
		expect(judgeNodeInfo([row], [{ id: "a11y.row", actions: [{ name: "activate", label: "" }] }].map((e) => ({ ...e, actions: [...e.actions, ...wanted.actions] })))).toEqual([]);
		expect(judgeNodeInfo([row], [{ id: "a11y.row", without: ["activate"] }])[0]?.detail).toContain("has the activate action");
		expect(standardActions.increment).toBe(0x1000);
	});

	test("React Native writes no state description and no hint text, so they are judged empty unless an expectation says otherwise", () => {
		expect(judgeNodeInfo([info({ stateDescription: "On" })], [{ id: "a11y.slider" }])[0]?.detail).toContain("state description");
		expect(judgeNodeInfo([info({ hintText: "Hint" })], [{ id: "a11y.slider" }])[0]?.detail).toContain("hint text");
		expect(judgeNodeInfo([info({ stateDescription: "On" })], [{ id: "a11y.slider", stateDescription: "On" }])).toEqual([]);
	});

	test("a node the app did not publish, and no read at all, are findings", () => {
		expect(judgeNodeInfo([info()], [{ id: "a11y.gone" }])).toEqual([{ kind: "state", element: "a11y.gone", detail: "the app published no node for it" }]);
		expect(judgeNodeInfo(null, [{ id: "a11y.slider" }])[0]?.detail).toContain("did not log");
	});
});

describe("analyzeScreen with expectations", () => {
	const base = { direction: "ltr" as const, display: { width: 1080, height: 2400 }, title: null, controls: [], scrolled: [], hidden: [], layout: "page" as const };

	test("a screen with no expectations has no state count; one with them counts the mismatches of both readers", () => {
		const t = tree({ id: "a11y.terms", cls: "android.widget.CheckBox", desc: "Accept terms", checkable: true, checked: false, clickable: true, focusable: true });
		expect(analyzeScreen({ ...base, tree: t }).stateMismatches).toBeUndefined();
		expect(analyzeScreen({ ...base, tree: t, expect: [{ id: "a11y.terms", checked: true }] }).stateMismatches).toBe(1);
		const both = analyzeScreen({ ...base, tree: t, expect: [{ id: "a11y.terms", checked: false }], info: [{ id: "a11y.terms", tooltip: "x" }], nodeInfo: null });
		expect(both.stateMismatches).toBe(1);
		expect(both.findings.map((finding) => finding.kind)).toContain("state");
	});
});

describe("the lab's cases", () => {
	const lab = readFileSync(join(platformDir, "src/routes/__dev/a11y/+mobile.svelte"), "utf8");
	const labCases = cases.filter((screen) => screen.id.startsWith("lab-a11y"));

	test("there is a case per mode of the lab, Android only, and its link carries the probe that makes the lab log its node info", () => {
		expect(labCases.map((screen) => screen.id)).toEqual(["lab-a11y-states", "lab-a11y-actions"]);
		for (const screen of labCases) {
			expect(screen.androidOnly).toBe(true);
			expect(screen.deepLink).toMatch(/^rasheed-svelte:\/\/\/__dev\/a11y\?mode=(states|actions)&probe=(nodes|actions)$/);
			expect(screen.info?.length).toBeGreaterThan(0);
			expect(screen.expect?.length).toBeGreaterThan(0);
		}
		expect(labCases[1]?.deepLink).toContain("probe=actions");
	});

	test("every testID an expectation names is a control of the lab page, in the mode its case opens", () => {
		for (const screen of labCases) {
			const mode = /mode=(\w+)/.exec(screen.deepLink ?? "")?.[1];
			const section = mode === "actions" ? lab.slice(lab.indexOf("{:else}")) : lab.slice(0, lab.indexOf("{:else}"));
			for (const id of [...(screen.expect ?? []).map((entry) => entry.id), ...(screen.info ?? []).map((entry) => entry.id)]) {
				const stem = id.replace(/\.(free|pro|team|inbox|archive)$/, "");
				expect(section.includes(`testID="${id}"`) || section.includes(`testID={\`${stem}.`) || section.includes(`testID="${stem}.`)).toBe(true);
			}
		}
	});

	test("the lab does what the cases assume: the probes, the node info and the action it performs", () => {
		expect(lab).toContain('performAccessibilityAction?.("a11y.row", "archive")');
		expect(lab).toContain('performAccessibilityAction?.("a11y.slider", "increment")');
		expect(lab).toContain("[Svelte a11y]");
		const actions = labCases[1];
		expect(actions?.info?.find((entry) => entry.id === "a11y.slider")?.range).toEqual({ min: 0, max: 10, current: 5 }); // 4 at the start, one increment
		expect(lab).toContain("let level = $state(4)");
	});
});

describe("the metric and the gate", () => {
	const screen = (name: string, stateMismatches?: number): A11yScreenResult => ({
		name, screen: name, route: "/", direction: "ltr", fontScale: 1, interactive: 1, reachable: 1, labeled: 1, actionable: 1, disabled: 0, clipped: 0, unreachable: 0,
		unlabeled: 0, notActionable: 0, orderViolations: 0, titleFirst: null, focusLeaks: 0, stops: [], findings: [], error: null, ...(stateMismatches === undefined ? {} : { stateMismatches }),
	});
	const file = (screens: A11yScreenResult[]) => ({ matrixSize: screens.length, screens }) as unknown as A11yFile;

	test("the mismatches are summed over the screens, and a run from before they were counted has none", () => {
		expect(a11yMetrics(file([screen("a", 2), screen("b", 1), screen("c")]))["a11y.stateMismatches"]).toBe(3);
		expect(a11yMetrics(file([screen("a")]))["a11y.stateMismatches"]).toBe(0);
	});

	test("gates.json bars it at 0 for Android and does not ask the iPhone for it", () => {
		const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as { gates: { id: string; metric: string; bar: Record<string, { max?: number }> }[] };
		const gate = gates.gates.find((entry) => entry.id === "a11y.stateMismatches");
		expect(gate?.metric).toBe("a11y.stateMismatches");
		expect(gate?.bar).toEqual({ android: { max: 0 } });
	});
});
