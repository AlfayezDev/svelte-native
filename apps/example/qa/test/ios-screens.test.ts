import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { iosDeviceKind } from "../commands/ios-parity.ts";
import { launchArguments, parseCaptureIndex, tryParseCaptureIndex } from "../lib/iphone/capture.ts";
import { iosBelowTheFold, iosCases, iosControl, iosLayoutVariants, iosMatrix, iosNotCovered, iosTitle, iosVariants } from "../lib/iphone/screens.ts";
import { cases, referenceName } from "../lib/screens.ts";
import { platformOf } from "../lib/flags.ts";

describe("the iOS matrix", () => {
	test("it is the Android matrix without the screens an iOS app cannot be put in and without text sizes", () => {
		expect(iosCases.map((screen) => screen.id)).not.toContain("startup-loading");
		expect(iosCases.map((screen) => screen.id)).not.toContain("startup-error");
		expect(iosCases).toHaveLength(cases.length - 2);
		expect(iosVariants.map((variant) => variant.id)).toEqual(["light-ltr-normal", "light-rtl-normal", "dark-ltr-normal", "dark-rtl-normal"]);
		expect(iosLayoutVariants.map((variant) => variant.id)).toEqual(["light-ltr-normal", "light-rtl-normal"]);
		expect(iosMatrix(iosCases, iosVariants)).toHaveLength(iosCases.length * 4);
	});

	test("every screen of the matrix is one the lab's capture mode knows", async () => {
		const source = await readFile(fileURLToPath(new URL("../../src/lib/native/dev/capture.ts", import.meta.url)), "utf8");
		const known = [...source.matchAll(/^\s*(?:"([\w-]+)"|(\w+)): \{ (?:base|goto):/gm)].map((match) => match[1] ?? match[2]);
		for (const screen of iosCases) expect(known).toContain(screen.id);
	});

	test("the controls the iPhone leaves below the fold belong to screens of the matrix", () => {
		const ids = iosCases.map((screen) => screen.id);
		for (const id of Object.keys(iosBelowTheFold)) expect(ids).toContain(id);
	});

	test("references are named like the Android ones, so the same screen in the same variant has one name on both", () => {
		const screen = iosCases.find((entry) => entry.id === "screens-sheet");
		const variant = iosVariants[0];
		if (!screen || !variant) throw new Error("matrix is empty");
		expect(referenceName(screen, variant)).toBe("screens-sheet--light-ltr-normal");
	});

	test("what is left out is listed with its reason", () => {
		const text = iosNotCovered.map((entry) => `${entry.route} ${entry.reason}`).join("\n");
		expect(text).toContain("platform configuration");
		expect(text).toContain("Dynamic Type");
	});

	test("the back button's label is iOS's, the title is the heading without its subtitle", () => {
		expect(iosControl("Navigate up", "ltr")).toBe("Back");
		expect(iosControl("Notifications", "ltr")).toBe("Notifications");
		const header = cases.find((entry) => entry.id === "screens-header");
		if (!header) throw new Error("no screens-header case");
		expect(iosTitle(header, "ltr")).toBe("Screen 1");
		const login = cases.find((entry) => entry.id === "login");
		if (!login) throw new Error("no login case");
		expect(iosTitle(login, "rtl")).toBe("ما بريدك الإلكتروني؟");
	});
});

describe("device kind, capture index and launch arguments", () => {
	test("pixels are frozen per release, model and display", () => {
		expect(iosDeviceKind("iPhone SE (3rd generation)", "26.6", { width: 750, height: 1334, scale: 2 })).toBe("ios26-iPhone-SE-3rd-generation-750x1334-2x");
	});

	test("right-to-left launches ask for Arabic; left-to-right ones add nothing", () => {
		expect(launchArguments.ltr).toEqual([]);
		expect(launchArguments.rtl).toEqual(["-AppleLanguages", "(ar)", "-AppleLocale", "ar_SA"]);
	});

	test("an index that is not the lab's is refused", () => {
		expect(() => parseCaptureIndex("{}")).toThrow("unexpected shape");
		const index = parseCaptureIndex(JSON.stringify({ schema: 1, token: "t", startedAt: "x", finishedAt: null, done: false, themes: ["light"], entries: [], error: null }));
		expect(index.done).toBe(false);
	});

	test("an index that a copy caught empty or half written is not ready yet, not an error", () => {
		expect(tryParseCaptureIndex("")).toBeNull();
		expect(tryParseCaptureIndex('{"schema":1,"token":"t","entries":[{"name"')).toBeNull();
		expect(tryParseCaptureIndex("{}")).toBeNull();
		expect(tryParseCaptureIndex(JSON.stringify({ schema: 1, token: "t", startedAt: "x", finishedAt: null, done: true, themes: ["light"], entries: [], error: null }))?.done).toBe(true);
	});

	test("--platform picks the runner and says what it does not know", () => {
		expect(platformOf(["--device", "x"])).toBe("android");
		expect(platformOf(["--platform", "ios", "--device", "x"])).toBe("ios");
		expect(platformOf(["--platform=ios"])).toBe("ios");
		expect(() => platformOf(["--platform", "windows"])).toThrow("--platform");
	});
});
