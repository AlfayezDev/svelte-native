import type { AppInfo, BuildIdentity, BuildRecord } from "../types.ts";

/**
 * The build the app reports of itself (`build` in `lab-results.json`, `boot-report.json` and `capture/index.json`) against the
 * build record `native-qa build --platform ios` wrote: what is on the phone is what the run is meant to measure, or the run fails.
 */

const short = (digest: string): string => digest.slice(0, 12);

/** The app on the phone is not the build the run is meant to measure: the run ends, and writes nothing a gate could read. */
export class IdentityMismatch extends Error {}

/** Why the reported build is not the recorded one, or null. The executable digest is compared when the record has one. */
export function identityMismatch(reported: BuildIdentity, build: BuildRecord): string | null {
	const differences: string[] = [];
	if (reported.jsbundleSha256 !== build.jsbundleSha256)
		differences.push(`main.jsbundle ${short(reported.jsbundleSha256)} on the phone, ${short(build.jsbundleSha256)} in the build record`);
	if (build.cdHash !== null && reported.cdHash !== build.cdHash)
		differences.push(`executable ${short(reported.cdHash)} on the phone, ${short(build.cdHash)} in the build record`);
	return differences.length === 0 ? null : `the app on the phone is not the recorded build (qa/out/ios-build.json): ${differences.join("; ")}`;
}

/** What one run's files reported: one identity if they all say the same, null if none says anything; a mixture or a change is an error. */
export function reportedIdentity(reports: (BuildIdentity | null)[], build: BuildRecord | null, what: string): BuildIdentity | null {
	const reported = reports.filter((identity): identity is BuildIdentity => identity !== null);
	const first = reported[0];
	if (!first) return null;
	if (reported.length < reports.length) throw new IdentityMismatch(`${what}: the app reported its build in ${reported.length} of ${reports.length} files, and not in the others`);
	if (reported.some((identity) => identity.jsbundleSha256 !== first.jsbundleSha256 || identity.cdHash !== first.cdHash))
		throw new IdentityMismatch(`${what}: the app's reported build changed during the run`);
	const mismatch = build ? identityMismatch(first, build) : null;
	if (mismatch) throw new IdentityMismatch(`${what}: ${mismatch}`);
	return first;
}

/** The app of a run file with what the app reported: `installedSha256` is the executable digest, null when it reported none. */
export function withIdentity(app: AppInfo, installed: BuildIdentity | null): AppInfo {
	return { ...app, installed, installedSha256: installed?.cdHash ?? null };
}

export const notReported = "build identity not reported by the app (an older build): the run file records installed: null";
