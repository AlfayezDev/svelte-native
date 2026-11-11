import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";
import { builtOf, cardSize, expectations, find, htmlCheckNames, isBlank, members, sky900, textOf, type Built, type HtmlNode, type MemberRead } from "../../src/lib/native/dev/html-checks.ts";
import { platformDir, svelteNativeCli } from "../lib/paths.ts";

/**
 * What the HTML checks of the native checks lab expect (`src/lib/native/dev/html-checks.ts`): the expectations are held against readings that are right and readings that are wrong, the values they name against
 * the class table the build makes, and the reading of a tree against a small one. `html-probe.test.ts` runs the whole flow against the real host.
 */
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

const built = (viewName: string, style: Record<string, unknown> = {}, props: Record<string, unknown> = {}, flex?: boolean): Built => ({ viewName, flex, style, props });
const node = (name: string, kind: "element" | "text" | "comment" | "fragment", children: HtmlNode[] = [], extra: Partial<HtmlNode> = {}): HtmlNode => ({
	kind, name, textValue: "", hostState: null, getSnapshot: () => ({ children }), peekProps: () => ({}), getProp: () => undefined, listeners: new Map(), dispatcher: () => () => undefined, ...extra,
});
const text = (value: string): HtmlNode => node("", "text", [], { textValue: value });

describe("reading what the host made of a node, and the tree under it", () => {
	test("the host's record of a node is its view, its flex-ness and the style it gave the view, flattened", () => {
		const state = { viewName: "RCTText", flex: undefined, props: { style: [{ fontSize: 18, color: "#fff" }, { fontSize: 36 }], accessibilityRole: "header" } };
		expect(builtOf(node("native-text", "element", [], { hostState: state }))).toEqual({ viewName: "RCTText", flex: undefined, style: { fontSize: 36, color: "#fff" }, props: state.props });
		expect(builtOf(node("native-view", "element", [], { hostState: { viewName: "RCTView", flex: true, props: {} } }))?.flex).toBe(true);
		// a node the host has not built (no record), or one whose record is not what these checks read, is nothing
		expect(builtOf(node("native-view", "element"))).toBeNull();
		expect(builtOf(node("native-view", "element", [], { hostState: { viewName: 3 } }))).toBeNull();
		expect(builtOf(undefined)).toBeNull();
	});

	test("members leave out the places a block keeps (comments) and open fragments; text is read in order, blanks are blank, find walks the tree", () => {
		const link = node("native-text", "element", [text("terms")]);
		const box = node("native-view", "element", [text("Read "), node("", "comment"), node("", "fragment", [link, text(" now")]), text("  ")]);
		expect(members(box)).toHaveLength(4);
		expect(textOf(box)).toBe("Read terms now  ");
		expect(members(box).filter(isBlank)).toHaveLength(1);
		expect(find(box, (candidate) => candidate === link)).toEqual([link]);
		expect(find(box, (candidate) => candidate.name === "native-text")).toHaveLength(1);
	});
});

describe("what each check expects", () => {
	const card = { color: sky900, fontSize: cardSize };
	const reaches = built("RCTText", { color: sky900, fontSize: cardSize });

	test("inheritance: the card has the class and the text below it, through a view, has its colour and size", () => {
		expect(expectations.inherit(card, reaches, reaches)).toEqual({ passed: true, detail: "" });
		expect(expectations.inherit(card, built("RCTText", {}), reaches).passed).toBe(false);
		expect(expectations.inherit(card, reaches, built("RCTText", { color: sky900, fontSize: 14 })).passed).toBe(false);
		expect(expectations.inherit(card, null, reaches).passed).toBe(false);
		// the card without the class is not a card that gives anything
		expect(expectations.inherit({ fontSize: cardSize }, reaches, reaches).passed).toBe(false);
	});

	test("a flex row: flex, two items, each a text of its own (a span of a line is not one)", () => {
		const items = [{ view: "RCTText", text: "Total" }, { view: "RCTText", text: "42" }];
		expect(expectations.row(built("RCTView", {}, {}, true), items).passed).toBe(true);
		expect(expectations.row(built("RCTView", {}, {}, false), items).passed).toBe(false);
		expect(expectations.row(built("RCTView", {}, {}, true), [{ view: "RCTVirtualText", text: "Total" }, { view: "RCTVirtualText", text: "42" }]).passed).toBe(false);
		expect(expectations.row(built("RCTView", {}, {}, true), [items[0] as { view: string; text: string }]).passed).toBe(false);
		expect(expectations.row(null, items).passed).toBe(false);
	});

	test("a block div: not flex, the text and the three spans one line, the link a span with its role and href, the sentence whole", () => {
		const parts: MemberRead[] = [
			{ kind: "text", view: undefined, text: "Read the ", role: undefined, href: undefined },
			{ kind: "element", view: "RCTVirtualText", text: "terms of use", role: "link", href: "#terms" },
			{ kind: "text", view: undefined, text: " and the ", role: undefined, href: undefined },
			{ kind: "element", view: "RCTVirtualText", text: "privacy notice", role: undefined, href: undefined },
			{ kind: "text", view: undefined, text: ", or ", role: undefined, href: undefined },
			{ kind: "element", view: "RCTVirtualText", text: "both", role: undefined, href: undefined },
			{ kind: "text", view: undefined, text: ".", role: undefined, href: undefined },
		];
		const view = built("RCTView", {}, {}, false);
		expect(expectations.block(view, parts)).toEqual({ passed: true, detail: "" });
		expect(expectations.block(built("RCTView", {}, {}, true), parts).passed).toBe(false);
		expect(expectations.block(view, parts.map((part) => (part.kind === "element" ? { ...part, view: "RCTText" } : part))).passed).toBe(false);
		expect(expectations.block(view, parts.map((part) => (part.role === "link" ? { ...part, role: undefined } : part))).passed).toBe(false);
		expect(expectations.block(view, parts.map((part) => (part.role === "link" ? { ...part, href: "/x" } : part))).passed).toBe(false);
		expect(expectations.block(view, parts.slice(0, 5)).passed).toBe(false);
	});

	test("a heading: bold, twice the size the card gives, a header", () => {
		const h1 = built("RCTText", { fontSize: 36, fontWeight: "700" }, { accessibilityRole: "header" });
		expect(expectations.heading(card, h1).passed).toBe(true);
		expect(expectations.heading(card, built("RCTText", { fontSize: 18, fontWeight: "700" }, { accessibilityRole: "header" })).passed).toBe(false);
		expect(expectations.heading(card, built("RCTText", { fontSize: 36 }, { accessibilityRole: "header" })).passed).toBe(false);
		expect(expectations.heading(card, built("RCTText", { fontSize: 36, fontWeight: "700" })).passed).toBe(false);
		expect(expectations.heading({}, h1).passed).toBe(false);
	});

	test("a submission: once, a submit event the handler prevented on the form from the button, and the plain button changes nothing", () => {
		const none = { links: 0, submits: 0, last: null };
		const sent = { links: 0, submits: 1, last: { type: "submit", prevented: true, target: true, submitter: true } };
		expect(expectations.submit(none, sent, sent).passed).toBe(true);
		expect(expectations.submit(none, none, none).passed).toBe(false);
		expect(expectations.submit(none, { ...sent, submits: 2 }, { ...sent, submits: 2 }).passed).toBe(false);
		expect(expectations.submit(none, sent, { ...sent, submits: 2 }).passed).toBe(false);
		for (const broken of [{ prevented: false }, { type: "click" }, { target: false }, { submitter: false }]) expect(expectations.submit(none, { ...sent, last: { ...sent.last, ...broken } }, { ...sent, last: { ...sent.last, ...broken } }).passed).toBe(false);
	});

	test("a password input is secure in the node and in what the host built, and the plain one is not", () => {
		expect(expectations.password({ own: true, built: true }, { own: undefined, built: undefined }).passed).toBe(true);
		expect(expectations.password({ own: true, built: false }, { own: undefined, built: undefined }).passed).toBe(false);
		expect(expectations.password({ own: false, built: true }, { own: undefined, built: undefined }).passed).toBe(false);
		expect(expectations.password({ own: true, built: true }, { own: true, built: true }).passed).toBe(false);
		expect(expectations.password(null, { own: undefined, built: undefined }).passed).toBe(false);
	});

	test("there are six checks, with distinct names", () => {
		expect(htmlCheckNames).toHaveLength(6);
		expect(new Set(htmlCheckNames).size).toBe(6);
	});
});

describe("the values the checks name are the ones the build wrote", () => {
	test("text-lg is 18 and text-sky-900 is #024a70 in the class table of src/global.css", async () => {
		const root = mkdtempSync(join(tmpdir(), "native-qa-html-table-"));
		made.push(root);
		mkdirSync(join(root, "src/lib"), { recursive: true });
		mkdirSync(join(root, "node_modules"), { recursive: true });
		symlinkSync(dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json")), join(root, "node_modules/tailwindcss"));
		copyFileSync(join(platformDir, "src/global.css"), join(root, "src/global.css"));
		copyFileSync(join(platformDir, "src/lib/native/dev/HtmlScreen.svelte"), join(root, "src/lib/HtmlScreen.svelte"));
		const result = spawnSync(process.execPath, [svelteNativeCli, "css", "src/global.css", "--variant", "qa", "--json"], { cwd: root, encoding: "utf8" });
		if (result.status !== 0) throw new Error(`svelte-native css failed: ${result.stderr.slice(0, 400)}`);
		const { file } = JSON.parse(result.stdout) as { file: string };
		const { default: table } = (await import(pathToFileURL(file).href)) as { default: { classes: Record<string, { style: Record<string, unknown> }[]> } };
		expect(table.classes["text-lg"]?.[0]?.style.fontSize).toBe(cardSize);
		expect(table.classes["text-sky-900"]?.[0]?.style.color).toBe(sky900);
		// the card has both, and the screen's markup says so
		expect(readFileSync(join(platformDir, "src/lib/native/dev/HtmlScreen.svelte"), "utf8")).toMatch(/hold\("card"\)\}[^>]*class="[^"]*\btext-lg\b[^"]*\btext-sky-900\b/);
	}, 60_000);
});
