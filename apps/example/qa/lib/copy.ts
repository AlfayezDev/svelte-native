import { ar, en } from "@rasheed/client/messages";
import type { Localized } from "./screens.ts";

type Tree = { readonly [key: string]: string | Tree };
type Paths<T, Prefix extends string = ""> = {
	[Key in keyof T & string]: T[Key] extends string ? `${Prefix}${Key}` : Paths<T[Key], `${Prefix}${Key}.`>;
}[keyof T & string];

/** A key of the message catalog the app translates with (`t(key)`), the keys the cases name instead of retyping the words. */
export type CopyKey = Paths<typeof en>;

function lookup(tree: Tree, key: string): string {
	let node: string | Tree | undefined = tree;
	for (const part of key.split(".")) node = typeof node === "string" ? undefined : node?.[part];
	if (typeof node !== "string") throw new Error(`the message catalog has no text for ${key}`);
	return node;
}

/** `{{name}}` placeholders of a catalog text filled in, the way the app's translator does. */
function fill(text: string, values: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * The text of a catalog key in both languages, as a case's label: the words the app shows, taken from the catalog it translates
 * with, so a copy change reaches the cases and a renamed key fails here rather than in a run. A text that is the same in both
 * languages is the plain string.
 */
export function copy(key: CopyKey, values: Record<string, string> = {}): Localized {
	const english = fill(lookup(en, key), values);
	const arabic = fill(lookup(ar, key), values);
	return english === arabic ? english : { en: english, ar: arabic };
}
