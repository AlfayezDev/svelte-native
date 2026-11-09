import { productApplicationId } from "../../src/lib/native/app-ids.ts";
import { findFaults, parseLines } from "../parse/logcat.ts";
import { copy } from "./copy.ts";
import type { AppInfo, DeviceInfo, Metrics, Source } from "./types.ts";
import { findByLabel, type UiTree } from "./uia.ts";

/**
 * The product boot check (`native-qa product`): the example's production variant (`io.example.sveltenative.qaproduct`, built with `APP_VARIANT=production`, no
 * development lab) is installed on the OVH emulator with its data cleared and started cold. It passes when, within `windowMs` of the start, it
 * reached its first screen, the example's home screen, and logcat shows no JavaScript fatal and no native crash of the app.
 *
 * It exists because nothing else starts the production variant: the QA app has the lab, whose directories the production variant's Metro
 * replaces with a stub that throws on any read, so a use of the lab that is not behind the flag passes every gate of the QA app and crashes the
 * root layout of the production variant.
 */
export const productPackage = productApplicationId;
export const productWindowMs = 15_000;

export type ProductFile = {
	schema: 1;
	kind: "product";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** How long after the start the app had to reach its first screen, and was watched for faults. */
	windowMs: number;
	/** The home screen was seen in the accessibility tree of the app's window, and when (ms after the start was issued). */
	firstScreen: { reached: boolean; atMs: number | null };
	/** The app's process was still there when the window ended. */
	alive: boolean;
	/** JavaScript fatals and native crashes of the app in logcat, and a process that was gone at the end. */
	fatals: string[];
	/** `console.error` lines of the app (`E ReactNativeJS`): recorded, not judged. */
	jsErrorCount: number;
	/** `am start -W` reported the activity displayed after this many ms, when it said. */
	launchMs: number | null;
	durationMs: number;
	logFile: string;
};

/** The texts of the example's home screen in both languages of the app: its title and its one line of description (`src/routes/+mobile.svelte`). */
export function homeLabels(): string[] {
	const texts = [copy("home.title"), copy("home.description")];
	return [...new Set(texts.flatMap((text) => (typeof text === "string" ? [text] : [text.en, text.ar])))];
}

/** Whether the tree is the home screen: a node of the app's own window that says what the home says. */
export function isHomeScreen(tree: UiTree, packageName: string = productPackage): boolean {
	return homeLabels().some((label) => findByLabel(tree, label).some((node) => node.packageName === packageName));
}

/**
 * The fatals of one start, from its logcat (`logcat -d -v threadtime` after `logcat -c`): what `findFaults` reads as a crash of the
 * package (`FATAL EXCEPTION`, a fatal signal, an ANR, a JavaScript fatal), the native crash report debuggerd writes about it (counted when no
 * fatal signal line came with it), and a process that was not there when the window ended.
 */
export function productFatals(logcat: string, alive: boolean, packageName: string = productPackage): { fatals: string[]; jsErrors: number } {
	const faults = findFaults(logcat, packageName);
	const fatals = [...faults.crashes];
	const report = parseLines(logcat).find((line) => line.tag === "DEBUG" && line.message.includes(`>>> ${packageName} <<<`));
	if (report && !fatals.some((fatal) => fatal.startsWith("Fatal signal"))) fatals.push(`native crash report: ${report.message}`);
	if (!alive) fatals.push(`the process of ${packageName} was gone when the window ended`);
	return { fatals, jsErrors: faults.jsErrors.length };
}

/** `Displayed io.example.sveltenative.qaproduct/.MainActivity` ... `TotalTime: 1234` of `am start -W`. */
export function parseLaunchMs(output: string): number | null {
	const total = /TotalTime:\s*(\d+)/.exec(output)?.[1];
	return total === undefined ? null : Number(total);
}

export function productMetrics(file: ProductFile): Metrics {
	return {
		"product.boot.fatals": file.fatals.length,
		// Whatever window the run was made with, the bar is the 15 s of the check.
		"product.boot.firstScreen": file.firstScreen.reached && (file.firstScreen.atMs ?? Infinity) <= productWindowMs ? 1 : 0,
		"product.boot.firstScreenMs": file.firstScreen.atMs,
		"product.boot.jsErrors": file.jsErrorCount,
	};
}

/** Why the start failed the check, one line each; empty: it passed. The verdict `gates` gives for the same run is `product.boot.*`. */
export function productProblems(file: ProductFile): string[] {
	const problems = file.fatals.map((fatal) => `fatal: ${fatal.slice(0, 240)}`);
	if (!file.firstScreen.reached) problems.push(`the home screen was not reached within ${file.windowMs / 1000} s`);
	return problems;
}

export function describeProduct(file: ProductFile): string[] {
	const first = file.firstScreen.reached ? `reached after ${file.firstScreen.atMs} ms` : `not reached within ${file.windowMs / 1000} s`;
	return [
		`product ${file.app.package} ${file.app.versionName}: home screen ${first}${file.launchMs === null ? "" : `, activity displayed after ${file.launchMs} ms`}, ${file.fatals.length} fatal(s), ${file.jsErrorCount} JavaScript error line(s) (not judged), process ${file.alive ? "alive" : "gone"} at the end`,
	];
}
