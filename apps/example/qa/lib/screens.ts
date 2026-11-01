import type { Direction, NetworkMode, Theme } from "./device.ts";

/**
 * The screens the suites drive and the settings they drive them under. A screen is a route in one state; the parity suite
 * takes each in every variant, the accessibility suite in the layout-affecting ones. Everything here is reachable without
 * a signed-in session; the routes that are not are listed in `notCovered`, each with its reason.
 */

/** Text that differs by language: the text for the app in English and in Arabic. */
export type Localized = string | { en: string; ar: string };

/** A node of the accessibility tree: by its text or content description, by its class, or both. */
export type Selector = { label?: Localized; className?: string };

/**
 * `open` is a link opened into the running app (`am start` of a deep link without stopping it): the router treats it as a
 * plain goto, so it pushes the screen onto the stack the launch link made. `tap` pushes from a screen's own button.
 */
export type Step =
	| { wait: Selector; timeoutMs?: number }
	| { tap: Selector }
	| { open: string }
	| { pause: number };

/** How the screen's chrome is built, which decides the reading order the accessibility suite expects. */
export type Layout = "page" | "header" | "sheet" | "tabs" | "modal";

export type ScreenCase = {
	id: string;
	/** The route in the app's own terms, for the report. */
	route: string;
	state: "ready" | "loading" | "error";
	/**
	 * A deep link opened with `am start`; null starts the launcher activity (the startup screen). The router makes the launch link
	 * the base of the stack (no back arrow), so a screen the lab pushes from another is reached with that other screen as the
	 * link and a step that pushes it: a tap on the menu's button, or an `open` of the screen's own link where the menu has none.
	 */
	deepLink: string | null;
	/** What the app's network sees while the screen is open. */
	network: NetworkMode;
	/** True when the screen only exists while the dev backend answers; an unreachable backend skips the case, it does not fail it. */
	needsBackend: boolean;
	/** Taps and waits after the launch, in order. */
	steps: Step[];
	/** What must be on screen when the case is ready (the anchor the resilience suite also looks for). */
	anchor: Selector;
	/** The screen's title, expected first in the reading order after the bar's back button and left slot; null where the screen has none. */
	title: Localized | null;
	layout: Layout;
	/** Controls the screen's source declares, each of which the accessibility tree must expose by this label. They sit in the first screen of the content at every text size. */
	controls: Localized[];
	/** Controls further down the page, which the largest text pushes below the fold: checked when the tree has them, never reported missing. */
	scrolled: Localized[];
	/** Labels of the screen underneath, which must be out of the accessibility tree while this sheet or modal is up. */
	hidden: Localized[];
	/** False when the state cannot be reached at the largest text size (see `notCoveredStates`): the screen is left out of those variants. */
	largestText: boolean;
	/** Nodes whose area is masked because they move on their own (spinners). */
	masks: Selector[];
	/** Like `masks`, for nodes that are only on screen at some text sizes (the largest text pushes them below the fold): masked when the tree has them. */
	masksWhenShown: Selector[];
};

const dev = "rasheed-svelte:///__dev";
const screens = `${dev}/screens`;
const tree = `${dev}/tree`;

function screenCase(
	id: string,
	route: string,
	deepLink: string | null,
	anchor: Selector,
	fields: Partial<ScreenCase> = {},
): ScreenCase {
	return {
		id,
		route,
		state: "ready",
		deepLink,
		network: "normal",
		needsBackend: false,
		steps: [],
		anchor,
		title: null,
		layout: "page",
		controls: [],
		scrolled: [],
		hidden: [],
		largestText: true,
		masks: [],
		masksWhenShown: [],
		...fields,
	};
}

/** The labels that say the screen itself is on screen: its declared controls, or its title when it declares none. */
export function ownLabels(screen: ScreenCase, direction: Direction): string[] {
	if (screen.controls.length > 0) return screen.controls.map((control) => localize(control, direction));
	return screen.title === null ? [] : [localize(screen.title, direction)];
}

const label = (text: string): Selector => ({ label: text });
const tapLabel = (text: string): Step => ({ tap: label(text) });
const waitFor = (text: string): Step => ({ wait: label(text) });

/** The menu's own button for a screen it pushes: the lab menu is the base (the launch link), the tap pushes the screen onto it. */
const pushFromMenu = (button: string): Step[] => [tapLabel(button), { pause: 600 }];

/** For the screens the menu has no button for (a button would move the rows the menu's references show): the link opened onto the menu. */
const openFromMenu = (mode: string): Step[] => [
	waitFor("Push eight screens with headers"),
	{ open: `${screens}?mode=${mode}` },
	{ pause: 600 },
];

const menuButtons = [
	"Push eight screens with headers",
	"Header slots and search",
	"Translucent header over content",
	"Sheet with two detents",
	"Sheet that fits its content",
	"Form sheet",
	"Modal",
];

const devCommon: Localized[] = [
	"Run all checks",
	"checks",
	"binding",
	"rows",
	"async",
	"animation",
	"stress",
];
const asyncButtons = ["Start async", "Resolve async", "Reject async", "Trip error boundary"];

export const cases: ScreenCase[] = [
	screenCase(
		"startup-loading",
		"/ (platform configuration pending)",
		null,
		{ className: "android.widget.ProgressBar" },
		{
			state: "loading",
			network: "hang",
			layout: "header",
			title: "Rasheed",
			masks: [{ className: "android.widget.ProgressBar" }],
		},
	),
	screenCase(
		"startup-error",
		"/ (platform configuration unreachable)",
		null,
		{ className: "android.widget.Button" },
		{
			state: "error",
			network: "refuse",
			layout: "header",
			title: "Rasheed",
			controls: [{ en: "Retry", ar: "إعادة المحاولة" }],
		},
	),
	screenCase(
		"login",
		"/auth/login",
		null,
		{ className: "android.widget.EditText" },
		{
			needsBackend: true,
			layout: "header",
			title: { en: "What’s your email address?", ar: "ما بريدك الإلكتروني؟" },
			controls: [
				{ en: "Email", ar: "البريد الإلكتروني" },
				{ en: "Continue with email", ar: "المتابعة بالبريد الإلكتروني" },
				{ en: "العربية", ar: "English" },
				"Mobile development lab",
			],
		},
	),
	screenCase("dev-checks", "/__dev (checks)", dev, label("Run all checks"), {
		layout: "header",
		title: "Mobile development lab",
		controls: devCommon,
		scrolled: ["Increment state"],
	}),
	screenCase("dev-binding", "/__dev (binding)", dev, label("Parent value: parent before"), {
		steps: [tapLabel("binding"), waitFor("Parent value: parent before")],
		layout: "header",
		title: "Mobile development lab",
		controls: devCommon,
		scrolled: ["Bound child input", "Change from child", "Change parent and context"],
	}),
	screenCase(
		"dev-rows",
		"/__dev (rows)",
		dev,
		label("Edit a draft or tap a row, then reverse. Its local state should follow its key."),
		{
			steps: [
				tapLabel("rows"),
				waitFor("Edit a draft or tap a row, then reverse. Its local state should follow its key."),
			],
			layout: "header",
			title: "Mobile development lab",
			controls: devCommon,
			scrolled: [
				"Reverse rows",
				"Restore sample rows",
				"Unmount rows",
				"Change key",
				"Tap a",
				"Tap b",
				// The draft input sits on the scroll view's bottom edge, where uiautomator clips its bounds to no height.
				"Row A",
			],
		},
	),
	screenCase("dev-async", "/__dev (async, idle)", dev, label("Start async"), {
		steps: [tapLabel("async"), waitFor("Start async")],
		layout: "header",
		title: "Mobile development lab",
		controls: devCommon,
		scrolled: asyncButtons,
	}),
	screenCase("dev-async-loading", "/__dev (async, pending)", dev, label("pending"), {
		state: "loading",
		largestText: false,
		steps: [tapLabel("async"), waitFor("Start async"), tapLabel("Start async"), waitFor("pending")],
		layout: "header",
		title: "Mobile development lab",
		controls: devCommon,
		scrolled: asyncButtons,
	}),
	screenCase("dev-async-error", "/__dev (async, error boundary)", dev, label("Reset boundary"), {
		state: "error",
		largestText: false,
		steps: [
			tapLabel("async"),
			waitFor("Trip error boundary"),
			tapLabel("Trip error boundary"),
			waitFor("Reset boundary"),
		],
		layout: "header",
		title: "Mobile development lab",
		controls: devCommon,
		scrolled: [...asyncButtons, "Reset boundary"],
	}),
	screenCase(
		"dev-animation",
		"/__dev (animation)",
		dev,
		label(
			"Transforms and opacity run through Reanimated. Normal controls respect the system’s reduced-motion setting.",
		),
		{
			steps: [
				tapLabel("animation"),
				waitFor(
					"Transforms and opacity run through Reanimated. Normal controls respect the system’s reduced-motion setting.",
				),
			],
			layout: "header",
			title: "Mobile development lab",
			controls: devCommon,
			// The Reanimated test square is driven by a shared value and is drawn differently from one launch to the next.
			masksWhenShown: [label("Reanimated test square")],
			scrolled: [
				"Animated touch target",
				"Animate timing",
				"Animate spring",
				"Start animation loop",
			],
		},
	),
	screenCase("lab-screen", "/__dev/screen", `${dev}/screen`, label("Lab screen"), {
		layout: "header",
		title: "Lab screen",
	}),
	// The lab's menu is only linked to, never pushed by a button: the lab's own screen is the base and the link is opened onto it.
	screenCase("screens-menu", "/__dev/screens", dev, label("Push eight screens with headers"), {
		steps: [waitFor("Run all checks"), { open: screens }, { pause: 600 }],
		layout: "header",
		title: "Native screens",
		controls: ["Navigate up", "Notifications", ...menuButtons],
	}),
	screenCase(
		"screens-header",
		"/__dev/screens?mode=header",
		screens,
		label("Screen 1, Native header"),
		{
			steps: pushFromMenu("Push eight screens with headers"),
			layout: "header",
			title: "Screen 1, Native header",
			controls: ["Navigate up", "Notifications"],
		},
	),
	screenCase(
		"screens-slots",
		"/__dev/screens?mode=slots",
		`${screens}?mode=slots`,
		label("Search"),
		{
			layout: "header",
			title: "Segment A",
			controls: ["Close", "Segment A", "Segment B", "Notifications", "Search"],
		},
	),
	screenCase(
		"screens-translucent",
		"/__dev/screens?mode=translucent",
		screens,
		label("Translucent, Content runs under the bar"),
		{
			steps: pushFromMenu("Translucent header over content"),
			layout: "header",
			title: "Translucent, Content runs under the bar",
			controls: ["Navigate up"],
		},
	),
	screenCase(
		"screens-tabs",
		"/__dev/screens?mode=tabs",
		`${screens}?mode=tabs`,
		label("Home row 1"),
		{
			layout: "tabs",
			title: "Home, This tab's own stack, level 1",
			controls: ["Home, new items", "Inbox, 99+", "Me", "Modal"],
		},
	),
	screenCase(
		"screens-toolbar",
		"/__dev/screens?mode=toolbar",
		screens,
		label("Toolbar, Four actions"),
		{
			steps: openFromMenu("toolbar"),
			layout: "header",
			title: "Toolbar, Four actions",
			controls: ["Navigate up", "Reply", "Archive", "Flag", "Delete"],
		},
	),
	screenCase(
		"screens-toolbar-center",
		"/__dev/screens?mode=toolbar-center",
		screens,
		label("Toolbar center"),
		{
			steps: openFromMenu("toolbar-center"),
			layout: "header",
			title: "Toolbar center",
			controls: ["Navigate up", "Attach", "Send", "List", "Grid"],
		},
	),
	screenCase("tree-home", "/__dev/tree", tree, label("Home row 1"), {
		layout: "tabs",
		title: "Home, Route tree",
		controls: ["Home", "Inbox, 3"],
		scrolled: ["Push detail"],
	}),
	screenCase(
		"tree-detail",
		"/__dev/tree/home/detail/7",
		`${tree}/home/detail/7`,
		label("Open account modal"),
		{
			layout: "tabs",
			title: "Detail 7",
			controls: ["Navigate up", "Back", "Open account modal", "Home", "Inbox, 3"],
		},
	),
	screenCase("tree-inbox", "/__dev/tree/inbox", `${tree}/inbox`, label("Message 1"), {
		layout: "tabs",
		title: "Inbox",
		controls: ["Home", "Inbox, 3"],
		scrolled: ["Compose"],
	}),
	screenCase(
		"tree-compose",
		"/__dev/tree/inbox/compose (sheet)",
		`${tree}/inbox/compose`,
		label("Done"),
		{
			layout: "sheet",
			title: "New message",
			controls: ["Message", "Done"],
			hidden: ["Message 1", "Compose"],
		},
	),
	screenCase(
		"screens-sheet",
		"/__dev/screens?mode=sheet (presented)",
		screens,
		label("Two detents"),
		{
			layout: "sheet",
			steps: [tapLabel("Sheet with two detents"), waitFor("Two detents"), { pause: 600 }],
			title: "Two detents",
			scrolled: ["Close"],
			hidden: menuButtons,
		},
	),
	screenCase(
		"screens-sheet-auto",
		"/__dev/screens?mode=auto (presented)",
		screens,
		label("Fits its content"),
		{
			layout: "sheet",
			steps: [tapLabel("Sheet that fits its content"), waitFor("Fits its content"), { pause: 600 }],
			title: "Fits its content",
			controls: ["Done"],
			hidden: menuButtons,
		},
	),
	screenCase(
		"screens-form-sheet",
		"/__dev/screens?mode=form (presented)",
		screens,
		label("Form sheet"),
		{
			layout: "sheet",
			steps: [tapLabel("Form sheet"), waitFor("Save"), { pause: 600 }],
			title: "Form sheet",
			controls: ["Close", "Name", "Save"],
			hidden: menuButtons,
		},
	),
	screenCase(
		"screens-modal",
		"/__dev/screens (modal presentation)",
		screens,
		label("Screen 1, Native header"),
		{
			layout: "modal",
			steps: [tapLabel("Modal"), waitFor("Screen 1, Native header"), { pause: 600 }],
			title: "Screen 1, Native header",
			controls: ["Notifications"],
			hidden: menuButtons,
		},
	),
];

export type NotCovered = { route: string; reason: string };

const needsSession =
	"needs a signed-in session (email code login) and the workspace data behind it; the harness has no credential, and the router sends every route but /auth/login and /__dev to /auth/login without one";

/**
 * Every route with a `+mobile.svelte` page that no case reaches, with why. `routes.test.ts` checks this list and the cases
 * between them account for every mobile route in the app, so a new route cannot be left out silently.
 */
export const notCovered: NotCovered[] = [
	{
		route: "/__dev/foreign",
		reason:
			"the foreign-views lab (WebView, map, video, and the sections for expo-image, expo-blur, expo-linear-gradient, react-native-video, datetimepicker, lottie-react-native, react-native-pdf, react-native-view-shot, rive-react-native, expo-conic-gradient, react-native-fast-shadow, react-native-animateable-text and react-native-svg) draws third-party content that is not ours to freeze: remote pages and Rive's file, map tiles, video frames, the looping animations, the counting text and the SVG section's progress ring change between runs (the ring is animated by a shared value, so no frame of the screen is stable), and the blur, date picker, PDF renderer, shadow, image decoders and the SVG rasteriser are the libraries' own rendering that a pixel reference would pin to one device and library version; the foreign-views stress scenario of the lab checks these views functionally",
	},
	{ route: "/(account)/account", reason: needsSession },
	{ route: "/onboarding/profile", reason: needsSession },
	{ route: "/workspaces", reason: needsSession },
	{ route: "/workspaces/create", reason: needsSession },
	{ route: "/(workspace)/[slug]/home", reason: needsSession },
	{ route: "/(workspace)/[slug]/settings", reason: needsSession },
	{ route: "/(workspace)/[slug]/settings/[section]", reason: needsSession },
];

/** The route directories (relative to `src/routes`) of the screens the cases reach, for the completeness check. */
export const coveredRouteDirectories = [
	"__dev",
	"__dev/screen",
	"__dev/screens",
	"__dev/tree/home",
	"__dev/tree/home/detail/[id]",
	"__dev/tree/inbox",
	"__dev/tree/inbox/compose",
	"(public)/auth/login",
];

const pageDoesNotScroll =
	"at 200 % text the button that sets this state (Start async, Trip error boundary) is below the first screen of the page, and the page cannot be scrolled: the ScrollView of Page.svelte reports scrollable=false with 2272 px of height and a 900 px swipe moves nothing (the same on /__dev/screen with its 60 rows), so neither a user nor the harness can reach the control";

/** Screen states left out of the largest-text variants, with why: they count as not covered, not as missing. */
export const notCoveredStates: NotCovered[] = [
	{ route: "/__dev (async, pending) at the largest text size", reason: pageDoesNotScroll },
	{ route: "/__dev (async, error boundary) at the largest text size", reason: pageDoesNotScroll },
];

export type Variant = {
	id: string;
	theme: Theme;
	direction: Direction;
	fontScale: number;
};

/** The largest font scale Android's settings offer (Android 14 and later: 200 %). */
export const largestFontScale = 2;

function variant(theme: Theme, direction: Direction, fontScale: number): Variant {
	return {
		id: `${theme}-${direction}-${fontScale === 1 ? "normal" : "large"}`,
		theme,
		direction,
		fontScale,
	};
}

/** Theme x direction x text size: eight variants, every combination. */
export const variants: Variant[] = (["light", "dark"] as const).flatMap((theme) =>
	(["ltr", "rtl"] as const).flatMap((direction) =>
		[1, largestFontScale].map((scale) => variant(theme, direction, scale)),
	),
);

/** The small set for a quick pass while working: the base, dark, right-to-left and large text. */
export const quickVariants: Variant[] = [
	variant("light", "ltr", 1),
	variant("dark", "ltr", 1),
	variant("light", "rtl", 1),
	variant("light", "ltr", largestFontScale),
];

/** The variants that change layout, for the accessibility suite (theme changes no node): direction x text size. */
export const layoutVariants: Variant[] = [
	variant("light", "ltr", 1),
	variant("light", "rtl", 1),
	variant("light", "ltr", largestFontScale),
	variant("light", "rtl", largestFontScale),
];

export function localize(value: Localized, direction: Direction): string {
	return typeof value === "string" ? value : direction === "rtl" ? value.ar : value.en;
}

export function selectorFor(
	selector: Selector,
	direction: Direction,
): { label?: string; className?: string } {
	return {
		...(selector.label === undefined ? {} : { label: localize(selector.label, direction) }),
		...(selector.className === undefined ? {} : { className: selector.className }),
	};
}

/** The id of one case in one variant, which names its reference image. */
export function referenceName(screen: ScreenCase, variantOf: Variant): string {
	return `${screen.id}--${variantOf.id}`;
}

/** The screens and variants that make up a matrix: every pair except the states left out at the largest text size. */
export function matrix(
	screens: ScreenCase[],
	chosen: Variant[],
): { screen: ScreenCase; variant: Variant }[] {
	return chosen.flatMap((variant) =>
		screens
			.filter((screen) => screen.largestText || variant.fontScale !== largestFontScale)
			.map((screen) => ({ screen, variant })),
	);
}
