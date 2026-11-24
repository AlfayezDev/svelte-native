import type { Direction, NetworkMode, Theme } from "./device.ts";
import type { InfoExpectation, NodeExpectation } from "./a11y-state.ts";

/**
 * The screens the suites drive and the settings they drive them under. A screen is a route in one state; the parity suite
 * takes each in every variant, the accessibility suite in the layout-affecting ones. Everything here is reachable without
 * a signed-in session; the routes that are not are listed in `notCovered`, each with its reason.
 */

/** Text that differs by language: the text for the app in English and in Arabic. */
export type Localized = string | { en: string; ar: string };

/**
 * A node of the accessibility tree: by its text or content description, by its class, by its resource id (the `testID` of a view), or
 * a combination. `account: "email"` is the node that
 * shows the QA account's address (`lib/qa-account.ts`): the address cannot be written in a case, so the selector names it and the
 * harness compares the node's text with the address it read from the environment.
 */
export type Selector = { label?: Localized; className?: string; account?: "email"; resourceId?: string };

/**
 * `open` is a link opened into the running app (`am start` of a deep link without stopping it): the router treats it as a
 * plain goto, so it pushes a screen of another page onto the stack, and changes the screen on top in place when the link is to that
 * screen's own page with another query. `tap` pushes from a screen's own button. `scrollToEnd` swipes the
 * page up twice, for a control the largest text pushes below the first screen (the tree lists only what is on screen).
 */
export type Step =
	| { wait: Selector; timeoutMs?: number }
	| { tap: Selector }
	| { open: string }
	| { pause: number }
	| { scrollToEnd: true };

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
	 * link and a step that pushes it: a tap on the menu's button, or, where the menu has none, a tap that pushes screen 1 and an
	 * `open` of the screen's own link, which changes screen 1 into it in place.
	 */
	deepLink: string | null;
	/** What the app's network sees while the screen is open. */
	network: NetworkMode;
	/** True when the screen only exists while the dev backend answers; an unreachable backend skips the case, it does not fail it. */
	needsBackend: boolean;
	/**
	 * True for a screen of the signed-in phase: the suites sign in as the QA account once (`lib/signin.ts`), run these cases under that
	 * session, and sign out. They need the backend and the account, and are skipped (parity) or errors (a11y) without them.
	 */
	signedIn: boolean;
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
	/** True for a case that reads Android's own node info (the accessibility lab's `info`): the iPhone's matrix leaves it out. */
	androidOnly?: boolean;
	/** What the accessibility dump must show of the controls of the accessibility lab, by `testID` (the accessibility suite only; `lib/a11y-state.ts`). */
	expect?: NodeExpectation[];
	/**
	 * What the app must publish for them, which the dump cannot show (tooltip, range, actions, live region): the lab logs the node info of its controls when the
	 * link has `probe=` and the suite reads it from logcat. Judged when given.
	 */
	info?: InfoExpectation[];
	/** Nodes whose area is masked because they move on their own (spinners). */
	masks: Selector[];
	/** Like `masks`, for nodes that are only on screen at some text sizes (the largest text pushes them below the fold): masked when the tree has them. */
	masksWhenShown: Selector[];
};

const dev = "rasheed-svelte:///__dev";
const screens = `${dev}/screens`;
const tree = `${dev}/tree`;
const a11yLab = `${dev}/a11y`;
/**
 * The words React Native's Android views add to a label or give a role (its `values-<language>/strings.xml`: "mixed", "busy", "Tab", "Radio Group"): the engine
 * uses the same resources, so they are in the app's language, which the Arabic layouts set. `qa/test/a11y-state.test.ts` compares them with the files.
 */
export const rn = {
	mixed: { en: "mixed", ar: "مختلط" },
	busy: { en: "busy", ar: "مشغول" },
	tab: { en: "Tab", ar: "علامة التبويب" },
	radioGroup: { en: "Radio Group", ar: "مجموعة أزرار اختيار" },
};
const and = (label: string, word: { en: string; ar: string }): Localized => ({ en: `${label}, ${word.en}`, ar: `${label}, ${word.ar}` });

/** A case with every field defaulted: the lab's cases below, and the fixtures of the tests (`qa/test/fixture-cases.ts`). */
export function screenCase(
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
		signedIn: false,
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

const label = (text: Localized): Selector => ({ label: text });
const tapLabel = (text: Localized): Step => ({ tap: label(text) });
const waitFor = (text: Localized): Step => ({ wait: label(text) });

/** The menu's own button for a screen it pushes: the lab menu is the base (the launch link), the tap pushes the screen onto it. */
const pushFromMenu = (button: string): Step[] => [tapLabel(button), { pause: 600 }];

/**
 * For the screens the menu has no button for (a button would move the rows the menu's references show): the link opened onto a screen
 * pushed from the menu. A link to the page the user is on with another query changes that screen in place, so one opened onto the menu
 * would turn the base into the toolbar screen, with nothing to go back to; opened onto screen 1, it keeps the menu below.
 */
const openFromMenu = (mode: string): Step[] => [
	tapLabel("Push eight screens with headers"),
	waitFor("Screen 1, Native header"),
	{ pause: 600 },
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

const signedOutCases: ScreenCase[] = [
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
	// The screen of HTML elements and classes (`qa/README.md`, "HTML elements"): a card whose text style is inherited, a flex row, a line with a link, a form, a rule and a `pre`, written with no component of the
	// library. Everything is static (the counters it shows are zero until a press), so the references are stable; the fields and the buttons are further down the page than the first screen at any text size.
	screenCase("html-elements", "/__dev/html", `${dev}/html`, label("Heading one"), {
		layout: "header",
		title: "HTML elements",
		scrolled: ["Send", "Cancel", "Name", "Password", "Remember me"],
		// The checkbox is the platform's Switch, whose thumb shadow the emulator's software renderer draws a little differently from one launch to the next
		// (12 Nov: 1,051 pixels at the thumb's edge between two launches of the same build, nothing visible). This case is about the lowering, not the Switch.
		// By its class, and only when shown: by label it also takes the row's own text (chrome), and at the larger sizes the Switch is below the fold.
		masksWhenShown: [{ className: "android.widget.Switch" }],
	}),
	// The screen of transitions on HTML elements (`qa/README.md`, "Transitions"): the route opens it settled (the card shown and the panel open: a block that is there when its screen opens plays nothing), so no
	// animation is running when it is photographed and the references are stable; the list's order is the one it starts with. The buttons that run the transitions are further down at the larger sizes.
	screenCase("transitions", "/__dev/transitions", `${dev}/transitions`, label("Hide the card"), {
		layout: "header",
		title: "Transitions",
		scrolled: ["Shuffle the list", "Close the panel"],
	}),
	// The box styles lab (SPEC.md "Box styles"; `qa/README.md`, "Box styles"): the box shadows, borders and transform origins the Android engine draws with React Native's own drawables, one tile
	// each (`src/lib/native/dev/styles-cases.ts`), a page per kind; Android only (the iPhone draws these with UIKit). Nothing moves when it is photographed: the animated tiles of `origin` are at their end value 300 ms after the screen opens.
	screenCase("lab-styles-shadow", "/__dev/styles?mode=shadow", `${dev}/styles?mode=shadow`, label("Focus ring"), {
		androidOnly: true,
		layout: "header",
		title: "Box styles",
		controls: ["Focus ring"],
	}),
	screenCase("lab-styles-border", "/__dev/styles?mode=border", `${dev}/styles?mode=border`, label("Box styles"), {
		androidOnly: true,
		layout: "header",
		title: "Box styles",
	}),
	screenCase("lab-styles-origin", "/__dev/styles?mode=origin", `${dev}/styles?mode=origin`, label("Box styles"), {
		androidOnly: true,
		layout: "header",
		title: "Box styles",
	}),
	// The accessibility lab (SPEC.md "Accessibility props"): the state, value, hint and actions of each control are checked against the dump
	// (`expect`) and, for what the dump cannot show, against the node info the lab logs (`info`). Labels are what React Native's views would
	// say for the same props: "mixed", "busy" and the value's text follow the label, joined by ", ".
	screenCase("lab-a11y-states", "/__dev/a11y?mode=states", `${a11yLab}?mode=states&probe=nodes`, label("Accept terms"), {
		androidOnly: true,
		layout: "header",
		title: "Accessibility lab",
		controls: ["Accept terms"],
		scrolled: [and("Select all", rn.mixed), "Free", "Pro", "Team", "Inbox", "Archive", "Pay now", and("Saving", rn.busy), "Details"],
		expect: [
			{ id: "a11y.terms", className: "android.widget.CheckBox", says: "Accept terms", checkable: true, checked: true, selected: false, enabled: true, clickable: true },
			{ id: "a11y.all", className: "android.widget.CheckBox", says: and("Select all", rn.mixed), checkable: false, checked: false, clickable: true },
			{ id: "a11y.plan.free", className: "android.widget.RadioButton", says: "Free", checkable: true, checked: false, clickable: true },
			{ id: "a11y.plan.pro", className: "android.widget.RadioButton", says: "Pro", checkable: true, checked: true, clickable: true },
			{ id: "a11y.plan.team", className: "android.widget.RadioButton", says: "Team", checkable: true, checked: false, clickable: true },
			{ id: "a11y.tab.inbox", says: "Inbox", selected: true, clickable: true },
			{ id: "a11y.tab.archive", says: "Archive", selected: false, clickable: true },
			{ id: "a11y.disabled", className: "android.widget.Button", says: "Pay now", enabled: false },
			{ id: "a11y.busy", className: "android.widget.Button", says: and("Saving", rn.busy), enabled: true, clickable: true },
			{ id: "a11y.details", className: "android.widget.Button", says: "Details", clickable: true },
			{ id: "a11y.hidden", absent: true, label: "Hidden note" },
		],
		info: [
			{ id: "a11y.terms", className: "android.widget.CheckBox", desc: "Accept terms", checkable: true, checked: true, selected: false, enabled: true, clickable: true, roleDescription: "", important: 0 },
			{ id: "a11y.all", className: "android.widget.CheckBox", desc: and("Select all", rn.mixed), checkable: false, checked: false },
			{ id: "a11y.plans", className: "android.view.View", desc: "Plan", roleDescription: rn.radioGroup },
			{ id: "a11y.plan.pro", className: "android.widget.RadioButton", checkable: true, checked: true },
			{ id: "a11y.plan.free", className: "android.widget.RadioButton", checkable: true, checked: false },
			{ id: "a11y.tab.inbox", className: "android.view.View", roleDescription: rn.tab, selected: true },
			{ id: "a11y.tab.archive", roleDescription: rn.tab, selected: false },
			{ id: "a11y.disabled", className: "android.widget.Button", enabled: false, clickable: true },
			{ id: "a11y.busy", desc: and("Saving", rn.busy), enabled: true },
			{ id: "a11y.details", desc: "Details", actions: [{ name: "expand", label: "" }], without: ["collapse"] },
			{ id: "a11y.hidden", important: 4 },
		],
	}),
	screenCase("lab-a11y-actions", "/__dev/a11y?mode=actions", `${a11yLab}?mode=actions&probe=actions`, label("Last action: archive"), {
		androidOnly: true,
		layout: "header",
		title: "Accessibility lab",
		controls: ["Volume, 5 of 10", "Archive thread"],
		scrolled: ["Invoice 1042", "Add one"],
		// The lab performed "archive" on the row and "increment" on the slider through the node's own actions before the dump: what JavaScript received shows on the screen.
		expect: [
			{ id: "a11y.slider", className: "android.widget.SeekBar", says: "Volume, 5 of 10", focusable: true },
			{ id: "a11y.hint", className: "android.widget.Button", says: "Archive thread", hint: "", clickable: true },
			{ id: "a11y.row", says: "Invoice 1042", focusable: true },
			{ id: "a11y.last", says: "Last action: archive" },
			{ id: "a11y.add", className: "android.widget.Button", says: "Add one", clickable: true },
		],
		info: [
			{ id: "a11y.slider", className: "android.widget.SeekBar", desc: "Volume, 5 of 10", range: { min: 0, max: 10, current: 5 }, actions: [{ name: "increment", label: "" }, { name: "decrement", label: "" }] },
			{ id: "a11y.hint", className: "android.widget.Button", desc: "Archive thread", tooltip: "Moves the thread out of the inbox" },
			{ id: "a11y.row", desc: "Invoice 1042", range: null, actions: [{ name: "archive", label: "Archive" }, { name: "delete", label: "Delete" }] },
			{ id: "a11y.counter", liveRegion: 1 },
			{ id: "a11y.last", text: "Last action: archive" },
		],
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

/**
 * The cases of the signed-in phase (`signedIn: true`, `lib/phases.ts`, `lib/signin.ts`): screens that exist only under a session, run after
 * the suites sign in as the QA account and before they sign out again. This repository's example app has no account, so there are none, and
 * `gates.json` pins none (`signedIn`). A project with an account adds its cases here, each with `signedIn: true` and `needsBackend: true`.
 */
const signedInCases: ScreenCase[] = [];

export const cases: ScreenCase[] = [...signedOutCases, ...signedInCases];

export type NotCovered = { route: string; reason: string };

/**
 * Every route with a `+mobile.svelte` page that no case reaches, with why. `routes.test.ts` checks this list and the cases
 * between them account for every mobile route in the app, so a new route cannot be left out silently.
 */
export const notCovered: NotCovered[] = [
	{
		route: "/__dev/gestures",
		reason:
			"the gesture lab (`native-qa gestures`): every page draws boxes, rows and sheets that move under injected touches and report counters, which the lab's own checks and the gestures gates judge; a frozen frame of one would only record where a drag stopped",
	},
	{
		route: "/__dev/gesture-probe",
		reason:
			"the iOS gesture probe page (`native-qa probe`): it exists to be inspected through UIKit's recogniser list, with views whose only content is a handler attached by hand, so there is no screen to freeze",
	},
	{
		route: "/__dev/foreign",
		reason:
			"the foreign-views lab (WebView, map, video, and the sections for expo-image, expo-blur, the library's own blur, expo-linear-gradient, react-native-video, datetimepicker, lottie-react-native, react-native-pdf, react-native-view-shot, rive-react-native, expo-conic-gradient, react-native-fast-shadow, react-native-animateable-text and react-native-svg) draws third-party content that is not ours to freeze: remote pages and Rive's file, map tiles, video frames, the looping animations, the counting text and the SVG section's progress ring change between runs (the ring is animated by a shared value, so no frame of the screen is stable), and the blurs, date picker, PDF renderer, shadow, image decoders and the SVG rasteriser are the libraries' own rendering that a pixel reference would pin to one device and library version; the foreign-views stress scenario of the lab checks these views functionally",
	},
	{
		route: "/__dev/smoke",
		reason:
			"the native module smoke test page lists what each native library answered on this device (model, locale, connection state, versions): the text differs between devices and runs by design; the smoke scenario of the lab (`native-qa smoke`) checks the calls themselves",
	},
	{
		route: "/__dev/remote",
		reason:
			"the SvelteKit remote functions lab calls a SvelteKit server that the build or the page names, so it shows nothing of its own without one, and with one its counters, live clock and request echo change between runs by design; its eleven checks run on the device against a dev server (README of the package, \"Remote functions\") and against its own server module in the package tests",
	},
	{
		route: "/",
		reason:
			"the example's home screen: its title, one line of text, the language button and, in the QA and smoke apps, the link into the lab; it is what the production variant starts on, which `native-qa product` checks (the screen is found by its text in both languages), and a pixel reference of it would only pin the title and one button",
	},
];

/** The route directories (relative to `src/routes`) of the screens the cases reach, for the completeness check. */
export const coveredRouteDirectories = [
	"__dev",
	"__dev/a11y",
	"__dev/html",
	"__dev/screen",
	"__dev/screens",
	"__dev/styles",
	"__dev/transitions",
	"__dev/tree/home",
	"__dev/tree/home/detail/[id]",
	"__dev/tree/inbox",
	"__dev/tree/inbox/compose",
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
): { label?: string; className?: string; account?: "email"; resourceId?: string } {
	return {
		...(selector.label === undefined ? {} : { label: localize(selector.label, direction) }),
		...(selector.className === undefined ? {} : { className: selector.className }),
		...(selector.account === undefined ? {} : { account: selector.account }),
		...(selector.resourceId === undefined ? {} : { resourceId: selector.resourceId }),
	};
}

/** The id of one case in one variant, which names its reference image. */
export function referenceName(screen: ScreenCase, variantOf: Variant): string {
	return `${screen.id}--${variantOf.id}`;
}

/**
 * The reference names of the pinned screens in the variants: every pair except the states left out at the largest text size. A pinned
 * id the matrix no longer has still gets all its names, so it shows as missing instead of vanishing.
 */
export function pinnedNames(ids: readonly string[], chosen: Variant[]): string[] {
	return ids.flatMap((id) => {
		const known = cases.find((screen) => screen.id === id);
		return chosen
			.filter((variant) => known === undefined || known.largestText || variant.fontScale !== largestFontScale)
			.map((variant) => `${id}--${variant.id}`);
	});
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
