import { fullIosPlanSize } from "./iphone/resilience.ts";
import { fullPlanSize } from "./resilience.ts";
import { cases as screenCases, layoutVariants, pinnedNames, variants } from "./screens.ts";
import type { A11yFile, Metrics, ParityFile, ResilienceFile, SignedInRecord } from "./types.ts";

const largest = (numbers: number[]) => Math.max(...numbers);
const sum = (numbers: number[]) => numbers.reduce((total, value) => total + value, 0);

const signedInScreens = new Set(screenCases.filter((screen) => screen.signedIn).map((screen) => screen.id));
const screenOf = (entry: { name: string; screen?: string }): string => entry.screen ?? entry.name.split("--")[0] ?? "";

/**
 * D12: the signed-in phase covers the Rasheed app's account screens, not the library, so a phase that never started (no QA account, or the
 * sign-in was refused: `signedIn` false in its record) does not hold the run incomplete. True when the phase's cases were skipped for that
 * reason; a phase that did sign in, and every signed-out case, count as they always did.
 */
const phaseNeverEntered = (phase: SignedInRecord | null | undefined): boolean => phase?.signedIn === false;

/**
 * Screenshot parity. Only a comparison against a frozen reference is a measurement: a case that was missing its reference,
 * unstable, errored, skipped or not run is not one, and `parity.casesIncomplete` counts it against the whole matrix. A run
 * that rewrote the references (`--update`) verified nothing and yields no metrics at all, so it cannot satisfy a gate.
 */
export function parityMetrics(file: ParityFile, signedIn: readonly string[] = []): Metrics {
	if (file.mode === "update") return {};
	const compared = file.cases.filter(
		(entry) => entry.verdict === "pass" || entry.verdict === "fail",
	);
	const comparedNames = new Set(compared.map((entry) => entry.name));
	const pinned = pinnedNames(signedIn, variants);
	const pixels = (entry: (typeof compared)[number]) => entry.differingPixels ?? 0;
	// Signed-in cases the run recorded as skipped because its signed-in phase never started: left out of what is incomplete, and counted here.
	const skippedSignedIn = phaseNeverEntered(file.signedInPhase) ? file.cases.filter((entry) => entry.verdict === "skipped" && signedInScreens.has(screenOf(entry))).length : 0;
	return {
		"parity.cases": compared.length,
		"parity.casesExpected": file.matrixSize,
		"parity.casesIncomplete": Math.max(0, file.matrixSize - compared.length - skippedSignedIn),
		"parity.signedIn.skipped": skippedSignedIn,
		"parity.casesDiffering": compared.filter((entry) => entry.verdict === "fail").length,
		"parity.casesSkipped": file.cases.filter((entry) => entry.verdict === "skipped").length,
		// Cases the emulator ran more than once (a failed wait or dump, retried): whatever their verdict, a retry is never silent. Informational.
		"parity.casesRetried": file.cases.filter((entry) => (entry.tries ?? 1) > 1).length,
		"parity.diffPixelsOutsideMasks": compared.length ? largest(compared.map(pixels)) : null,
		"parity.maskedPct": compared.length
			? largest(compared.map((entry) => ((entry.maskedPixels ?? 0) / file.screenPixels) * 100))
			: null,
		"parity.routesNotCovered": file.notCovered.length,
		// The pinned signed-in screens (gates.json `signedIn`) in every variant: the ones the run did not compare. Absent without a pin.
		...(signedIn.length === 0
			? {}
			: {
					"parity.signedIn.expected": pinned.length,
					"parity.signedIn.missing": pinned.filter((name) => !comparedNames.has(name)).length,
				}),
	};
}

/** The accessibility checklist, summed over every screen that could be dumped; a screen that could not is incomplete. */
export function a11yMetrics(file: A11yFile, signedIn: readonly string[] = []): Metrics {
	const measured = file.screens.filter((screen) => screen.error === null);
	const measuredNames = new Set(measured.map((screen) => screen.name));
	const pinned = pinnedNames(signedIn, layoutVariants);
	const skippedSignedIn = phaseNeverEntered(file.signedInPhase) ? file.screens.filter((screen) => screen.error !== null && signedInScreens.has(screenOf(screen))).length : 0;
	const total = (pick: (screen: (typeof measured)[number]) => number) => sum(measured.map(pick));
	const interactive = total((screen) => screen.interactive);
	const pct = (count: number) => (interactive === 0 ? null : (count / interactive) * 100);
	return {
		"a11y.screens": measured.length,
		"a11y.screensExpected": file.matrixSize,
		"a11y.screensIncomplete": Math.max(0, file.matrixSize - measured.length - skippedSignedIn),
		"a11y.signedIn.skipped": skippedSignedIn,
		// Screens the emulator ran more than once (a failed launch, retried), measured or not. Informational.
		"a11y.screensRetried": file.screens.filter((screen) => (screen.attempts ?? 1) > 1).length,
		"a11y.interactive": interactive,
		"a11y.unreachable": total((screen) => screen.unreachable),
		"a11y.unlabeled": total((screen) => screen.unlabeled),
		"a11y.notActionable": total((screen) => screen.notActionable),
		"a11y.smallTargets": total((screen) => screen.smallTargets ?? 0),
		"a11y.stateMismatches": total((screen) => screen.stateMismatches ?? 0),
		"a11y.orderViolations": total((screen) => screen.orderViolations),
		"a11y.titleNotFirst": measured.filter((screen) => screen.titleFirst === false).length,
		"a11y.focusLeaks": total((screen) => screen.focusLeaks),
		"a11y.reachablePct": pct(total((screen) => screen.reachable)),
		"a11y.labeledPct": pct(total((screen) => screen.labeled)),
		"a11y.actionablePct": pct(total((screen) => screen.actionable)),
		...(signedIn.length === 0
			? {}
			: {
					"a11y.signedIn.expected": pinned.length,
					"a11y.signedIn.missing": pinned.filter((name) => !measuredNames.has(name)).length,
				}),
	};
}

/**
 * The resilience loop: steps run, steps that failed a check, steps the device could not perform (`skipped`: neither a pass nor a failure, and
 * gated on its own so a plan cannot shrink unnoticed), steps of the platform's full plan that were never run (the iPhone's plan is its own), and
 * whether the run was a diagnostic that bypassed the system's say in the iOS restore (no evidence for the product).
 */
export function resilienceMetrics(file: ResilienceFile): Metrics {
	const full = file.device.platform === "ios" ? fullIosPlanSize : fullPlanSize;
	return {
		"resilience.steps": file.steps.length,
		"resilience.failures": file.steps.filter((step) => !step.ok).length,
		"resilience.skipped": file.steps.filter((step) => step.skipped !== undefined).length,
		"resilience.stepsMissing": Math.max(0, full - file.steps.length),
		"resilience.gateBypassed": file.assumeSystemKill === true ? 1 : 0,
	};
}

export type SuiteFiles = {
	parity: ParityFile | null;
	a11y: A11yFile | null;
	resilience: ResilienceFile | null;
};

export function suiteMetrics(files: SuiteFiles, signedIn: readonly string[] = []): Metrics {
	return {
		...(files.parity ? parityMetrics(files.parity, signedIn) : {}),
		...(files.a11y ? a11yMetrics(files.a11y, signedIn) : {}),
		...(files.resilience ? resilienceMetrics(files.resilience) : {}),
	};
}
