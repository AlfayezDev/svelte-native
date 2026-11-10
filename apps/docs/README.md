# Svelte Native documentation site

A static SvelteKit app (`@sveltejs/adapter-static`, every page prerendered) that renders the guide in [`docs/`](../../docs). The Markdown files there are the single source of truth: this app reads them at build time and does not copy them.

## Run it

From the repository root, after `pnpm install`:

```sh
pnpm --dir apps/docs dev       # development server with hot reload
pnpm --dir apps/docs build     # prerender the site to apps/docs/build
pnpm --dir apps/docs preview   # serve apps/docs/build
pnpm --dir apps/docs check     # svelte-check
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

What the renderer understands, beyond plain Markdown:

- A code block can start with `<!--- file: src/routes/+mobile.svelte --->` (or `/// file: package.json`). The line is dropped from the code and shown as the file name over the block. Highlighted languages: `sh`, `svelte`, `ts`, `js`, `json`, `yaml`, `kotlin`; any other (`tree`) is plain text.
- `> [!NOTE]`, `> [!TIP]` and `> [!WARNING]` make a callout.
- Link to another page by its slug: `(routing)`, or `(styling#light-and-dark-mode)` for a heading. The guide doesn't link into the repository: the site is self-contained.

The build fails (`src/lib/docs.server.ts`) on a page without a title, a `#` heading, two pages with one slug, a link into the repository, and a link to a page or heading that does not exist, so a renamed heading cannot leave a dead link behind.

## Host it

`BASE_PATH` is the subpath the site is served from, and it is read at build time. Leave it unset to serve from the root of a domain. For GitHub Pages, which serves a project at `/<repository>`:

```sh
BASE_PATH=/svelte-native pnpm --dir apps/docs build
```

Upload `apps/docs/build` as the site. The site at <https://svelte-native.alfayez.dev> is that directory served by nginx; to update it, build and copy the directory over the old one. It contains a `.nojekyll` file so that GitHub Pages serves the `_app` directory. CI builds the site (the `docs` job of `.github/workflows/ci.yml`) and deploys nothing.
