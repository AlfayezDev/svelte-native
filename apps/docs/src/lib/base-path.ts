// The site can live under a subpath (GitHub Pages serves a project at /<repository>): BASE_PATH is that subpath, "/svelte-native" for example.
// Read at build time only (vite.config.ts and the Markdown renderer); the browser code gets the base from $app/paths.
export const BASE = (process.env.BASE_PATH ?? "").replace(/\/+$/, "") as "" | `/${string}`;
if (BASE && !BASE.startsWith("/")) throw new Error(`BASE_PATH must start with "/" (got "${BASE}")`);
