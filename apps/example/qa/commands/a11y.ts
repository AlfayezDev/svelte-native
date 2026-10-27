import { wake } from "../lib/adb.ts";
import { analyzeScreen, reachPct } from "../lib/a11y.ts";
import { deviceGone, dumpUi, readDisplay, withSession } from "../lib/device.ts";
import { dumpWithOwnControls, openCase, settledTree } from "../lib/drive.ts";
import { flagString, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { writeRun } from "../lib/runs.ts";
import {
	cases,
	layoutVariants,
	matrix,
	notCoveredStates,
	localize,
	notCovered,
	ownLabels,
	referenceName,
	type ScreenCase,
	type Variant,
} from "../lib/screens.ts";
import { backendStatus, commonOptions, startSuite, type BackendStatus } from "../lib/suite.ts";
import type { A11yFile, A11yScreenResult } from "../lib/types.ts";
import { iosA11y } from "./ios-a11y.ts";

/** What the checks read, stated in every run file. */
export const oracle =
	"uiautomator dump of the foreground window: the accessibility node info the engine publishes (A11y.kt, EngineText, EngineHeader, EngineTabs), which is what any accessibility service receives. The focus trap is judged on the dump without the views that are not important for accessibility (`--compressed`), which is the tree a service that does not ask for them, TalkBack among them, walks. The suite does not run TalkBack itself.";

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

export async function a11y(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosA11y(argv);
	const { values } = parseFlags(argv, {
		...commonOptions,
		quick: { type: "boolean" },
		filter: { type: "string" },
	});
	const suite = await startSuite("a11y", argv, values);
	const { serial, packageName, device, app, startedAt } = suite;
	const filter = flagString(values.filter);
	const chosenVariants = values.quick === true ? layoutVariants.slice(0, 2) : layoutVariants;
	const chosenCases = cases.filter((screen) => !filter || screen.id.includes(filter));
	if (chosenCases.length === 0)
		throw new Error(
			`--filter ${filter} matches no screen (${cases.map((screen) => screen.id).join(", ")})`,
		);
	const display = await readDisplay(serial);
	const backend: BackendStatus = await backendStatus();
	console.log(
		`checking ${matrix(chosenCases, chosenVariants).length} screens in ${chosenVariants.length} layouts; backend: ${backend.detail}`,
	);

	const results: A11yScreenResult[] = [];
	let aborted: string | null = null;
	try {
		await withSession(serial, packageName, async (session) => {
			await session.rotation(0);
			await wake(serial);
			await session.theme("light");
			for (const variant of chosenVariants) {
				await session.fontScale(variant.fontScale);
				await session.direction(variant.direction);
				for (const { screen } of matrix(chosenCases, [variant])) {
					const began = Date.now();
					if (screen.needsBackend && !backend.ok) {
						results.push(emptyResult(screen, variant, `needs the dev backend: ${backend.detail}`));
						console.log(`  skipped  ${referenceName(screen, variant)}: backend`);
						continue;
					}
					try {
						// One more try after a failure that is not the device going away: the first dump after the
						// emulator was restarted can come back empty while its UI is still starting.
						const attempt = async () => {
							const opened = await openCase(session, screen, variant.direction);
							return settledTree(serial, opened.tree);
						};
						const { tree, stable } = await attempt().catch((error: unknown) => {
							if (deviceGone(error)) throw error;
							console.log(
								`  retrying ${referenceName(screen, variant)}: ${error instanceof Error ? error.message.slice(0, 100) : String(error)}`,
							);
							return attempt();
						});
						// What a screen reader walks: only needed (and only different) while a sheet or modal covers a screen.
						const importantTree =
							screen.hidden.length > 0
								? await dumpWithOwnControls(
										() => dumpUi(serial, { important: true }),
										ownLabels(screen, variant.direction),
									)
								: undefined;
						const analysis = analyzeScreen({
							tree,
							importantTree,
							direction: variant.direction,
							display,
							title: screen.title === null ? null : localize(screen.title, variant.direction),
							lead: screen.lead.map((label) => localize(label, variant.direction)),
							scrolled: screen.scrolled.map((control) => localize(control, variant.direction)),
							controls: screen.controls.map((control) => localize(control, variant.direction)),
							hidden: screen.hidden.map((label) => localize(label, variant.direction)),
							layout: screen.layout,
						});
						results.push({
							name: referenceName(screen, variant),
							screen: screen.id,
							route: screen.route,
							direction: variant.direction,
							fontScale: variant.fontScale,
							...analysis,
							stable,
							error: null,
						});
						console.log(
							`  ${referenceName(screen, variant).padEnd(44)} interactive ${analysis.interactive} (reach ${reachPct(analysis)}, clipped ${analysis.clipped}), unreachable ${analysis.unreachable}, unlabeled ${analysis.unlabeled}, not actionable ${analysis.notActionable}, order ${analysis.orderViolations}, title ${analysis.titleFirst === null ? "-" : analysis.titleFirst ? "first" : "NOT first"}, leaks ${analysis.focusLeaks}${stable ? "" : ", tree NOT settled"} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
						);
					} catch (error) {
						if (deviceGone(error)) throw error;
						const message = error instanceof Error ? error.message : String(error);
						results.push(emptyResult(screen, variant, message));
						console.log(`  error    ${referenceName(screen, variant)}: ${message.slice(0, 160)}`);
					}
				}
			}
		});
	} catch (error) {
		if (!deviceGone(error)) throw error;
		aborted = error instanceof Error ? error.message : String(error);
		console.log(`stopped: ${aborted.slice(0, 200)}`);
	}

	const file: A11yFile = {
		schema: 1,
		kind: "a11y",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		oracle,
		matrixSize: matrix(cases, layoutVariants).length,
		screens: results,
		notCovered: [...notCovered, ...notCoveredStates],
		aborted,
	};
	const name = await writeRun("a11y", serial, startedAt, file);
	const total = (pick: (screen: A11yScreenResult) => number) =>
		results.reduce((sum, screen) => sum + pick(screen), 0);
	console.log(
		`a11y: ${results.length} screens, ${total((s) => s.interactive)} interactive elements, ${total((s) => s.unreachable)} unreachable, ${total((s) => s.unlabeled)} unlabeled, ${total((s) => s.notActionable)} not actionable, ${total((s) => s.orderViolations)} order violations, ${results.filter((s) => s.titleFirst === false).length} titles not first, ${total((s) => s.focusLeaks)} focus leaks, ${results.filter((s) => s.error !== null).length} errors`,
	);
	console.log(`wrote qa/runs/${name}.json`);
}
