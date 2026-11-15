// Run by web-mmkv.test.ts under Node, in a scratch project whose node_modules has the package: builds the `/mmkv` entry for the web with Vite (library mode, no SvelteKit), once with the
// `svelte-native:web` plugin of `svelteNative()` (its `config` is all that is used of it) and once without, and prints what each build did as JSON.
import { stripVTControlCharacters } from "node:util";
import { build } from "vite";
import { svelteNative } from "../../../src/vite.ts";

const plugins = (await svelteNative() as unknown as { name?: string }[]).filter((plugin) => plugin?.name === "svelte-native:web");

async function bundle(withPlugin: boolean) {
  try {
    const result = await build({ root: process.cwd(), logLevel: "silent", configFile: false, plugins: withPlugin ? plugins : [], build: { write: false, minify: false, lib: { entry: "entry.ts", formats: ["es"], fileName: "out" } } });
    const code = (Array.isArray(result) ? result[0] : result).output[0].code as string;
    return { built: true, code: code.length, exports: /export \{([^}]*)\}/.exec(code)?.[1]?.split(",").map((name) => name.trim().split(" as ").at(-1)).sort(), reactNative: /from ["']react-native["']/.test(code), nitro: code.includes("NitroModules"), web: code.includes("mmkv.default") };
  } catch (error) {
    return { built: false, message: stripVTControlCharacters(String((error as Error).message)).split("\n").slice(0, 4).join("\n") };
  }
}
console.log(JSON.stringify({ plugins: plugins.length, withPlugin: await bundle(true), without: await bundle(false) }));
