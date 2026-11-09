import { describe, expect, test } from "bun:test";
import { center, descendants, findByLabel, parseHierarchy, spokenLabel } from "../lib/uia.ts";
import { sample } from "./sample.ts";

describe("uiautomator dump parser", () => {
	test("reads the tree of a real dump, with its nesting and attributes", () => {
		const tree = parseHierarchy(sample("uia-screens-header.xml"));
		expect(tree.rotation).toBe(0);
		expect(tree.nodes.length).toBe(45);
		expect(tree.root?.className).toBe("android.widget.FrameLayout");
		expect(tree.root?.bounds).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
		const up = findByLabel(tree, "Navigate up");
		expect(up.length).toBe(1);
		expect(up[0]?.className).toBe("android.widget.Button");
		expect(up[0]?.clickable).toBe(true);
		expect(up[0]?.focusable).toBe(true);
		expect(up[0]?.bounds).toEqual({ x: 0, y: 128, width: 126, height: 147 });
		expect(center(up[0] as NonNullable<(typeof up)[number]>)).toEqual({ x: 63, y: 202 });
		// Pre-order: a parent comes before its children, and `order` is the position.
		for (const node of tree.nodes) {
			expect(tree.nodes[node.order]).toBe(node);
			if (node.parent) expect(node.parent.order < node.order).toBe(true);
		}
	});

	test("the title of the header is one node whose description joins title and subtitle", () => {
		const tree = parseHierarchy(sample("uia-screens-header.xml"));
		const title = findByLabel(tree, "Screen 1, Native header");
		expect(title.length).toBe(1);
		expect(spokenLabel(title[0] as NonNullable<(typeof title)[number]>)).toBe(
			"Screen 1, Native header",
		);
	});

	test("keeps right-to-left text and unescapes entities", () => {
		const tree = parseHierarchy(sample("uia-login-ar.xml"));
		expect(findByLabel(tree, "ما بريدك الإلكتروني؟").length).toBe(1);
		const field = tree.nodes.find((node) => node.className === "android.widget.EditText");
		expect(field?.contentDesc).toBe("البريد الإلكتروني");
		const escaped = parseHierarchy(
			`<?xml version='1.0' ?><hierarchy rotation="1"><node index="0" text="a &amp; b &lt;c&gt; &quot;d&quot; &#128512; &#x41;" resource-id="" class="x" package="p" content-desc="" checkable="false" checked="false" clickable="true" enabled="false" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[1,2][11,22]" /></hierarchy>`,
		);
		expect(escaped.rotation).toBe(1);
		expect(escaped.nodes[0]?.text).toBe('a & b <c> "d" 😀 A');
		expect(escaped.nodes[0]?.enabled).toBe(false);
		expect(escaped.nodes[0]?.bounds).toEqual({ x: 1, y: 2, width: 10, height: 20 });
	});

	test("reports a negative extent for a node scrolled partly out of its container", () => {
		const tree = parseHierarchy(sample("uia-screens-tabs.xml"));
		const clipped = tree.nodes.filter((node) => node.bounds.height < 0);
		expect(clipped.some((node) => node.text === "Home row 14")).toBe(true);
	});

	test("descendants lists a subtree in order", () => {
		const tree = parseHierarchy(sample("uia-startup-loading.xml"));
		const bar = tree.nodes.find((node) => node.className === "android.widget.ProgressBar");
		expect(bar?.contentDesc).toBe("Loading…");
		const scroll = tree.nodes.find((node) => node.className === "android.widget.ScrollView");
		expect(
			descendants(scroll as NonNullable<typeof scroll>).map(
				(node) => node.text || node.contentDesc,
			),
		).toContain("Rasheed");
	});

	test("refuses a dump it cannot read completely", () => {
		expect(() => parseHierarchy("<node />")).toThrow("no <hierarchy>");
		expect(() =>
			parseHierarchy('<hierarchy rotation="0"><node bounds="[0,0][1,1]"></hierarchy>'),
		).toThrow("never closed");
		expect(() => parseHierarchy('<hierarchy rotation="0"></node></hierarchy>')).toThrow(
			"unbalanced",
		);
	});
});
