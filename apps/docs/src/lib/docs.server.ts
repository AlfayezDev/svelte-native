// Renders the guide (the Markdown files of ../../docs) to HTML at build time, and checks every link between the pages.
//
// docs/<NN-section>/index.md        frontmatter only: the section's title
// docs/<NN-section>/<NN-slug>.md    a page: frontmatter with its title, then Markdown without a level-one heading
//
// The numbers order the sections and the pages; the slug is the URL, /docs/<slug>, so slugs are unique across sections.
import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";

import { BASE } from "./base-path";
import { REPOSITORY } from "./site";

export { REPOSITORY };

export type Heading = { id: string; text: string; depth: 2 | 3 };
export type PageLink = { slug: string; title: string; section: string };
export type Section = { title: string; pages: PageLink[] };
export type Page = PageLink & { html: string; headings: Heading[]; source: string };
/** One entry of the search index: a page, or a heading of one. */
export type SearchEntry = { href: string; title: string; page: string; section: string };

type File = { section: string; sectionOrder: number; order: number; slug: string; path: string; title: string; body: string };
type Rendered = Page & { anchors: Set<string>; links: { slug: string; hash: string; from: string }[] };

const sources = import.meta.glob("../../../../docs/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

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
const NUMBERED = /^(\d+)-([a-z0-9-]+)$/;
const SLUG_LINK = /^([a-z0-9-]+)(?:#(.+))?$/;

function frontmatter(markdown: string, path: string) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
	if (!match) throw new Error(`${path}: a page starts with frontmatter, ---\\ntitle: ...\\n---`);
	const title = /^title:[ \t]*(.+?)[ \t]*$/m.exec(match[1])?.[1].replace(/^(["'])(.*)\1$/, "$2");
	if (!title) throw new Error(`${path}: the frontmatter has no title`);
	return { title, body: markdown.slice(match[0].length) };
}

function files() {
	const sections = new Map<string, { title: string; order: number }>();
	const pages: File[] = [];
	for (const [key, markdown] of Object.entries(sources)) {
		const path = key.slice(key.indexOf("/docs/") + 1);
		const parts = path.split("/").slice(1);
		if (parts.length !== 2) throw new Error(`${path}: a page lives in a section directory, docs/<number>-<section>/<number>-<slug>.md`);
		const [directory, name] = parts;
		const section = NUMBERED.exec(directory);
		if (!section) throw new Error(`${path}: a section directory is named <number>-<name>`);
		const { title, body } = frontmatter(markdown, path);
		if (name === "index.md") {
			sections.set(directory, { title, order: Number(section[1]) });
			continue;
		}
		const page = NUMBERED.exec(name.replace(/\.md$/, ""));
		if (!page || !name.endsWith(".md")) throw new Error(`${path}: a page is named <number>-<slug>.md`);
		pages.push({ section: directory, sectionOrder: Number(section[1]), order: Number(page[1]), slug: page[2], path, title, body });
	}
	const seen = new Map<string, string>();
	for (const page of pages) {
		const other = seen.get(page.slug);
		if (other) throw new Error(`${page.path} and ${other} have the same slug, ${page.slug}`);
		seen.set(page.slug, page.path);
	}
	pages.sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
	return pages.map((page) => {
		const section = sections.get(page.section);
		if (!section) throw new Error(`docs/${page.section}: the section has no index.md with its title`);
		return { ...page, section: section.title };
	});
}

function render(file: File): Rendered {
	const headings: Heading[] = [];
	const anchors = new Set<string>();
	const links: Rendered["links"] = [];
	const seen = new Map<string, number>();

	const marked = new Marked({
		renderer: {
			heading({ tokens, depth, text }) {
				if (depth === 1) throw new Error(`${file.path}: "# ${text}": the title comes from the frontmatter; start the sections at ##`);
				const plain = plainText(text);
				let id = slugify(plain);
				const count = seen.get(id) ?? 0;
				seen.set(id, count + 1);
				if (count) id = `${id}-${count}`;
				anchors.add(id);
				if (depth === 2 || depth === 3) headings.push({ id, text: plain, depth });
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
				if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<a href="${escapeHtml(href)}"${attrs} rel="noreferrer">${inner}</a>`;
				if (href.startsWith("#")) {
					links.push({ slug: file.slug, hash: href.slice(1), from: file.path });
					return `<a href="${escapeHtml(href)}"${attrs}>${inner}</a>`;
				}
				const match = SLUG_LINK.exec(href);
				if (!match) throw new Error(`${file.path}: (${href}): link to a page by its slug, (routing) or (routing#navigators); the guide does not link into the repository`);
				const [, slug, hash = ""] = match;
				links.push({ slug, hash, from: file.path });
				return `<a href="${escapeHtml(`${BASE}/docs/${slug}${hash ? `#${hash}` : ""}`)}"${attrs}>${inner}</a>`;
			},
		},
	});

	const html = (marked.parse(file.body, { async: false }) as string).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
	return { slug: file.slug, title: file.title, section: file.section, source: file.path, html, headings, anchors, links };
}

let cache: Map<string, Rendered> | undefined;

/** Every page, rendered once. Throws, so that the build fails, when a link between pages leads to a page or a heading that does not exist. */
function all() {
	if (cache) return cache;
	const pages = new Map(files().map((file) => [file.slug, render(file)]));
	const problems: string[] = [];
	for (const page of pages.values()) {
		for (const { slug, hash, from } of page.links) {
			const target = pages.get(slug);
			if (!target) problems.push(`${from}: (${slug}${hash ? `#${hash}` : ""}): there is no page ${slug}`);
			else if (hash && !target.anchors.has(hash)) problems.push(`${from}: (${slug}#${hash}): ${target.source} has no heading with the id ${hash}`);
		}
	}
	if (problems.length) throw new Error(`Broken links in the guide:\n${problems.map((p) => `  ${p}`).join("\n")}`);
	cache = pages;
	return pages;
}

export function pageList(): PageLink[] {
	return [...all().values()].map(({ slug, title, section }) => ({ slug, title, section }));
}

export function sections(): Section[] {
	const result: Section[] = [];
	for (const page of pageList()) {
		const last = result.at(-1);
		if (last?.title === page.section) last.pages.push(page);
		else result.push({ title: page.section, pages: [page] });
	}
	return result;
}

export function getPage(slug: string): Page | undefined {
	const page = all().get(slug);
	return page && { slug: page.slug, title: page.title, section: page.section, source: page.source, html: page.html, headings: page.headings };
}

export function searchIndex(): SearchEntry[] {
	return [...all().values()].flatMap((page) => [
		{ href: `${BASE}/docs/${page.slug}`, title: page.title, page: page.title, section: page.section },
		...page.headings.map((heading) => ({ href: `${BASE}/docs/${page.slug}#${heading.id}`, title: heading.text, page: page.title, section: page.section })),
	]);
}
