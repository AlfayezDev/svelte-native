// Run by plain `node`: Vite loads a config file (`native.vite.config.ts`, not named `vite.config.ts` so that the editor tools that look for one in this repository leave it alone) as it does in an app (it bundles the config with esbuild and leaves a package in `node_modules`
// to Node's `import()`), and the library's plugin is imported directly.
import { loadConfigFromFile } from "vite";
import { svelteNative } from "@example/svelte-native/vite";

const loaded = await loadConfigFromFile({ command: "build", mode: "native" }, "native.vite.config.ts", process.cwd());
const names = (plugins) => [plugins].flat(Infinity).filter(Boolean).map((plugin) => plugin.name);
console.log(JSON.stringify({ config: loaded?.path.split("/").pop(), plugins: names(loaded?.config.plugins), direct: names(svelteNative({ target: "native" })) }));
