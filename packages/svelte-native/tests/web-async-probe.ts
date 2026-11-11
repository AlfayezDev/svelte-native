// Run by async-option.test.ts under Node, from the QA app's directory (SvelteKit resolves vite-plugin-svelte from the working directory): builds the plugins `svelteNative({ target: "web", async })`
// returns, lets Vite resolve its config, and prints the compiler options vite-plugin-svelte ended up with, for the `async` option and the `kit` options the test gives.
import { resolveConfig } from "vite";
import { svelteNative } from "../src/vite.ts";

const { async, kit } = JSON.parse(process.argv[2] ?? "{}") as { async?: boolean; kit?: object };
const plugins = (await svelteNative({ target: "web", async, kit: kit as never })) as never;
const config = await resolveConfig({ root: process.cwd(), configFile: false, plugins, logLevel: "silent" }, "build");
type Options = { compilerOptions: { experimental?: Record<string, unknown> } };
const options = (config.plugins as unknown as { api?: { options?: Options } }[]).find((plugin) => plugin.api?.options)?.api?.options as Options;
console.log(JSON.stringify({ experimental: options.compilerOptions.experimental ?? null }));
