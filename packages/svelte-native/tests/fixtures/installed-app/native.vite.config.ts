import { defineConfig } from "vite";
import { svelteNative } from "@rasheed/svelte-native/vite";

export default defineConfig({ plugins: [svelteNative({ target: "native" })] });
