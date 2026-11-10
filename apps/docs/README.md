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

Add `docs/<number>-<slug>.md`, for example `docs/09-deployment.md`. The number sets the order in the sidebar and in the previous and next links, the slug is the URL (`/docs/deployment`). The first line must be `# Title`; the `##` headings fill the "On this page" list.

What the renderer understands, beyond plain Markdown:

- A code block can start with `<!--- file: src/routes/+mobile.svelte --->` (or `/// file: package.json`). The line is dropped from the code and shown as the file name over the block. Highlighted languages: `sh`, `svelte`, `ts`, `js`, `json`, `yaml`, `kotlin`; any other (`tree`) is plain text.
- `> [!NOTE]`, `> [!TIP]` and `> [!WARNING]` make a callout.
- Link to another page as `(04-native-routes.md#light-and-dark-mode)`. A link into the repository, such as `(../packages/svelte-native/README.md#remote-functions)`, becomes a link to `https://github.com/AlfayezDev/svelte-native/blob/main/<path>`.

The build fails if a link between pages names a page or a heading that does not exist (`src/lib/docs.server.ts`), so a renamed heading cannot leave a dead link behind.

## Host it

`BASE_PATH` is the subpath the site is served from, and it is read at build time. Leave it unset to serve from the root of a domain. For GitHub Pages, which serves a project at `/<repository>`:

```sh
BASE_PATH=/svelte-native pnpm --dir apps/docs build
```

Upload `apps/docs/build` as the site. It contains a `.nojekyll` file so that GitHub Pages serves the `_app` directory. CI builds the site (the `docs` job of `.github/workflows/ci.yml`) and deploys nothing.
