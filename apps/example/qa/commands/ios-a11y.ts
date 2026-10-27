import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, parseFlags } from "../lib/flags.ts";
import { reachPct } from "../lib/a11y.ts";
import { analyzeIosScreen, type IosDump, type UiKitState } from "../lib/iphone/a11y.ts";
import { captureScreens } from "../lib/iphone/capture.ts";
import { IdentityMismatch, notReported, reportedIdentity, withIdentity } from "../lib/iphone/identity.ts";
import { iosBelowTheFold, iosCases, iosControl, iosLayoutVariants, iosMatrix, iosNotCovered, iosTitle } from "../lib/iphone/screens.ts";
import { currentSource, iosOptions, newToken, startIosSuite } from "../lib/iphone/session.ts";
import { runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { localize, referenceName, type ScreenCase, type Variant } from "../lib/screens.ts";
import { backendStatus } from "../lib/suite.ts";
import type { A11yFile, A11yScreenResult, BuildIdentity } from "../lib/types.ts";

/** What the checks read, stated in every run file: VoiceOver itself was not run. */
export const iosOracle =
	"the accessibility elements the app reports for its own window (UIAccessibility traversal in SvelteQAAccessibility.swift: hidden views, accessibilityElementsHidden, accessibilityElements, containers and accessibilityViewIsModal applied as the system applies them), with label, value, hint, traits and frame, which is what the accessibility services receive. VoiceOver itself was not run; its default order is modelled as a sort by position (rows from the top, start edge first) for the elements no container orders. UIKit's bars are not accessibility elements until a client runs: their titles, back buttons, search fields and tab items (labels, badges, enabled) are modelled from uikitState with guessed frames, marked synthesized, kept in the order model and left out of the counts (chromeModelled).";

function emptyResult(screen: ScreenCase, variant: Variant, error: string): A11yScreenResult {
	return {
		name: referenceName(screen, variant),
		screen: screen.id,
		route: screen.route,
		direction: variant.direction,
		fontScale: variant.fontScale,
		interactive: 0,
		reachable: 0,
		labeled: 0,
		actionable: 0,
		disabled: 0,
		clipped: 0,
		unreachable: 0,
		unlabeled: 0,
		notActionable: 0,
		orderViolations: 0,
		titleFirst: null,
		focusLeaks: 0,
		stops: [],
		findings: [],
		chromeModelled: 0,
		stable: null,
		error,
	};
}

export async function iosA11y(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, quick: { type: "boolean" }, filter: { type: "string" } });
	const session = await startIosSuite("a11y", argv, values);
	const filter = flagString(values.filter);
	const chosenVariants = values.quick === true ? iosLayoutVariants.slice(0, 1) : iosLayoutVariants;
	const chosenCases = iosCases.filter((screen) => !filter || screen.id.includes(filter));
	if (chosenCases.length === 0) throw new Error(`--filter ${filter} matches no screen (${iosCases.map((screen) => screen.id).join(", ")})`);
	const backend = await backendStatus();
	console.log(`checking ${iosMatrix(chosenCases, chosenVariants).length} screens in ${chosenVariants.length} layouts; backend: ${backend.detail}`);

	const results: A11yScreenResult[] = [];
	const reports: (BuildIdentity | null)[] = [];
	let aborted: string | null = null;
	try {
		for (const variant of chosenVariants) {
			const dir = join(runsDir, `a11y-${slug(session.device.serial)}-${stamp(session.startedAt)}`, `capture-${variant.direction}`);
			const captured = await captureScreens(session, {
				ids: chosenCases.map((screen) => screen.id),
				themes: ["light"],
				direction: variant.direction,
				dir,
				token: newToken(),
				timeoutMs: 600_000,
				log: (line) => console.log(line),
			});
			// Before any of its screens are read: a capture of the wrong build ends the run and writes nothing.
			reports.push(captured.index.build);
			reportedIdentity(reports, session.build, "a11y");
			for (const { screen } of iosMatrix(chosenCases, [variant])) {
				if (screen.needsBackend && !backend.ok) {
					results.push(emptyResult(screen, variant, `needs the dev backend: ${backend.detail}`));
					console.log(`  skipped  ${referenceName(screen, variant)}: backend`);
					continue;
				}
				const entry = captured.index.entries.find((candidate) => candidate.screen === screen.id);
				if (!entry?.a11y || entry.error) {
					results.push(emptyResult(screen, variant, entry?.error ?? "the app did not report this screen"));
					console.log(`  error    ${referenceName(screen, variant)}: ${entry?.error ?? "not reported"}`);
					continue;
				}
				const dump = JSON.parse(await readFile(join(captured.dir, entry.a11y), "utf8")) as IosDump;
				if (dump.rtl !== (variant.direction === "rtl")) {
					results.push(emptyResult(screen, variant, `asked for ${variant.direction} but the window reported ${dump.rtl ? "rtl" : "ltr"}`));
					continue;
				}
				const state = entry.uikit ? (JSON.parse(await readFile(join(captured.dir, entry.uikit), "utf8")) as UiKitState) : null;
				const analysis = analyzeIosScreen({
					dump,
					state,
					direction: variant.direction,
					title: iosTitle(screen, variant.direction),
					lead: screen.lead.map((label) => localize(label, variant.direction)),
					scrolled: [...screen.scrolled.map((control) => iosControl(control, variant.direction)), ...(iosBelowTheFold[screen.id] ?? [])],
					controls: screen.controls.map((control) => iosControl(control, variant.direction)),
					hidden: screen.hidden.map((label) => localize(label, variant.direction)),
					layout: screen.layout,
				});
				results.push({ name: referenceName(screen, variant), screen: screen.id, route: screen.route, direction: variant.direction, fontScale: variant.fontScale, ...analysis, stable: null, error: null });
				console.log(
					`  ${referenceName(screen, variant).padEnd(44)} interactive ${analysis.interactive} (reach ${reachPct(analysis)}, clipped ${analysis.clipped}, modelled chrome ${analysis.chromeModelled}), unreachable ${analysis.unreachable}, unlabeled ${analysis.unlabeled}, not actionable ${analysis.notActionable}, order ${analysis.orderViolations}, title ${analysis.titleFirst === null ? "-" : analysis.titleFirst ? "first" : "NOT first"}, leaks ${analysis.focusLeaks}`,
				);
			}
		}
	} catch (error) {
		if (error instanceof IdentityMismatch) throw error;
		aborted = error instanceof Error ? error.message : String(error);
		console.log(`stopped: ${aborted.slice(0, 300)}`);
	}
	const installed = reportedIdentity(reports, session.build, "a11y");
	if (reports.length > 0 && installed === null) console.log(`warning: ${notReported}`);

	const file: A11yFile = {
		schema: 1,
		kind: "a11y",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device: session.device,
		app: withIdentity(session.app, installed),
		oracle: iosOracle,
		matrixSize: iosMatrix(iosCases, iosLayoutVariants).length,
		screens: results,
		notCovered: iosNotCovered,
		aborted,
	};
	const name = await writeRun("a11y", session.device.serial, session.startedAt, file);
	const total = (pick: (screen: A11yScreenResult) => number) => results.reduce((sum, screen) => sum + pick(screen), 0);
	console.log(
		`a11y: ${results.length} screens, ${total((s) => s.interactive)} interactive elements, ${total((s) => s.unreachable)} unreachable, ${total((s) => s.unlabeled)} unlabeled, ${total((s) => s.notActionable)} not actionable, ${total((s) => s.orderViolations)} order violations, ${results.filter((s) => s.titleFirst === false).length} titles not first, ${total((s) => s.focusLeaks)} focus leaks, ${results.filter((s) => s.error !== null).length} errors`,
	);
	console.log(`wrote qa/runs/${name}.json`);
}
