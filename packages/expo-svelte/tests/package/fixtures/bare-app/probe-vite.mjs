// Run by plain `node` in an app that has neither `@sveltejs/kit` nor `vite` (tests/package/node-modules.test.ts): the native target of the plugin does not need either,
// and the web target says which package it needs.
import { expoSvelte } from "expo-svelte/vite";

const native = expoSvelte({ target: "native" });
let web;
try {
  await expoSvelte({ target: "web" });
  web = null;
} catch (error) {
  web = error instanceof Error ? error.message : String(error);
}
console.log(JSON.stringify({ native: native.name, web }));
