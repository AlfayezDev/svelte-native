// Run by runes-environment.test.ts under Node, from the QA app's directory (SvelteKit resolves vite-plugin-svelte from the working directory): builds the plugins `expoSvelte({ target: "web" })` returns,
// lets Vite resolve its config, and prints what vite-plugin-svelte ended up with: the compiler options and what `dynamicCompileOptions` says for an app file and for a file below node_modules.
import { resolveConfig } from "vite";
import { expoSvelte } from "../../../src/vite.ts";

const runes = JSON.parse(process.argv[2]) as boolean | null;
const plugins = (await expoSvelte({ target: "web", runes: runes ?? undefined, kit: { compilerOptions: { experimental: { async: true } } } as never })) as never;
const config = await resolveConfig({ root: process.cwd(), configFile: false, plugins, logLevel: "silent" }, "build");
type Options = { compilerOptions: object; dynamicCompileOptions(data: object): Promise<unknown> };
const options = (config.plugins as unknown as { api?: { options?: Options } }[]).find((plugin) => plugin.api?.options)?.api?.options as Options;
const ask = async (filename: string) => (await options.dynamicCompileOptions({ filename, code: "", compileOptions: {} })) ?? null;
console.log(JSON.stringify({ compilerOptions: options.compilerOptions, app: await ask("/work/app/src/routes/+page.svelte"), library: await ask("/work/app/node_modules/some-svelte-lib/Counter.svelte") }));
