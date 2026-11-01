import type { DeviceSession } from "./device.ts";
import { endsRun } from "./device.ts";
import { enterSignedIn, ensureSignedOut, leaveSignedIn, type AccountFacts } from "./signin.ts";
import type { ScreenCase } from "./screens.ts";
import type { SignedInRecord } from "./types.ts";
import { redact } from "./qa-account.ts";

/** The cases of the signed-out phase and of the signed-in phase, each in the order the matrix lists them. */
export function splitPhases(chosen: ScreenCase[]): { signedOut: ScreenCase[]; signedIn: ScreenCase[] } {
	return { signedOut: chosen.filter((screen) => !screen.signedIn), signedIn: chosen.filter((screen) => screen.signedIn) };
}

/**
 * Before the signed-out cases: a session an earlier run left (a killed run, a device used by hand) would make the login screen
 * show the workspaces, so the device is signed out first. Only the login case cares, and only a reachable backend can tell: anything
 * that goes wrong here is said and left to the case that depends on it. Returns what to tell the run file, if anything.
 */
export async function startSignedOut(
	session: DeviceSession,
	backend: { ok: boolean },
	signedOut: ScreenCase[],
	log: (message: string) => void = console.log,
): Promise<void> {
	if (!backend.ok || !signedOut.some((screen) => screen.needsBackend)) return;
	try {
		await session.theme("light");
		await session.fontScale(1);
		await session.direction("ltr");
		if (await ensureSignedOut(session)) log("  an earlier session was still signed in: signed out");
	} catch (error) {
		if (endsRun(error)) throw error;
		log(`  could not check that the device is signed out: ${redact(error instanceof Error ? error.message : String(error)).slice(0, 160)}`);
	}
}

export type SignedInOutcome<T> =
	| { entered: false; record: SignedInRecord }
	| { entered: true; record: SignedInRecord; result: T };

/**
 * The signed-in phase around `body`: sign in once, run the body, sign out whatever the body did. `record` says what happened for the
 * run file (never the address). A device failure (`endsRun`) is thrown after the sign-out is tried; the phase's own failures are the
 * outcome.
 */
export async function inSignedInPhase<T>(
	session: DeviceSession,
	backend: { ok: boolean; detail: string },
	cases: number,
	body: (facts: AccountFacts) => Promise<T>,
): Promise<SignedInOutcome<T>> {
	const entered = await enterSignedIn(session, backend);
	if (!entered.ok) return { entered: false, record: { cases, signedIn: false, signedOut: null, detail: entered.reason } };
	let result: T;
	try {
		result = await body(entered.facts);
	} catch (error) {
		await leaveSignedIn(session).catch(() => undefined);
		throw error;
	}
	const left = await leaveSignedIn(session);
	return {
		entered: true,
		result,
		record: {
			cases,
			signedIn: true,
			signedOut: left === null,
			detail: left ?? (entered.facts.workspaces ? null : "the QA account has no workspace: the screens that open one cannot be reached"),
		},
	};
}
