// Renders the guide (the Markdown files of ../../docs) to HTML at build time, and checks every link between the pages.
//
// docs/<NN-section>/index.md        frontmatter only: title, and optionally area, icon and description
// docs/<NN-section>/<NN-slug>.md    a page: frontmatter with its title, then Markdown without a level-one heading
//
// The numbers order the sections and the pages; the slug is the URL, /docs/<slug>, so slugs are unique across sections.
// The README of this app lists the frontmatter keys and the Markdown the renderer understands.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import Check from "@lucide/svelte/icons/check";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleX from "@lucide/svelte/icons/circle-x";
import Copy from "@lucide/svelte/icons/copy";
import FileCode from "@lucide/svelte/icons/file-code";
import Info from "@lucide/svelte/icons/info";
import LinkIcon from "@lucide/svelte/icons/link";
import TerminalIcon from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Lexer, Marked, type Token, type Tokens } from "marked";
import { createHighlighter, type ShikiTransformer } from "shiki";
import { render as renderComponent } from "svelte/server";

import { BASE, SITE_URL } from "./base-path";
import { areaIcons, type Icon, sectionIcons } from "./icons";
import { REPOSITORY } from "./site";
import { hasPrompt, PACKAGE_MANAGERS, terminalVariants } from "./terminal";

export { REPOSITORY };

export type Platform = "android" | "ios";
export type Heading = { id: string; text: string; depth: 2 | 3 };
export type PageLink = { slug: string; title: string; section: string };
/** What the sidebar shows of a page. */
export type NavPage = { slug: string; title: string };
/** Pages that share a `group:` in their frontmatter: a collapsible group of the sidebar. */
export type NavGroup = { title: string; pages: NavPage[] };
export type NavSection = { id: string; title: string; description: string; icon: string; items: (NavPage | NavGroup)[]; first: NavPage };
/** The sections that share an `area:`: one link at the top of the sidebar, and the tree it shows. */
export type NavArea = { id: string; title: string; icon: string; sections: NavSection[]; first: NavPage };
export type VideoSource = { platform: Platform; src: string; poster?: string };
export type Page = PageLink & {
	area: string;
	html: string;
	headings: Heading[];
	/** The repository path of the Markdown file. */
	source: string;
	/** The description as inline HTML, and as plain text. */
	description?: { html: string; text: string };
	platforms: Platform[];
	/** The feature video of the page: only the platforms whose file exists. */
	video?: { title: string; sources: VideoSource[] };
	updated?: { iso: string; label: string };
	/** The page's absolute address, when SITE_URL says where the site is. */
	canonical?: string;
};

type File = {
	dir: string;
	order: number;
	slug: string;
	path: string;
	title: string;
	description?: string;
	platforms: Platform[];
	video?: string;
	group?: string;
	body: string;
};
type SectionMeta = { title: string; order: number; area: string; icon: string; description: string };
type Rendered = PageLink & {
	file: File;
	html: string;
	headings: Heading[];
	description?: { html: string; text: string };
	anchors: Set<string>;
	links: { slug: string; hash: string; from: string }[];
};

const sources = import.meta.glob("../../../../docs/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const LANGUAGES = ["sh", "svelte", "ts", "js", "json", "yaml", "kotlin", "css", "html"];
const highlighter = await createHighlighter({ themes: ["github-light", "github-dark"], langs: LANGUAGES });

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A Lucide icon as an inline SVG string, for the HTML the Markdown renders to. */
function svg(icon: Icon, className: string, size = 16) {
	return renderComponent(icon, { props: { size, class: className } }).body.replace(/<!--[\s\S]*?-->/g, "");
}

const icons = {
	copy: svg(Copy, "i-copy", 14),
	check: svg(Check, "i-check", 14),
	file: svg(FileCode, "i-file", 14),
	terminal: svg(TerminalIcon, "i-terminal", 14),
	link: svg(LinkIcon, "i-link", 14),
};

/** The id GitHub gives a heading, which is what the links in the guide use. */
function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.trim()
		.replace(/\s/g, "-");
}

const decodeEntities = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name] ?? "");

/** The text of inline tokens, as a reader sees it: no emphasis marks, link targets, code ticks or backslash escapes. */
function inlineText(tokens: Token[] | undefined): string {
	return (tokens ?? [])
		.map((token) => {
			if (token.type === "html") return "";
			if (token.type === "br") return " ";
			if (token.type === "codespan" || token.type === "escape") return token.text;
			if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
			return decodeEntities(token.type === "text" ? token.text : (token.raw ?? ""));
		})
		.join("");
}

const plainText = (markdown: string) => inlineText(Lexer.lexInline(markdown));

const CALLOUTS: Record<string, { icon: Icon; label: string }> = {
	info: { icon: Info, label: "Note" },
	warning: { icon: TriangleAlert, label: "Warning" },
	important: { icon: CircleAlert, label: "Important" },
	success: { icon: CircleCheck, label: "Tip" },
	error: { icon: CircleX, label: "Caution" },
};
const isCallout = (name: string) => Object.hasOwn(CALLOUTS, name);
const CALLOUT_ICONS = Object.fromEntries(Object.entries(CALLOUTS).map(([kind, { icon }]) => [kind, svg(icon, "i-callout", 16)]));
/** GitHub's `> [!NOTE]` alerts map onto the same five callouts as `> **info**`. */
const GITHUB_ALERT = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\][ \t]*\n?/i;
const GITHUB_ALERT_KIND: Record<string, string> = { NOTE: "info", TIP: "success", WARNING: "warning", IMPORTANT: "important", CAUTION: "error" };

const FILE_NAME = /^(?:<!---\s*file:\s*(.+?)\s*--->|\/\/\/\s*file:\s*(.+?)\s*)$/;
const NUMBERED = /^(\d+)-([a-z0-9-]+)$/;
const SLUG_LINK = /^([a-z0-9-]+)(?:#(.+))?$/;

const copyButton = `<button type="button" class="copy" data-copy>${icons.copy}${icons.check}<span class="copy-label" aria-live="polite">Copy</span></button>`;

/** The colours of GitHub's themes that are under 4.5:1 on the code background at 12px (the light orange, red and green, the dark comments), each replaced by the next shade of its own hue that reaches it. */
const COLOR_REPLACEMENTS = {
	"github-light": { "#d73a49": "#cf222e", "#e36209": "#bc4c00", "#22863a": "#1a7f37" },
	"github-dark": { "#6a737d": "#8b949e" },
};

function highlight(code: string, language: string, transformers: ShikiTransformer[] = []) {
	return highlighter.codeToHtml(code, { lang: language, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false, colorReplacements: COLOR_REPLACEMENTS, transformers });
}

function codeBlock(code: string, lang: string, name: string) {
	const language = highlighter.getLoadedLanguages().includes(lang) ? lang : "text";
	const html = highlight(code, language);
	if (name) {
		return `<figure class="code"><figcaption class="code-head" data-pagefind-ignore>${icons.file}<span class="code-title">${escapeHtml(name)}</span>${copyButton}</figcaption>${html}</figure>\n`;
	}
	const label = language === "text" ? "" : `<span class="code-lang">${escapeHtml(language)}</span>`;
	return `<figure class="code"><div class="code-tools" data-pagefind-ignore>${label}${copyButton}</div>${html}</figure>\n`;
}

/** A terminal: dark in both themes, with a tab for each package manager when it has a command to translate. Which tab is selected and which block shows is the CSS of <html class="pm-pnpm"> (see app.html), so every terminal on the page agrees and nothing flashes. */
function terminalBlock(source: string) {
	const { variants, switchable } = terminalVariants(source);
	// Pagefind reads npm's spelling of the commands, once: the other three are the same text with another word in front.
	const block = (managers: string, code: string) => {
		const lines = code.split("\n");
		const html = highlight(code, "sh", [
			{
				line(node, line) {
					if (hasPrompt(lines[line - 1] ?? "")) this.addClassToHast(node, "cmd");
				},
			},
		]);
		return `<div data-pm-block="${managers}"${switchable && managers !== "npm" ? " data-pagefind-ignore" : ""}>${html}</div>`;
	};
	const tabs = switchable ? `<div class="pm-tabs" role="group" aria-label="Package manager">${PACKAGE_MANAGERS.map((manager) => `<button type="button" data-pm="${manager}" aria-pressed="false">${manager}</button>`).join("")}</div>` : "";
	const blocks = switchable ? PACKAGE_MANAGERS.map((manager) => block(manager, variants[manager])) : [block(PACKAGE_MANAGERS.join(" "), source.replace(/\n+$/, ""))];
	return `<div class="terminal" data-terminal><div class="terminal-head" data-pagefind-ignore><span class="terminal-title">${icons.terminal}Terminal</span>${tabs}${copyButton}</div><div class="terminal-body">${blocks.join("")}</div></div>\n`;
}

function frontmatter(markdown: string, path: string, allowed: string[]) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
	if (!match) throw new Error(`${path}: a page starts with frontmatter, ---\\ntitle: ...\\n---`);
	const data: Record<string, string | string[]> = {};
	const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2");
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim()) continue;
		const field = /^([a-z][a-z-]*):[ \t]*(.*?)[ \t]*$/.exec(line);
		if (!field) throw new Error(`${path}: the frontmatter line "${line}" is not "key: value"`);
		const [, key, value] = field;
		if (!allowed.includes(key)) throw new Error(`${path}: the frontmatter key "${key}" is not one of ${allowed.join(", ")}`);
		data[key] = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1).split(",").map((item) => unquote(item.trim())).filter(Boolean) : unquote(value);
	}
	const text = (key: string) => {
		const value = data[key];
		if (value !== undefined && typeof value !== "string") throw new Error(`${path}: "${key}" is a single value, not a list`);
		return value;
	};
	const title = text("title");
	if (!title) throw new Error(`${path}: the frontmatter has no title`);
	return { title, text, list: (key: string) => (data[key] === undefined ? undefined : ([] as string[]).concat(data[key])), body: markdown.slice(match[0].length) };
}

function files() {
	const sections = new Map<string, SectionMeta>();
	const pages: (File & { sectionOrder: number })[] = [];
	for (const [key, markdown] of Object.entries(sources)) {
		const path = key.slice(key.indexOf("/docs/") + 1);
		const parts = path.split("/").slice(1);
		if (parts.length !== 2) throw new Error(`${path}: a page lives in a section directory, docs/<number>-<section>/<number>-<slug>.md`);
		const [directory, name] = parts;
		const section = NUMBERED.exec(directory);
		if (!section) throw new Error(`${path}: a section directory is named <number>-<name>`);
		if (name === "index.md") {
			const meta = frontmatter(markdown, path, ["title", "area", "icon", "description"]);
			const icon = meta.text("icon") ?? "book-open";
			if (!(icon in sectionIcons)) throw new Error(`${path}: the icon "${icon}" is not one of ${Object.keys(sectionIcons).join(", ")}`);
			sections.set(directory, { title: meta.title, order: Number(section[1]), area: meta.text("area") ?? "Guide", icon, description: meta.text("description") ?? "" });
			continue;
		}
		const page = NUMBERED.exec(name.replace(/\.md$/, ""));
		if (!page || !name.endsWith(".md")) throw new Error(`${path}: a page is named <number>-<slug>.md`);
		const meta = frontmatter(markdown, path, ["title", "description", "platforms", "video", "group"]);
		const platforms = meta.list("platforms") ?? ["android", "ios"];
		for (const platform of platforms) if (platform !== "android" && platform !== "ios") throw new Error(`${path}: the platform "${platform}" is not android or ios`);
		const video = meta.text("video");
		if (video !== undefined && !/^[a-z0-9-]+$/.test(video)) throw new Error(`${path}: video: ${video} is a file name without the platform and the extension: list for list-ios.mp4 and list-android.mp4`);
		pages.push({
			dir: directory,
			sectionOrder: Number(section[1]),
			order: Number(page[1]),
			slug: page[2],
			path,
			title: meta.title,
			description: meta.text("description"),
			platforms: [...new Set(platforms)].sort() as Platform[],
			video,
			group: meta.text("group"),
			body: meta.body,
		});
	}
	const seen = new Map<string, string>();
	for (const page of pages) {
		const other = seen.get(page.slug);
		if (other) throw new Error(`${page.path} and ${other} have the same slug, ${page.slug}`);
		seen.set(page.slug, page.path);
	}
	pages.sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
	for (const page of pages) if (!sections.has(page.dir)) throw new Error(`docs/${page.dir}: the section has no index.md with its title`);
	/** The section of a page: every page has one, which the check above makes sure of. */
	const sectionOf = (dir: string): SectionMeta => sections.get(dir) ?? { title: dir, order: 0, area: "Guide", icon: "book-open", description: "" };
	return { pages, sections, sectionOf };
}

function render(file: File, section: string): Rendered {
	const headings: Heading[] = [];
	const anchors = new Set<string>();
	const links: Rendered["links"] = [];
	/** The ids taken: the page's own (a heading is never named like these) and the title's. A heading's id is the first free one of its slug, slug-1, slug-2. */
	const used = new Set(["top", "main", "mobile-menu", "search-results"]);
	const uniqueId = (slug: string) => {
		const base = slug || "section";
		let id = base;
		for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		return id;
	};
	/** An image under the site's root, /images/screen.png, is a file of static/. */
	const src = (href: string) => (href.startsWith("/") ? `${BASE}${href}` : href);

	const marked = new Marked({
		renderer: {
			heading({ tokens, depth, text }) {
				if (depth === 1) throw new Error(`${file.path}: "# ${text}": the title comes from the frontmatter; start the sections at ##`);
				const plain = inlineText(tokens);
				const id = uniqueId(slugify(plain));
				anchors.add(id);
				if (depth === 2 || depth === 3) headings.push({ id, text: plain, depth });
				const inner = this.parser.parseInline(tokens);
				return `<h${depth} id="${id}">${inner}<a class="permalink" href="#${id}" aria-label="Link to this section">${icons.link}</a></h${depth}>\n`;
			},
			code({ text, lang }) {
				const [language = "", ...flags] = (lang ?? "").trim().split(/\s+/);
				if (language === "terminal" || flags.includes("terminal")) return terminalBlock(text);
				let code = text;
				let name = "";
				const [first, ...rest] = code.split("\n");
				const match = FILE_NAME.exec(first);
				if (match) {
					name = match[1] ?? match[2];
					code = rest.join("\n");
				}
				return codeBlock(code, language, name);
			},
			blockquote({ tokens }) {
				const first = tokens[0];
				let kind: string | undefined;
				if (first?.type === "paragraph") {
					const inline = (first as Tokens.Paragraph).tokens;
					const head = inline[0];
					const alert = GITHUB_ALERT.exec(first.text)?.[1];
					if (head?.type === "strong" && isCallout(head.text.toLowerCase())) {
						// > **warning** text
						kind = head.text.toLowerCase();
						inline.shift();
						const next = inline[0];
						if (next?.type === "text") next.text = next.text.replace(/^\s+/, "");
					} else if (alert) {
						// > [!NOTE] text
						kind = GITHUB_ALERT_KIND[alert.toUpperCase()];
						if (head?.type === "text") head.text = head.text.replace(GITHUB_ALERT, "");
					}
					if (kind && !inline.length) tokens.shift();
				}
				if (!kind) return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
				return `<aside class="callout callout-${kind}"><span class="callout-icon">${CALLOUT_ICONS[kind]}</span><div class="callout-body"><span class="sr-only">${CALLOUTS[kind].label}: </span>${this.parser.parse(tokens)}</div></aside>\n`;
			},
			paragraph({ tokens }) {
				// A paragraph that is only an image is a figure: ![Alt text](/images/screen.png "The caption")
				const [image] = tokens;
				if (tokens.length === 1 && image.type === "image") {
					const caption = image.title ? `<figcaption>${escapeHtml(image.title)}</figcaption>` : "";
					return `<figure class="media"><img src="${escapeHtml(src(image.href))}" alt="${escapeHtml(image.text)}" loading="lazy" decoding="async" />${caption}</figure>\n`;
				}
				return `<p>${this.parser.parseInline(tokens)}</p>\n`;
			},
			image({ href, text }) {
				return `<img src="${escapeHtml(src(href))}" alt="${escapeHtml(text)}" loading="lazy" decoding="async" />`;
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

	// The description is the frontmatter's, or the page's first paragraph when it stands alone (not one that leads into a list or a code block with a colon).
	const tokens = marked.lexer(file.body);
	let description = file.description;
	if (!description) {
		const index = tokens.findIndex((token) => token.type !== "space");
		const token = tokens[index];
		if (token?.type === "paragraph" && !token.text.trimEnd().endsWith(":")) {
			description = token.text;
			tokens.splice(index, 1);
		}
	}

	const html = marked.parser(tokens).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
	const described = description ? { html: marked.parseInline(description, { async: false }), text: plainText(description) } : undefined;
	return { slug: file.slug, title: file.title, section, html, headings, description: described, anchors, links, file };
}

let cache: { pages: Map<string, Rendered>; sections: Map<string, SectionMeta>; sectionOf: (dir: string) => SectionMeta } | undefined;

/** Every page, rendered once. Throws, so that the build fails, when a link between pages leads to a page or a heading that does not exist. */
function all() {
	if (cache) return cache;
	const { pages: list, sections, sectionOf } = files();
	const pages = new Map(list.map((file) => [file.slug, render(file, sectionOf(file.dir).title)]));
	const problems: string[] = [];
	for (const page of pages.values()) {
		for (const { slug, hash, from } of page.links) {
			const target = pages.get(slug);
			if (!target) problems.push(`${from}: (${slug}${hash ? `#${hash}` : ""}): there is no page ${slug}`);
			else if (hash && !target.anchors.has(hash)) problems.push(`${from}: (${slug}#${hash}): ${target.file.path} has no heading with the id ${hash}`);
		}
	}
	if (problems.length) throw new Error(`Broken links in the guide:\n${problems.map((p) => `  ${p}`).join("\n")}`);
	cache = { pages, sections, sectionOf };
	return cache;
}

export function pageList(): PageLink[] {
	return [...all().pages.values()].map(({ slug, title, section }) => ({ slug, title, section }));
}

const areaId = (title: string) => slugify(title);

let navigationCache: NavArea[] | undefined;

/** The areas, their sections and the sections' pages, as the sidebar and the landing page show them. */
export function navigation(): NavArea[] {
	if (navigationCache) return navigationCache;
	const { pages, sections } = all();
	const areas = new Map<string, NavArea>();
	const navSections = new Map<string, NavSection>();
	for (const [dir, meta] of [...sections].sort((a, b) => a[1].order - b[1].order)) {
		const section: NavSection = { id: dir, title: meta.title, description: meta.description, icon: meta.icon, items: [], first: undefined as unknown as NavPage };
		navSections.set(dir, section);
		const id = areaId(meta.area);
		const area = areas.get(id) ?? { id, title: meta.area, icon: areaIcons[id] ?? "book-open", sections: [], first: undefined as unknown as NavPage };
		area.sections.push(section);
		areas.set(id, area);
	}
	for (const { file } of pages.values()) {
		const section = navSections.get(file.dir);
		if (!section) continue;
		const page = { slug: file.slug, title: file.title };
		section.first ??= page;
		const last = section.items.at(-1);
		if (!file.group) section.items.push(page);
		else if (last && "pages" in last && last.title === file.group) last.pages.push(page);
		else if (section.items.some((item) => "pages" in item && item.title === file.group)) throw new Error(`${file.path}: the pages of the group "${file.group}" are not next to each other, so their numbers must be`);
		else section.items.push({ title: file.group, pages: [page] });
	}
	for (const area of areas.values()) {
		area.sections = area.sections.filter((section) => section.first);
		area.first = area.sections[0]?.first;
	}
	navigationCache = [...areas.values()].filter((area) => area.first);
	return navigationCache;
}

// The feature videos are static/videos/<slug>-ios.mp4 and <slug>-android.mp4, each with an optional .jpg poster. A platform whose file is not there is left out.
const VIDEOS = resolvePath(process.cwd(), "static/videos");
function videoOf(file: File): Page["video"] {
	if (!file.video) return undefined;
	const sources: VideoSource[] = [];
	for (const platform of ["android", "ios"] as const) {
		if (!existsSync(resolvePath(VIDEOS, `${file.video}-${platform}.mp4`))) continue;
		const poster = existsSync(resolvePath(VIDEOS, `${file.video}-${platform}.jpg`)) ? `${BASE}/videos/${file.video}-${platform}.jpg` : undefined;
		sources.push({ platform, src: `${BASE}/videos/${file.video}-${platform}.mp4`, poster });
	}
	return sources.length ? { title: file.title, sources } : undefined;
}

// The date of a page's last commit. Without git, or for a file that is not committed yet, there is no date, and the page says nothing.
let repositoryRoot: string | null | undefined;
function updatedOf(path: string): Page["updated"] {
	if (repositoryRoot === null) return undefined;
	try {
		const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		repositoryRoot ??= git(["rev-parse", "--show-toplevel"], process.cwd());
		const iso = git(["log", "-1", "--format=%cI", "--", path], repositoryRoot);
		if (!iso) return undefined;
		return { iso, label: new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) };
	} catch {
		repositoryRoot = null;
		return undefined;
	}
}

export function getPage(slug: string): Page | undefined {
	const { pages, sectionOf } = all();
	const page = pages.get(slug);
	if (!page) return undefined;
	const { file } = page;
	return {
		slug: page.slug,
		title: page.title,
		section: page.section,
		area: areaId(sectionOf(file.dir).area),
		html: page.html,
		headings: page.headings,
		source: file.path,
		description: page.description,
		platforms: file.platforms,
		video: videoOf(file),
		updated: updatedOf(file.path),
		canonical: SITE_URL ? `${SITE_URL}/docs/${slug}` : undefined,
	};
}

/** `[page](slug#heading)` is how the guide links to a page; in the Markdown a program reads, it is the page's .md file. */
function rewriteLinks(markdown: string) {
	return markdown
		.split(/(^```[\s\S]*?^```)/m)
		.map((part, index) => (index % 2 ? part : part.replace(/\]\(([a-z0-9-]+)(#[^)\s]*)?\)/g, (_, slug: string, hash = "") => `](${slug}.md${hash})`)))
		.join("");
}

/** The page as Markdown, for the "Copy page" menu and the .md files next to the pages. */
export function getMarkdown(slug: string): string | undefined {
	const page = all().pages.get(slug);
	if (!page) return undefined;
	const { file } = page;
	return `# ${file.title}\n\n${file.description ? `${rewriteLinks(file.description)}\n\n` : ""}${rewriteLinks(file.body).trim()}\n`;
}

/** llms.txt: the guide's pages, and where to read each one as Markdown (https://llmstxt.org). */
export function getLlmsTxt(): string {
	const lines = ["# Expo Svelte", "", "> Svelte 5 on React Native Fabric, with no React: write Android and iOS apps as Svelte components. This is its guide. Every page is also available as Markdown, at the address listed.", ""];
	/** A page's Markdown file: an absolute address with SITE_URL, a path without. */
	const where = (slug: string) => `${SITE_URL || BASE}/docs/${slug}.md`;
	let section = "";
	for (const page of all().pages.values()) {
		if (page.section !== section) {
			if (section) lines.push("");
			section = page.section;
			lines.push(`## ${section}`, "");
		}
		const summary = page.description?.text.replace(/\s+/g, " ");
		const short = summary && summary.length > 160 ? `${summary.slice(0, summary.lastIndexOf(" ", 157))}...` : summary;
		lines.push(`- [${page.title}](${where(page.slug)})${short ? `: ${short}` : ""}`);
	}
	return `${lines.join("\n")}\n`;
}

/** A code block as the guide's pages render it, for the landing page. */
export function renderCode(code: string, lang: string, name: string) {
	return codeBlock(code, lang, name);
}
