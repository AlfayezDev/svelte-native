// Run by plain `node`: Vite loads a config file (`native.vite.config.ts`, not named `vite.config.ts` so that the editor tools that look for one in this repository leave it alone) as it does in an app (it bundles the config with esbuild and leaves a package in `node_modules`
// to Node's `import()`), and the library's plugin is imported directly.
import { loadConfigFromFile } from "vite";
import { svelteNative } from "@alfayez/svelte-native/vite";

const loaded = await loadConfigFromFile({ command: "build", mode: "native" }, "native.vite.config.ts", process.cwd());
const names = (plugins) => [plugins].flat(Infinity).filter(Boolean).map((plugin) => plugin.name);
// The web target loads SvelteKit's plugin when it is asked for (an app that has SvelteKit; the native-only app's probe is probe-vite.mjs).
// (SvelteKit's own plugin is a promise of a list, which Vite settles itself.)
const settle = async (option) => (await Promise.all([await option].flat(Infinity))).flat(Infinity);
const web = names(await settle(svelteNative({ target: "web" })));
console.log(JSON.stringify({ config: loaded?.path.split("/").pop(), plugins: names(loaded?.config.plugins), direct: names(svelteNative({ target: "native" })), web }));
