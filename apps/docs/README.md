# Svelte Native documentation site

A static SvelteKit app (`@sveltejs/adapter-static`, every page prerendered) that renders the guide in [`docs/`](../../docs). The Markdown files there are the single source of truth: this app reads them at build time and does not copy them.

## Run it

From the repository root, after `pnpm install`:

```sh
pnpm --dir apps/docs dev       # development server with hot reload
pnpm --dir apps/docs build     # prerender the site to apps/docs/build, then index it for the search
pnpm --dir apps/docs preview   # serve apps/docs/build, with the search
pnpm --dir apps/docs check     # svelte-check
pnpm --dir apps/docs test      # the package manager commands of the terminal blocks (bun test)
```

`pnpm lint` and `pnpm typecheck` at the root include this app.

## Add a page

The guide is organised in sections, as SvelteKit's is:

```tree
docs/
├ 10-getting-started/
│ ├ index.md                 ---\ntitle: Getting started\n---
│ ├ 10-introduction.md
│ └ 20-creating-a-project.md
├ 20-core-concepts/
…
```

- A section is a directory `docs/<number>-<name>/` with an `index.md` that holds only its title, in frontmatter.
- A page is `<number>-<slug>.md` inside a section. The numbers order the sections and the pages, in the sidebar and in the previous and next links. The slug is the URL, `/docs/<slug>`, so it must be unique across sections.
- A page starts with frontmatter, `---`, `title: Routing`, `---`, and has no `# Title` line: the site prints the title. Its `##` headings fill the "On this page" list, and its `##` and `###` headings are in the search.

### Frontmatter

A page:

| Key | Meaning |
| --- | --- |
| `title` | Required. The page's H1 and its name in the sidebar and the search. |
| `description` | The line under the title. Without it, the page's first paragraph is used (and left out of the body) when it stands alone, that is, does not end with a colon. |
| `platforms` | `[android, ios]`, the default, or one of them: the pills under the title. |
| `video` | The name of the page's feature video, `list` for `static/videos/list-ios.mp4` and `list-android.mp4` (see below). |
| `group` | A heading of the sidebar to put the page under. Pages with the same `group` must be next to each other in the numbering. |

A section's `index.md`: `title`, and optionally `description` and `icon` (a Lucide icon of `src/lib/icons.ts`) for its card on the landing page, and `area` (`Guide`, the default, `Components` or `Reference`): sections of one area share one link at the top of the sidebar, and one tree.

### Markdown

- A code block can start with `<!--- file: src/routes/+mobile.svelte --->` (or `/// file: package.json`). The line is dropped from the code and shown as the file name over the block. Highlighted languages: `sh`, `svelte`, `ts`, `js`, `json`, `yaml`, `kotlin`, `css`, `html`; any other (`tree`) is plain text. Every block has a Copy button.
- A block marked `terminal` is a terminal with a tab for each package manager: ```` ```sh terminal ````. Write its commands the npm way and the site shows each as the four managers spell it, and remembers the reader's choice for every terminal. Translated: `npx` (`yarn dlx`, `pnpm dlx`, `bunx`; `-y` is dropped), `npm install` / `i` / `add` with `-D`, `-E` and `-g` (`yarn add`, `pnpm add`, `bun add`; globally `yarn global add`, `pnpm add -g`, `bun add -g`), `npm uninstall`, `npm run <script>` (`yarn run`, `pnpm run`, `bun run`; the `--` before the script's flags is dropped), `npm test` (`bun run test`: `bun test` is Bun's own test runner), `npm ci` (`install --frozen-lockfile`), `npm init`, `npm create`, variables in front (`CI=1 npm install`) and `&&`. Lines that are not npm commands (`cd my-app`, comments) are the same in all four.
  A block with no npm command has no tabs, and neither has one with a command that has no faithful translation (a flag the others lack, such as `--legacy-peer-deps`; a pipe; `sudo npm ...`; a yarn, pnpm or bun command written by hand): it is shown as written. Use `terminal` only for commands that work with any package manager: Svelte Native itself needs pnpm, so its own commands stay in plain `sh` blocks.
- A quote that starts with `**info**`, `**warning**`, `**important**`, `**success**` or `**error**` is a callout: `> **warning** Don't start Metro with CI=1.` GitHub's `> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]` and `[!CAUTION]` make the same five.
- An image alone in a paragraph is a figure, and its title is the caption: `![Alt text](/images/screen.png "The caption")`. A path that starts with `/` is a file of `static/` (and is prefixed with `BASE_PATH`).
- Link to another page by its slug: `(routing)`, or `(styling#light-and-dark-mode)` for a heading. The guide doesn't link into the repository: the site is self-contained.

The build fails (`src/lib/docs.server.ts`) on a page without a title, an unknown frontmatter key, a `#` heading, two pages with one slug, a link into the repository, and a link to a page or heading that does not exist, so a renamed heading cannot leave a dead link behind.

### Feature videos

A page with `video: list` shows, under its header, a recording of the feature on a phone with an iOS and Android switch (the reader's choice is remembered). The files go in `static/videos/` (create the directory with the first one): `list-ios.mp4` and `list-android.mp4`, and optionally `list-ios.jpg` and `list-android.jpg` as posters. The video is muted, loops, has controls, and plays only while it is on screen (not at all for a reader who asked for less motion). The build looks for the files: a platform whose file is missing is left out, and a page with neither shows no video block.

## What the site has

- **Search**: ⌘K, Ctrl+K or `/` opens it. It is [Pagefind](https://pagefind.app), which indexes the prerendered pages (`pagefind --site build`, the second half of `build`) and loads the index when the dialog first opens. The dev server has no index, so the dialog says so there; `build` and `preview` have it.
- **Copy page**: every page is also served as Markdown, `/docs/<slug>.md`, for the "Copy page" menu, and `/llms.txt` lists them ([llmstxt.org](https://llmstxt.org)). `SITE_URL` is the address of the site, subpath included (`SITE_URL=https://svelte-native.alfayez.dev pnpm --dir apps/docs build`); it is what the canonical link, `og:url` and llms.txt use. Without it the pages have no canonical or `og:url`, and llms.txt links by path.
- **Edit this page, last updated**: the link goes to GitHub's editor for the file, and the date is the file's last commit (`git log` at build time; a build without git, or of a file not committed yet, shows no date).
- **Theme**: Auto, Light or Dark, a class on `<html>` set before the first paint. The colours are CSS variables, `--docs-*`, in `src/app.css`, with `light-dark()`, so the stylesheet needs Chrome 123, Safari 17.5 or Firefox 120. The accent, `--accent`, and the neutrals (Radix slate) are there too.
- **Fonts**: Inter and JetBrains Mono, from `@fontsource-variable`, served by the site.

## Host it

`BASE_PATH` is the subpath the site is served from, and it is read at build time. Leave it unset to serve from the root of a domain. For GitHub Pages, which serves a project at `/<repository>`:

```sh
BASE_PATH=/svelte-native pnpm --dir apps/docs build
```

A site served from a directory (not from GitHub Pages) needs its server to find the prerendered files. For nginx:

```nginx
server {
	root /var/www/svelte-native;           # the contents of apps/docs/build
	absolute_redirect off;

	location / {
		try_files $uri $uri.html $uri/index.html =404;
	}

	# build/404.html is the site's own page, with its header and a search
	error_page 404 /404.html;
}
```

`/docs/routing` is `docs/routing.html`, which `$uri.html` finds; `/docs` is a page that redirects to the introduction. The assets have absolute paths (`paths.relative` is off), so a page served at `/docs/routing/` still finds its stylesheet.

Upload `apps/docs/build` as the site. The site at <https://svelte-native.alfayez.dev> is that directory served by nginx; to update it, build and copy the directory over the old one. It contains a `.nojekyll` file so that GitHub Pages serves the `_app` directory. The pages' `.md` files and `llms.txt` are static files too: serve `.md` as `text/markdown` (most servers know it) so that a browser shows them, and "View Markdown" does not download them. CI builds the site (the `docs` job of `.github/workflows/ci.yml`) and deploys nothing.
