// Run by plain `node` in an app that has neither `@sveltejs/kit` nor `vite` (tests/node-modules.test.ts): the native target of the plugin does not need either,
// and the web target says which package it needs.
import { svelteNative } from "@alfayez/svelte-native/vite";

const native = svelteNative({ target: "native" });
let web;
try {
  await svelteNative({ target: "web" });
  web = null;
} catch (error) {
  web = error instanceof Error ? error.message : String(error);
}
console.log(JSON.stringify({ native: native.name, web }));
