import {
	cases,
	layoutVariants,
	localize,
	matrix,
	notCovered,
	variants,
	type Localized,
	type NotCovered,
	type ScreenCase,
	type Variant,
} from "../screens.ts";
import type { Direction } from "../device.ts";

/**
 * The screens and variants of the iOS suites: the Android matrix (`lib/screens.ts`) where an iOS app can reach and vary it.
 * Nothing outside the process can steer an iOS app, so the lab drives itself (`lib/native/dev/capture.ts`) and what it cannot
 * do from inside is left out, with the reason in the run file.
 */

/** Screens that need the app's network to be held back or refused: an iOS app cannot be told to see a proxy from outside. */
const needsNetworkControl = new Set(["startup-loading", "startup-error"]);

export const iosCases: ScreenCase[] = cases.filter((screen) => !needsNetworkControl.has(screen.id) && !screen.signedIn);

/** Theme x direction at the standard text size: the app cannot change the system's text size from inside. */
export const iosVariants: Variant[] = variants.filter((variant) => variant.fontScale === 1);
export const iosLayoutVariants: Variant[] = layoutVariants.filter((variant) => variant.fontScale === 1);

export const iosNotCovered: NotCovered[] = [
	...notCovered,
	{
		route: "/ (platform configuration pending), / (platform configuration unreachable)",
		reason:
			"the startup screen's loading and error states need the app's HTTP to hang or be refused; on Android the harness routes it through a proxy it controls, and an iOS app cannot be pointed at one from outside (the proxy is a system setting of the phone)",
	},
	{
		route: "the signed-in screens (the `app-*` cases: /workspaces, /workspaces/create, the workspace's home and settings, the account modal and its change-email modal)",
		reason:
			"the signed-in phase signs in as the QA account by typing into the login screen over adb (`lib/signin.ts`); the iPhone's lab drives itself from inside and has no way to type the account in yet, so it runs the signed-out screens only until its references are scheduled",
	},
	{
		route: "every screen at the largest text size",
		reason:
			"Dynamic Type is a setting of the phone that only the Settings app changes; the harness does not change settings of the phone, and the lab cannot override it from inside",
	},
];

/**
 * Controls the iPhone SE's 667 pt screen leaves below the fold, inside the scroll view that holds them, which the Android matrix
 * does not list (its screen is taller): the accessibility check counts a control outside the screen as clipped only when it is
 * declared here or in `scrolled` and sits in a scroll view, and as unreachable otherwise.
 */
export const iosBelowTheFold: Record<string, string[]> = {
	"dev-rows": ["Draft a", "Draft b", "Draft keyed", "Tap keyed"],
	"dev-animation": ["Verify UI thread · block JS for 1 second"],
	"screens-header": ["Push screen 2"],
	"screens-tabs": ["Push on this tab", "Open a sheet on the root stack"],
	"screens-modal": ["Push screen 2"],
};

/** The labels an iOS screen exposes for the controls the Android matrix names: the back button of a pushed screen reads "Back" (the title of the screen below when it has one), the search field its placeholder. */
const iosLabels: Record<string, string> = { "Navigate up": "Back", Search: "Search people" };

export function iosControl(label: Localized, direction: Direction): string {
	const text = localize(label, direction);
	return iosLabels[text] ?? text;
}

/** The screen's title as a heading: the part before the subtitle the Android label appends (`Screen 1, Native header`). */
export function iosTitle(screen: ScreenCase, direction: Direction): string | null {
	if (screen.title === null) return null;
	return localize(screen.title, direction).split(", ")[0] ?? null;
}

export const iosMatrix = (screens: ScreenCase[], chosen: Variant[]) => matrix(screens, chosen);
