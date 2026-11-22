import { describe, expect, test } from "bun:test";
import { ar, createTranslator, en } from "../../src/lib/native/messages.ts";
import { copy } from "../lib/copy.ts";

describe("the message catalog the cases name their words from", () => {
	test("a text that differs by language is both, and one that does not is the plain string", () => {
		expect(copy("common.close")).toEqual({ en: "Close", ar: "إغلاق" });
		expect(copy("home.title")).toBe("Expo Svelte");
		expect(copy("common.english")).toBe("English");
	});

	test("a key the catalog does not have is an error that says so, not an empty label", () => {
		expect(() => copy("common.nothingLikeThis" as never)).toThrow("no text for");
	});

	test("{{placeholders}} are filled the way the app's translator fills them, and an unknown one stays", () => {
		const translate = createTranslator({ greeting: "Hello {{name}}, {{other}}" });
		expect(translate("greeting", { name: "Sara" })).toBe("Hello Sara, {{other}}");
		expect(() => translate("nope" as never)).toThrow("Unknown translation key: nope");
	});

	test("both languages say the same things: the Arabic catalog has every key of the English one and no other", () => {
		const keys = (tree: object, prefix = ""): string[] =>
			Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : keys(value as object, `${prefix}${key}.`)));
		expect(keys(ar)).toEqual(keys(en));
	});

	test("the texts the lab renders are the ones its parity references were frozen with", () => {
		expect(en.common.back).toBe("Back");
		expect(ar.common.back).toBe("رجوع");
		expect(en.common.close).toBe("Close");
		expect(ar.common.close).toBe("إغلاق");
		expect(en.common.loading).toBe("Loading…");
		expect(ar.common.loading).toBe("جارٍ التحميل…");
	});
});
