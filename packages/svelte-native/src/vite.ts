import { resolve } from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import type { PluginOption } from "vite";
import { exportNative, syncNative } from "./build.ts";
import { assertCustomRenderer } from "./svelte-build.ts";

export function svelteNative(options: {
  target?: "web" | "native";
  platform?: "android" | "ios";
  kit?: Parameters<typeof sveltekit>[0];
} = {}): PluginOption {
  if (options.target !== "native") return [
    { name: "svelte-native:web", config: () => ({ optimizeDeps: { entries: ["!src/routes/**/+mobile.svelte", "!src/routes/**/*.mobile.svelte", "!src/lib/native/**"] } }) },
    sveltekit(options.kit),
  ];
  assertCustomRenderer("The native target of svelteNative() (@example/svelte-native/vite)");
  let root = "";
  return {
    name: "svelte-native",
    config: () => ({ build: { write: false, rolldownOptions: { input: "virtual:svelte-native-build" } } }),
    configResolved(config) { root = config.root; },
    async buildStart() { await syncNative(root); },
    resolveId(id) { if (id === "virtual:svelte-native-build") return "\0svelte-native-build"; },
    load(id) { if (id === "\0svelte-native-build") return "export {};"; },
    async generateBundle() { await exportNative(resolve(root), options.platform ?? "android"); },
  };
}
