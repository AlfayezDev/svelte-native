import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { BASE } from "./src/lib/base-path.ts";


export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ pages: "build", assets: "build", precompress: false, strict: true }),
			paths: { base: BASE },
		}),
	],
	// The pages are the Markdown files of the repository's docs/ directory, outside this app.
	server: { fs: { allow: ["../.."] } },
});
