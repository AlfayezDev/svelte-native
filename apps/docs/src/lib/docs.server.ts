// Renders the guide (the Markdown files of ../../docs) to HTML at build time, and checks every link between the pages.
import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";

import { BASE } from "./base-path";
import { REPOSITORY } from "./site";

export { REPOSITORY };

export type Heading = { id: string; text: string };
export type Page = { slug: string; title: string; html: string; headings: Heading[] };
export type PageLink = { slug: string; title: string };

type Rendered = Page & { anchors: Set<string>; links: { href: string; from: string }[] };

const sources = import.meta.glob("../../../../docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const highlighter = await createHighlighter({
	themes: ["github-light", "github-dark"],
	langs: ["sh", "svelte", "ts", "js", "json", "yaml", "kotlin"],
});

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The id GitHub gives a heading, which is what the links in the guide use. */
function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.trim()
		.replace(/\s/g, "-");
}

const plainText = (markdown: string) =>
	markdown
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*]/g, "")
		.replace(/(^|\s)_|_(\s|$)/g, "$1$2");

const CALLOUT = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\][ \t]*\n?/i;
const FILE_NAME = /^(?:<!---\s*file:\s*(.+?)\s*--->|\/\/\/\s*file:\s*(.+?)\s*)$/;

function pageFiles() {
	return Object.entries(sources)
		.map(([path, markdown]) => {
			const name = path.slice(path.lastIndexOf("/") + 1);
			const match = /^(\d+)-(.+)\.md$/.exec(name);
			if (!match) throw new Error(`docs/${name}: pages are named <number>-<slug>.md`);
			return { order: Number(match[1]), slug: match[2], name, markdown };
		})
		.sort((a, b) => a.order - b.order);
}

function render(file: ReturnType<typeof pageFiles>[number], slugByFile: Map<string, string>): Rendered {
	const headings: Heading[] = [];
	const anchors = new Set<string>();
	const links: Rendered["links"] = [];
	const seen = new Map<string, number>();
	let title = file.slug;

	const marked = new Marked({
		renderer: {
			heading({ tokens, depth, text }) {
				const plain = plainText(text);
				let id = slugify(plain);
				const count = seen.get(id) ?? 0;
				seen.set(id, count + 1);
				if (count) id = `${id}-${count}`;
				anchors.add(id);
				if (depth === 1) title = plain;
				if (depth === 2) headings.push({ id, text: plain });
				const inner = this.parser.parseInline(tokens);
				return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section"></a></h${depth}>\n`;
			},
			code({ text, lang }) {
				let code = text;
				let name = "";
				const [first, ...rest] = code.split("\n");
				const match = FILE_NAME.exec(first);
				if (match) {
					name = match[1] ?? match[2];
					code = rest.join("\n");
				}
				const language = lang && highlighter.getLoadedLanguages().includes(lang) ? lang : "text";
				const html = highlighter.codeToHtml(code, { lang: language, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
				const caption = name ? `<figcaption>${escapeHtml(name)}</figcaption>` : "";
				return `<figure class="code">${caption}${html}</figure>\n`;
			},
			blockquote({ tokens }) {
				const first = tokens[0];
				if (first?.type === "paragraph") {
					const kind = CALLOUT.exec(first.text)?.[1];
					if (kind) {
						first.text = first.text.replace(CALLOUT, "");
						const inline = (first as Tokens.Paragraph).tokens[0];
						if (inline?.type === "text") inline.text = inline.text.replace(CALLOUT, "");
						const label = kind[0].toUpperCase() + kind.slice(1).toLowerCase();
						return `<aside class="callout ${kind.toLowerCase()}"><p class="callout-title">${label}</p>${this.parser.parse(tokens)}</aside>\n`;
					}
				}
				return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
			},
			link({ href, title: hint, tokens }) {
				const inner = this.parser.parseInline(tokens);
				const attrs = hint ? ` title="${escapeHtml(hint)}"` : "";
				let target = href;
				if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
					return `<a href="${escapeHtml(href)}"${attrs} rel="noreferrer">${inner}</a>`;
				}
				if (href.startsWith("#")) {
					links.push({ href, from: file.name });
				} else if (href.startsWith("../")) {
					// A link into the repository (the guide sits in docs/, one level below the root).
					target = `${REPOSITORY}/blob/main/${href.slice(3)}`;
				} else {
					const [name, hash] = href.split("#");
					const slug = slugByFile.get(name);
					if (!slug) {
						links.push({ href, from: file.name });
						return `<a href="${escapeHtml(href)}">${inner}</a>`;
					}
					links.push({ href, from: file.name });
					target = `${BASE}/docs/${slug}${hash ? `#${hash}` : ""}`;
				}
				return `<a href="${escapeHtml(target)}"${attrs}>${inner}</a>`;
			},
		},
	});

	const html = (marked.parse(file.markdown, { async: false }) as string).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
	return { slug: file.slug, title, html, headings, anchors, links };
}

let cache: Map<string, Rendered> | undefined;

/** Every page, rendered once. Throws, so that the build fails, when a link between pages leads to a page or a heading that does not exist. */
function all() {
	if (cache) return cache;
	const files = pageFiles();
	const slugByFile = new Map(files.map((file) => [file.name, file.slug]));
	const pages = new Map(files.map((file) => [file.slug, render(file, slugByFile)]));
	const problems: string[] = [];
	for (const page of pages.values()) {
		for (const { href, from } of page.links) {
			if (href.startsWith("#")) {
				if (!page.anchors.has(href.slice(1))) problems.push(`docs/${from}: ${href} is not a heading of this page`);
				continue;
			}
			const [name, hash] = href.split("#");
			const slug = slugByFile.get(name);
			if (!slug) problems.push(`docs/${from}: ${href} is not a page`);
			else if (hash && !pages.get(slug)?.anchors.has(hash)) problems.push(`docs/${from}: ${href}: no heading "${hash}" in ${name}`);
		}
	}
	if (problems.length) throw new Error(`Broken links in the guide:\n${problems.map((p) => `  ${p}`).join("\n")}`);
	cache = pages;
	return pages;
}

export function pageList(): PageLink[] {
	return [...all().values()].map(({ slug, title }) => ({ slug, title }));
}

export function getPage(slug: string): Page | undefined {
	const page = all().get(slug);
	return page && { slug: page.slug, title: page.title, html: page.html, headings: page.headings };
}
