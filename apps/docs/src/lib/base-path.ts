// The site can live under a subpath (GitHub Pages serves a project at /<repository>): BASE_PATH is that subpath, "/expo-svelte" for example.
// Read at build time only (vite.config.ts and the Markdown renderer); the browser code gets the base from $app/paths.
export const BASE = (process.env.BASE_PATH ?? "").replace(/\/+$/, "") as "" | `/${string}`;
if (BASE && !BASE.startsWith("/")) throw new Error(`BASE_PATH must start with "/" (got "${BASE}")`);

/**
 * The address the site is served at, subpath included (SITE_URL=https://svelte-native.alfayez.dev), for the canonical and og:url of the pages and the links of llms.txt.
 * Without it the pages have neither a canonical nor an og:url, and llms.txt links by path: nothing is guessed about where the site lives.
 */
export const SITE_URL = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
if (SITE_URL && !/^https?:\/\//.test(SITE_URL)) throw new Error(`SITE_URL must start with https:// or http:// (got "${SITE_URL}")`);
