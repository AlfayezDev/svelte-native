import { readFile } from "node:fs/promises";
import type { ForeignBundle, ForeignCheck, ForeignFile, ForeignLaunch, ForeignPlace, ForeignSkip, BuildFile, Metrics, Platform } from "./types.ts";
import { loadGatesFile } from "./smoke.ts";

/**
 * The foreign run (`native-qa foreign`, SPEC.md, "Foreign views", "Device verification of the libraries"): the lab's `foreign-libraries` scenario
 * (each of the native-view libraries mounted inline, in a row of the windowed `List` and in a native sheet, with its checks), the launch after it
 * (`foreign-leftovers`: the capture files a dead process left), and the harness's own look at the release bundle. This file turns what they
 * logged into the metrics the `foreign.*` gates read: `foreign.<library>.failedChecks` (every failed check of the library, the places that never
 * opened, and the bundle checks), and the run's own health.
 */

/** What the capture checks leave for the next launch: two `tmpfile` results in each of the three places. */
export const leftoverFilesPerRun = 6;

/** The three places the lab mounts a library in, in the order it visits them. */
export const places: readonly ForeignPlace[] = ["inline", "row", "sheet"];

/** What `gates.json` pins for a platform: the libraries a run must report. */
export type ForeignPins = { libraries: readonly string[] };

export async function foreignPins(platform: Platform): Promise<ForeignPins> {
	const file = await loadGatesFile();
	return { libraries: file.foreign?.libraries[platform] ?? [] };
}

/**
 * The modules of each library's own JavaScript (its React components, its wrappers over `requireNativeComponent`), which the Svelte components of the lab
 * do not use and the bundle must not hold: the native view is mounted by name and the library's JavaScript half is ported (SPEC.md, "Native-view
 * libraries"). react-native-svg is the exception that proves how it is done: 17 files of `src/lib` that import no React are the library's own.
 * `react-native-blob-util` is react-native-pdf's file access and is reached as a TurboModule. The libraries are the package's own copies (`packages/expo-svelte/vendor/<name>/`, which an app turns on
 * with `libraries`), so a module is below `vendor/` as well as below `node_modules/`.
 */
export const libraryModules: Record<string, RegExp[]> = {
	image: [/\/(?:node_modules|vendor)\/expo-image\//],
	blur: [/\/(?:node_modules|vendor)\/expo-blur\//],
	// The library's own blur needs no package, and no other blur library's JavaScript is in the bundle either (expo-blur's belongs to `blur` above and fails that library alone: a bundle's module list says what the
	// app carries, not which section imported it). That the built-in blur's own wrapper does not reach expo-blur's is held where it can be told, in its imports (`importClosure`, `expoBlurReaches`).
	svelteblur: [/\/node_modules\/(?:@react-native-community\/blur|react-native-blur|@sbaiahmed1\/react-native-blur|react-native-blur-view|@react-native-masked-view\/masked-view)\//],
	gradient: [/\/(?:node_modules|vendor)\/expo-linear-gradient\//],
	video: [/\/(?:node_modules|vendor)\/react-native-video\//],
	datetime: [/\/(?:node_modules|vendor)\/@react-native-community\/datetimepicker\//],
	lottie: [/\/(?:node_modules|vendor)\/lottie-react-native\//],
	pdf: [/\/(?:node_modules|vendor)\/react-native-pdf\//, /\/(?:node_modules|vendor)\/react-native-blob-util\//],
	capture: [/\/(?:node_modules|vendor)\/react-native-view-shot\//],
	rive: [/\/(?:node_modules|vendor)\/rive-react-native\//],
	conic: [/\/(?:node_modules|vendor)\/expo-conic-gradient\//],
	shadow: [/\/(?:node_modules|vendor)\/react-native-fast-shadow\//],
	text: [/\/(?:node_modules|vendor)\/react-native-animateable-text\//],
	svg: [/\/(?:node_modules|vendor)\/react-native-svg\/(?!src\/lib\/)/],
};

/**
 * What the files of the built-in blur's wrapper (`BlurView.svelte`) reach by their value imports, following the library's own relative imports: the paths of the files and the names of the packages. A type-only
 * import is erased and reaches nothing. [read] gives a file's text or undefined for one that does not exist, so a test can hand it a file map.
 */
export function importClosure(entry: string, read: (path: string) => string | undefined): { files: string[]; packages: string[] } {
	const files = new Set<string>();
	const packages = new Set<string>();
	const pending = [entry];
	while (pending.length > 0) {
		const path = pending.pop() as string;
		if (files.has(path)) continue;
		const text = read(path);
		if (text === undefined) continue;
		files.add(path);
		for (const match of text.matchAll(/^[ \t]*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
			const specifier = match[1] as string;
			if (!specifier.startsWith(".")) packages.add(specifier);
			else pending.push(resolvePath(dirnameOf(path), specifier));
		}
	}
	return { files: [...files].sort(), packages: [...packages].sort() };
}
const dirnameOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const resolvePath = (directory: string, relative: string): string => {
	const parts = directory.split("/");
	for (const part of relative.split("/")) {
		if (part === "..") parts.pop();
		else if (part !== ".") parts.push(part);
	}
	return parts.join("/");
};

/** What the built-in blur's wrapper must not reach: expo-blur's wrapper components and their view config in the library, and the package. */
export const expoBlurReaches: readonly RegExp[] = [/\/ExpoBlurView\.svelte$/, /\/BlurTargetView\.svelte$/, /\/foreign-blur\.ts$/, /^expo-blur(?:\/|$)/];

const reactFile = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|react-reconciler|scheduler|react-is)\//;

/** What a bundle's source list holds of the libraries and of React. */
export function analyseSources(sources: readonly string[]): Pick<ForeignBundle, "reactFiles" | "forbidden"> {
	const forbidden: ForeignBundle["forbidden"] = [];
	for (const source of sources)
		for (const [library, patterns] of Object.entries(libraryModules))
			if (patterns.some((pattern) => pattern.test(source))) forbidden.push({ library, module: source });
	return { reactFiles: sources.filter((source) => reactFile.test(source)), forbidden };
}

/** The bundle a source map describes: its sources analysed. */
export async function bundleOfMap(path: string): Promise<Omit<ForeignBundle, "matchesBuild">> {
	const map = JSON.parse(await readFile(path, "utf8")) as { sources?: string[] };
	const sources = map.sources ?? [];
	return { map: path, sources: sources.length, ...analyseSources(sources) };
}

/** The bundle of the build the run measured: its source map's sources analysed, when the map belongs to the installed APK. */
export async function readBundle(app: ForeignFile["app"], builds: Record<string, BuildFile>): Promise<ForeignBundle | null> {
	const build = Object.values(builds).find((entry) => entry.variant !== "smoke" && entry.apk.sha256 === app.installedSha256 && entry.sourceMap);
	if (!build?.sourceMap) return null;
	return { ...(await bundleOfMap(build.sourceMap.path)), matchesBuild: true };
}

/** The harness's own checks of the release bundle, one set per library: the library's JavaScript half is not in it. */
export function bundleChecks(bundle: ForeignBundle | null, libraries: readonly string[]): ForeignCheck[] {
	return libraries.map((library) => {
		if (!bundle?.matchesBuild) return { library, where: "bundle", name: "the release bundle of the installed build was read (a build of native-qa, its source map)", passed: false, detail: "no source map belongs to the installed build" };
		const held = bundle.forbidden.filter((entry) => entry.library === library).map((entry) => entry.module);
		return { library, where: "bundle", name: "React stays out: none of the library's own JavaScript modules is in the release bundle", passed: held.length === 0, detail: held.length === 0 ? `${bundle.sources} sources checked` : held.slice(0, 3).join(", ") };
	});
}

/** The checks of a library the lab logged (the bundle's are the harness's, `bundleChecks`). */
export const checksOf = (file: Pick<ForeignFile, "checks">, library: string): ForeignCheck[] => file.checks.filter((entry) => entry.library === library);

/** The places of a library no check came from: a run that died, or a page that never opened, leaves holes that are failures. */
export function missingPlaces(file: Pick<ForeignFile, "checks">, library: string): ForeignPlace[] {
	const seen = new Set(checksOf(file, library).map((entry) => entry.where));
	return places.filter((place) => !seen.has(place));
}

/** Failed checks of a library: its own failures, the places never visited, and the bundle checks; null when the run reported nothing of it. */
export function failedChecks(file: ForeignFile, library: string): number | null {
	const own = checksOf(file, library);
	if (own.length === 0) return null;
	const bundle = bundleChecks(file.bundle, [library]);
	return own.filter((entry) => !entry.passed).length + missingPlaces(file, library).length + bundle.filter((entry) => !entry.passed).length;
}

const fatalsOf = (launches: readonly ForeignLaunch[]) => launches.reduce((sum, launch) => sum + launch.crashes.length + launch.jsErrors.length + (launch.interrupted ? 1 : 0), 0);

/**
 * What the gates read of a run. `foreign.<library>.failedChecks` for each pinned library (null when it reported nothing); `.checks`, `.skipped` and `.androidOnly`
 * are counts (null for a library `--only` left out; `.skipped` leaves out the checks that exist on Android only, which `.androidOnly` counts). `foreign.launches` is the complete launches (two: the checks and the leftovers), `foreign.incompleteLaunches` the others,
 * `foreign.fatals` the crashes and JavaScript errors of both, `foreign.leftovers.failed` the leftover launch's failures (null when it did not run), and
 * `foreign.libraries.missing` the libraries the run was asked for (`--only` narrows them) that logged no check. `foreign.react.files` (files of `react` in the bundle, the app's other
 * dependencies bring them) is reported, not gated.
 */
export function foreignMetrics(file: ForeignFile, pins: ForeignPins): Metrics {
	const metrics: Metrics = {};
	// `--only` leaves libraries out: theirs is not measured (null), not a count of zero that would fail a minimum.
	const asked = (library: string) => file.asked.includes(library);
	for (const library of pins.libraries) {
		metrics[`foreign.${library}.failedChecks`] = failedChecks(file, library);
		metrics[`foreign.${library}.checks`] = asked(library) ? checksOf(file, library).length : null;
		metrics[`foreign.${library}.skipped`] = asked(library) ? file.skips.filter((entry) => entry.library === library && !entry.androidOnly).length : null;
		metrics[`foreign.${library}.androidOnly`] = asked(library) ? file.skips.filter((entry) => entry.library === library && entry.androidOnly).length : null;
	}
	const leftoverLaunch = file.launches.find((launch) => launch.name === "leftovers");
	metrics["foreign.libraries"] = pins.libraries.length;
	metrics["foreign.libraries.missing"] = pins.libraries.filter((library) => asked(library) && checksOf(file, library).length === 0).length;
	metrics["foreign.launches"] = file.launches.filter((launch) => launch.complete).length;
	metrics["foreign.incompleteLaunches"] = file.launches.filter((launch) => !launch.complete).length;
	metrics["foreign.fatals"] = fatalsOf(file.launches);
	metrics["foreign.engineWarnings"] = file.launches.reduce((sum, launch) => sum + launch.engineWarnings.length, 0);
	metrics["foreign.leftovers.failed"] = leftoverLaunch?.complete ? file.leftovers.filter((entry) => !entry.passed).length + (file.leftovers.length === 0 ? 1 : 0) : null;
	metrics["foreign.react.files"] = file.bundle?.reactFiles.length ?? null;
	metrics["foreign.unparsedLines"] = (file.unparsed?.length ?? 0) + file.launches.reduce((sum, launch) => sum + (launch.unparsedLines?.length ?? 0), 0);
	return metrics;
}

/** The lines `foreign` prints for a run: one per library, then every failed check and the run's own trouble. */
export function describeForeign(file: ForeignFile, pins: ForeignPins): string[] {
	const lines: string[] = [];
	for (const library of pins.libraries) {
		const own = checksOf(file, library);
		const failed = failedChecks(file, library);
		const mine = file.skips.filter((entry) => entry.library === library);
		lines.push(`  ${library.padEnd(9)} ${failed === null ? "no checks" : `${own.length} checks, ${failed} failed`}, ${mine.filter((entry) => !entry.androidOnly).length} skipped, ${mine.filter((entry) => entry.androidOnly).length} Android-only${missingPlaces(file, library).length ? `, never opened: ${missingPlaces(file, library).join(", ")}` : ""}`);
	}
	for (const entry of [...file.checks, ...bundleChecks(file.bundle, pins.libraries), ...file.leftovers].filter((check) => !check.passed))
		lines.push(`  FAIL ${entry.library} ${entry.where}: ${entry.name}${entry.detail ? ` (${entry.detail.slice(0, 160)})` : ""}`);
	for (const line of (file.unparsed ?? []).slice(0, 5)) lines.push(`  UNREADABLE LINE ${line.slice(0, 160)}`);
	for (const launch of file.launches) {
		lines.push(`  ${launch.name}: complete ${launch.complete} in ${(launch.durationMs / 1000).toFixed(0)} s, fatals ${launch.crashes.length + launch.jsErrors.length}, engine warnings ${launch.engineWarnings.length}`);
		if (launch.interrupted) lines.push(`  interrupted by ${launch.interrupted.by} at ${launch.interrupted.at} (device clock)`);
		for (const unreadable of (launch.unparsedLines ?? []).slice(0, 3)) lines.push(`  UNREADABLE LINE ${unreadable.slice(0, 400)}`);
		for (const fault of [...launch.crashes, ...launch.jsErrors].slice(0, 3)) lines.push(`  fatal: ${fault.slice(0, 200)}`);
	}
	return lines;
}

/** The skipped checks of a run, by library: what the platform could not check yet. The checks that exist on Android only are `androidOnlyBy`'s. */
export function skippedBy(skips: readonly ForeignSkip[]): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const skip of skips) if (!skip.androidOnly) (out[skip.library] ??= []).push(skip.name);
	return out;
}

/** The checks of a run that exist on Android only, by library: not a hole of the platform that reports them. */
export function androidOnlyBy(skips: readonly ForeignSkip[]): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const skip of skips) if (skip.androidOnly) (out[skip.library] ??= []).push(skip.name);
	return out;
}
