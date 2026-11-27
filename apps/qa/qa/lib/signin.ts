import { amStartCommand } from "./adb.ts";
import { findNode } from "./drive.ts";
import { dumpUi, endsRun, key, tap, type DeviceSession } from "./device.ts";
import { shellQuote } from "./exec.ts";
import { accountEmail, codeVariable, configuredCode, developmentCode, placeholder, qaCode, redact, requireAccount, variable } from "./qa-account.ts";
import type { Selector } from "./screens.ts";
import { center } from "./uia.ts";
import { sleep } from "./wait.ts";

/**
 * The signed-in phase of `parity` and `a11y`: sign in as the QA account the way a user does (the email, the request for a code, the
 * development backend's code), once per run; run the signed-in cases under that session; sign out. The session lives in the app's
 * SecureStore (the device token the server bound to the account), so it survives the `am force-stop` every case starts with, and
 * `signOut` is the reducer a user's "Sign out" button calls, which is what ends the phase: the signed-out cases of the next run find the
 * login screen again.
 *
 * Everything here is typed into the real screens by `adb`: no hook in the app takes the address, so the product bundle (and the QA
 * app) carries nothing for it. The address goes to the device only as the argument of `input text`; any failure that could carry it
 * is redacted before it is thrown (`scrub`), and nothing here logs it.
 */

/**
 * The labels of the sign-in screens in English: the phase signs in and out with the device in the left-to-right language. They are the screens
 * of the product the phase was written for (an email address, a one-time code, then a list of workspaces); this repository's example has no
 * account and no case that signs in, so a project with another sign-in changes this table and `signIn` together.
 */
const labels = {
	email: "Email",
	code: "Login code",
	checkYourEmail: "Check your email",
	chooseWorkspace: "Choose a workspace",
	profile: "What’s your name?",
	signOut: "Sign out",
	noWorkspaces: "You have no workspaces. You can create one or delete your account below.",
	wrongCode: "Invalid login code",
	tooManyRequests: "Too many tries. Wait a moment, then try again.",
	tooManyAttempts: "No tries left for this code. Request a new one.",
	expired: "This code expired. Request a new one.",
};

const field: Selector = { className: "android.widget.EditText" };
const label = (text: string): Selector => ({ label: text });

/** Where the app opens a signed-out device and a signed-in one alike: the router sends the first to the login. */
export const startLink = "expo-svelte:///workspaces";

/** A failure of the phase that is the account's or the app's (not the device's); its text has been redacted. */
export class SignInError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignInError";
	}
}

/** The error with the address (and the text that was typed, whatever it was) taken out of its message. */
function scrub(error: unknown, typed: readonly string[] = []): Error {
	const failure = error instanceof Error ? error : new Error(String(error));
	const clean = new Error(redact(failure.message, typed));
	clean.name = failure.name;
	return clean;
}

/** One poll of the accessibility tree for the first selector that is on screen; null when none is. */
async function look(serial: string, wanted: readonly Selector[]): Promise<number | null> {
	const tree = await dumpUi(serial);
	for (const [index, selector] of wanted.entries()) if (findNode(tree, selector, "ltr")) return index;
	return null;
}

/** Waits for one of the selectors; its index. Throws a `SignInError` that says what was waited for. */
async function waitForOne(serial: string, wanted: readonly Selector[], what: string, timeoutMs: number): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await look(serial, wanted);
		if (found !== null) return found;
		if (Date.now() >= deadline) throw new SignInError(`${what} did not appear within ${timeoutMs} ms`);
		await sleep(500);
	}
}

async function tapSelector(serial: string, selector: Selector): Promise<void> {
	const node = findNode(await dumpUi(serial), selector, "ltr");
	if (!node) throw new SignInError("a control of the sign-in screens is not on screen");
	const { x, y } = center(node);
	await tap(serial, x, y);
}

/** Types into the focused field. The text is a shell word for `input text`; a failure is redacted (it would quote the command). */
async function typeInto(session: DeviceSession, text: string): Promise<void> {
	try {
		await session.run(session.serial, ["shell", `input text ${shellQuote(text.replaceAll(" ", "%s"))}`]);
	} catch (error) {
		throw scrub(error, [text, shellQuote(text)]);
	}
}

async function start(session: DeviceSession): Promise<void> {
	await session.networkMode("normal");
	await session.run(session.serial, ["shell", `am force-stop ${session.packageName}; sleep 0.3; ${amStartCommand(session.packageName, startLink)}`], { timeoutMs: 90_000 });
}

/** Signed in or out, as far as the first screen the app opens says: the login's text field, or a sign-out button. */
async function state(session: DeviceSession, timeoutMs: number): Promise<"out" | "in"> {
	const found = await waitForOne(session.serial, [field, label(labels.signOut)], "the login screen or a signed-in screen", timeoutMs);
	return found === 0 ? "out" : "in";
}

/** Ends a session the app has: the button a user presses. Leaves the app on the login. */
async function pressSignOut(session: DeviceSession): Promise<void> {
	await tapSelector(session.serial, label(labels.signOut));
	await waitForOne(session.serial, [field], "the login screen after signing out", 30_000);
}

/** Makes sure the device is signed out; true when a session was there. A session an earlier, interrupted run left is ended the same way. */
export async function ensureSignedOut(session: DeviceSession): Promise<boolean> {
	await start(session);
	if ((await state(session, 45_000)) === "out") return false;
	await pressSignOut(session);
	return true;
}

/**
 * Signs in as the QA account from the login screen, in English. The account must have a profile (the sign-in must not land on the
 * onboarding screen, which a reference run cannot leave without writing one) and the one-time code is the development backend's.
 */
export async function signIn(session: DeviceSession): Promise<void> {
	const email = requireAccount();
	const { serial } = session;
	try {
		await waitForOne(serial, [field], "the login screen", 45_000);
		await tapSelector(serial, field);
		await sleep(400);
		await typeInto(session, email);
		await key(serial, "KEYCODE_ENTER");
		const asked = await waitForOne(serial, [label(labels.checkYourEmail), label(labels.tooManyRequests)], "the screen that asks for the code", 40_000);
		if (asked === 1)
			throw new SignInError(`the backend refused to issue a code (${JSON.stringify(labels.tooManyRequests)}): a code was requested for the account in the last minutes; wait and run again`);
		await sleep(600);
		await tapSelector(serial, field);
		await sleep(400);
		const code = qaCode();
		await typeInto(session, code);
		await key(serial, "KEYCODE_ENTER");
		const landed = await waitForOne(
			serial,
			[label(labels.chooseWorkspace), label(labels.profile), label(labels.wrongCode), label(labels.tooManyAttempts), label(labels.expired)],
			"the first screen after signing in",
			60_000,
		);
		if (landed === 1)
			throw new SignInError(`signing in landed on the onboarding screen: the QA account has no profile yet, and the harness writes none (finish its profile once by hand)`);
		if (landed === 2)
			throw new SignInError(
				`the backend rejected the sign-in code (${JSON.stringify(labels.wrongCode)}): ${
					configuredCode() === null
						? `no ${codeVariable} is set, so the harness typed ${developmentCode}, which only a backend in development mode accepts; this one sends its codes by email. Configure the backend with a fixed code for the QA address and put that code in ${codeVariable}`
						: `the code in ${codeVariable} is not the one the backend was configured with for the QA address, or the address in ${variable} is not that address`
				}`,
			);
		if (landed > 2) throw new SignInError(`the backend refused the sign-in code (${JSON.stringify([labels.wrongCode, labels.tooManyAttempts, labels.expired][landed - 2])})`);
	} catch (error) {
		if (endsRun(error)) throw error;
		throw scrub(error, [email, qaCode()]);
	}
}

/** What the signed-in cases may assume of the account, read from its first screen. */
export type AccountFacts = { workspaces: boolean };

export async function readFacts(session: DeviceSession): Promise<AccountFacts> {
	const tree = await dumpUi(session.serial);
	return { workspaces: !findNode(tree, label(labels.noWorkspaces), "ltr") };
}

export type Entered = { ok: true; facts: AccountFacts } | { ok: false; reason: string };

/**
 * Starts the phase: the backend answers, the account is configured, the device is signed out, then signed in. The device is put in
 * English, the normal text size and the light theme for it. A failure that is not the device's is the phase's own (`ok: false` with the
 * reason, redacted): the suites record every signed-in case with it and go on to the report. The device's own failures are thrown.
 */
export async function enterSignedIn(session: DeviceSession, backend: { ok: boolean; detail: string }): Promise<Entered> {
	if (!backend.ok) return { ok: false, reason: `needs the dev backend: ${backend.detail}` };
	if (accountEmail() === null)
		return { ok: false, reason: `needs the QA account: ${variable} is set neither in the environment nor in .env.local` };
	try {
		await session.theme("light");
		await session.fontScale(1);
		await session.direction("ltr");
		await ensureSignedOut(session);
		await signIn(session);
		return { ok: true, facts: await readFacts(session) };
	} catch (error) {
		if (endsRun(error)) throw error;
		// Whatever was half done, the session must not outlive the phase: try to end it, and say so if that fails too.
		const left = await leaveSignedIn(session);
		const reason = redact(error instanceof Error ? error.message : String(error));
		return { ok: false, reason: `could not sign in as the QA account (${placeholder}): ${reason}${left === null ? "" : `; and then ${left}`}` };
	}
}

/** Ends the phase: signed out, the way a user does it. Null when it is done (or nothing was there), else why not (redacted). */
export async function leaveSignedIn(session: DeviceSession): Promise<string | null> {
	try {
		await session.fontScale(1);
		await session.direction("ltr");
		await ensureSignedOut(session);
		await session.run(session.serial, ["shell", "rm -f /sdcard/native-qa-dump.xml"]);
		return null;
	} catch (error) {
		if (endsRun(error)) throw error;
		return `could not sign out: ${redact(error instanceof Error ? error.message : String(error))}`;
	}
}
