import { afterAll, beforeAll } from "bun:test";
import { cases, screenCase, type Localized, type ScreenCase, type Selector } from "../lib/screens.ts";

/**
 * Cases that are not this repository's: the screens of a product with an account, as the harness met them in the product the library came out
 * of (a loading page, a sign-in screen, the signed-in screens under a QA account). The example app has none of them, and `cases` holds none;
 * the harness's machinery for them (the signed-in phase, the masks over an account's text, the evidence kept for a failed case, the
 * accessibility analysis of a right-to-left page) is still there for a project that has, and these are what its tests drive it with, next to the
 * real device dumps in `samples/`.
 */

const words = {
	chooseWorkspace: { en: "Choose a workspace", ar: "اختر مساحة العمل" },
	createNew: { en: "Create a new workspace", ar: "إنشاء مساحة عمل جديدة" },
	manageAccount: { en: "Account settings", ar: "إعدادات الحساب" },
	manageWorkspace: { en: "Workspace settings", ar: "إعدادات مساحة العمل" },
	signOut: { en: "Sign out", ar: "تسجيل الخروج" },
	close: { en: "Close", ar: "إغلاق" },
	home: { en: "Home", ar: "الرئيسية" },
	settings: { en: "Settings", ar: "الإعدادات" },
	photo: { en: "Photo", ar: "الصورة" },
	firstName: { en: "First name", ar: "الاسم الأول" },
	lastName: { en: "Last name", ar: "اسم العائلة" },
	save: { en: "Save", ar: "حفظ" },
	changeEmail: { en: "Change email", ar: "تغيير البريد الإلكتروني" },
	profile: { en: "Profile", ar: "الملف الشخصي" },
	preferences: { en: "Preferences", ar: "التفضيلات" },
	devices: { en: "Devices", ar: "الأجهزة" },
	workspaces: { en: "Manage workspaces", ar: "إدارة مساحات العمل" },
	danger: { en: "Danger zone", ar: "منطقة الخطر" },
	devicesHint: { en: "Browsers and devices signed in to your account.", ar: "المتصفحات والأجهزة المسجّل دخولها إلى حسابك." },
	signOutOthers: { en: "Sign out other devices", ar: "تسجيل الخروج من الأجهزة الأخرى" },
} satisfies Record<string, { en: string; ar: string }>;

/** The startup page of a product that waits for its configuration: a title and a spinner (`samples/uia-startup-loading.xml`). */
export const startupLoading = screenCase("startup-loading", "/ (configuration pending)", null, { className: "android.widget.ProgressBar" }, {
	state: "loading",
	network: "hang",
	layout: "header",
	title: "Expo Svelte",
	masks: [{ className: "android.widget.ProgressBar" }],
});

/** A sign-in screen, in both languages (`samples/uia-login-ar.xml`). */
export const login = screenCase("login", "/auth/login", null, { className: "android.widget.EditText" }, {
	needsBackend: true,
	layout: "header",
	title: { en: "What’s your email address?", ar: "ما بريدك الإلكتروني؟" },
	controls: [
		{ en: "Email", ar: "البريد الإلكتروني" },
		{ en: "Continue with email", ar: "المتابعة بالبريد الإلكتروني" },
		{ en: "العربية", ar: "English" },
		"Mobile development lab",
	],
});

const addressMask: Selector = { account: "email" };
const sectionTitles: Localized[] = [words.profile, words.preferences, words.devices, words.workspaces, words.danger];
const signedInFields = { needsBackend: true, signedIn: true, layout: "header" as const };

/** A list the account sees first, with its address on it. */
export const accountList = screenCase("app-workspaces", "/workspaces", "expo-svelte:///workspaces", { label: words.chooseWorkspace }, {
	...signedInFields,
	steps: [{ wait: { label: words.chooseWorkspace }, timeoutMs: 45_000 }, { pause: 600 }],
	title: words.chooseWorkspace,
	scrolled: [words.createNew, words.manageAccount, words.signOut],
	masks: [addressMask],
});

/** A tabs screen of the signed-in app. */
export const accountHome = screenCase("app-workspace-home", "/(workspace)/[slug]/home", "expo-svelte:///workspaces", { label: words.manageWorkspace }, {
	...signedInFields,
	layout: "tabs",
	controls: [words.home, words.settings],
	scrolled: [words.manageAccount, words.manageWorkspace, words.chooseWorkspace, words.signOut],
});

const modalOf = (id: string, section: string, anchor: Selector, fields: Partial<ScreenCase>): ScreenCase =>
	screenCase(id, `/(account)/account (${section}, modal)`, "expo-svelte:///workspaces", anchor, {
		...signedInFields,
		layout: "modal",
		title: words.manageAccount,
		controls: [words.close],
		hidden: [words.createNew],
		...fields,
	});

/** The account modal over the list, on its profile: the address (a mask) and the photo (a mask where it is shown). */
export const accountProfile = modalOf("app-account-profile", "profile", { label: words.firstName }, {
	scrolled: [...sectionTitles, words.firstName, words.lastName, words.save, words.changeEmail, words.signOut],
	masks: [addressMask],
	masksWhenShown: [{ label: words.photo }],
});

export const accountPreferences = modalOf("app-account-preferences", "preferences", { label: { en: "Interface language", ar: "لغة الواجهة" } }, {
	scrolled: [...sectionTitles, words.signOut],
});

/** A modal that is left out of the largest text size (its devices' lines wrap there) and masks the devices' text. */
export const accountDevices = modalOf("app-account-devices", "devices", { label: words.devicesHint }, {
	scrolled: [...sectionTitles, words.signOutOthers, words.signOut],
	largestText: false,
	masksWhenShown: [{ resourceId: "device-agent" }],
});

export const signedInFixtures: ScreenCase[] = [accountList, accountHome, accountProfile, accountPreferences, accountDevices];

/**
 * Adds the fixtures' signed-in cases to the harness's cases for the tests of the enclosing `describe` (`beforeAll`), and takes them out again
 * after it (`afterAll`): code that reads `cases` for the signed-in ones (`suite-metrics.ts`) sees them, and no other test file does.
 */
export function withSignedInFixtures(): void {
	beforeAll(() => {
		for (const fixture of signedInFixtures) if (!cases.includes(fixture)) cases.push(fixture);
	});
	afterAll(() => {
		for (const fixture of signedInFixtures) {
			const index = cases.indexOf(fixture);
			if (index >= 0) cases.splice(index, 1);
		}
	});
}
