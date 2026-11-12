import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, type Plugin } from "vite";
import { BASE } from "./src/lib/base-path.ts";

const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };

/** Pagefind writes its index to build/pagefind after the build, and `vite preview` serves what SvelteKit built, not that directory: serve it too, so the search works in `pnpm preview`. */
function pagefindInPreview(): Plugin {
	const root = resolve("build/pagefind");
	return {
		name: "pagefind-in-preview",
		configurePreviewServer(server) {
			server.middlewares.use((request, response, next) => {
				const prefix = `${BASE}/pagefind/`;
				const path = (request.url ?? "").split("?")[0];
				if (!path.startsWith(prefix)) return next();
				const file = resolve(root, decodeURIComponent(path.slice(prefix.length)));
				try {
					if (!file.startsWith(root + sep) || !statSync(file).isFile()) return next();
				} catch {
					return next();
				}
				response.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
				createReadStream(file).pipe(response);
			});
		},
	};
}

export default defineConfig({
	plugins: [
		pagefindInPreview(),
		sveltekit({
			adapter: adapter({ pages: "build", assets: "build", precompress: false, strict: true }),
			// Absolute asset paths, so that a page served at /docs/routing/ (a trailing slash) still finds its stylesheet and scripts.
			paths: { base: BASE, relative: false },
		}),
	],
	// The stylesheet uses light-dark() for its colours: keep the minifier from rewriting it for older browsers, where it can not follow a theme class on one element.
	build: { cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"] },
	// The pages are the Markdown files of the repository's docs/ directory, outside this app.
	server: { fs: { allow: ["../.."] } },
});
