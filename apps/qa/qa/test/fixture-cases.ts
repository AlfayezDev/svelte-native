import { screenCase } from "../lib/screens.ts";

/**
 * Cases that are not the lab's: two pages of an app of another shape, which the harness's tests drive with real device dumps (`samples/`): a startup page
 * that waits for its configuration (a title and a spinner) and a form in Arabic and English (a right-to-left page with a language button). The lab has
 * neither, and `cases` holds none of them.
 */

/** The startup page of an app that waits for its configuration: a title and a spinner (`samples/uia-startup-loading.xml`). */
export const startupLoading = screenCase("startup-loading", "/ (configuration pending)", null, { className: "android.widget.ProgressBar" }, {
	state: "loading",
	network: "hang",
	layout: "header",
	title: "Expo Svelte",
	masks: [{ className: "android.widget.ProgressBar" }],
});

/** A form page, in both languages (`samples/uia-form-ar.xml`). */
export const form = screenCase("form", "/form", null, { className: "android.widget.EditText" }, {
	layout: "header",
	title: { en: "Contact form", ar: "نموذج الاتصال" },
	controls: [
		{ en: "Name", ar: "الاسم" },
		{ en: "Send", ar: "إرسال" },
		{ en: "العربية", ar: "English" },
		"Mobile development lab",
	],
});
