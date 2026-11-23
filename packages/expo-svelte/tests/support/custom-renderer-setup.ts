import { mock } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Preloaded first (`bunfig.toml`). Svelte 5.59's `svelte/renderer`, and `svelte/internal/flags/custom-renderer` (which a component compiled for a custom renderer imports), are Svelte's client files
 * only under the `browser` or `svelte-custom-renderer` resolve condition; without one they are stubs that throw, and Bun sets neither. This gives the two their client files, as the conditions of
 * Metro and of the tests' bundles do. (`bun test --conditions svelte-custom-renderer` would also turn every other import of `svelte` into its client build, which the tests that import it in the
 * process were not written for.)
 */
const require = createRequire(import.meta.url);
const svelte = dirname(require.resolve("svelte/package.json"));
mock.module("svelte/renderer", () => require(join(svelte, "src/renderer/index.js")));
mock.module("svelte/internal/flags/custom-renderer", () => require(join(svelte, "src/internal/flags/custom-renderer.js")));
