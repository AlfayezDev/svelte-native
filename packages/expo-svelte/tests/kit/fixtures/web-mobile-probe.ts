// Run by web-mobile.test.ts under Node, from tests/kit/fixtures/web-mobile-app: a SvelteKit app whose page and a module shared with the device read `mobile` from `$app/env` and
// `$app/environment`, with the library's Vite plugin. `dev` starts the development server and prints what the page it serves says (rendered on the server) and the client modules it
// serves; `build` builds the client and the server (SvelteKit's own builder) into the directory it is given and prints the text of the page's bundles.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createBuilder, createServer } from "vite";

const [mode, outDir] = process.argv.slice(2);

async function dev() {
  const server = await createServer({ root: process.cwd(), logLevel: "silent", server: { port: 0 } });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0] ?? "";
    const html = await (await fetch(base)).text();
    const page = await (await fetch(`${base}src/routes/+page.svelte`)).text();
    const modules: Record<string, string> = {};
    for (const [, path] of page.matchAll(/from "(\/@id\/[^"]+)"/g)) modules[path ?? ""] = await (await fetch(base + (path ?? "").slice(1))).text();
    return { rendered: /<p id="flags">([^<]*)/.exec(html)?.[1] ?? null, modules: Object.values(modules).map((text) => text.split("\n").filter((line) => !line.startsWith("//#")).join("\n").trim()) };
  } finally {
    await server.close();
  }
}

async function build() {
  const builder = await createBuilder({ root: process.cwd(), logLevel: "silent", mode: "production" });
  await builder.buildApp();
  const output = join(outDir ?? "", "output");
  const read = (directory: string) => readdirSync(join(output, directory), { recursive: true, withFileTypes: true }).filter((file) => file.isFile() && file.name.endsWith(".js")).map((file) => readFileSync(join(file.parentPath, file.name), "utf8"));
  const server = readFileSync(join(output, "server/entries/pages/_page.svelte.js"), "utf8");
  return { server, client: read("client/_app/immutable/nodes") };
}

console.log(JSON.stringify(mode === "build" ? await build() : await dev()));
