import { defineConfig } from "vite";
import { svelteNative } from "@alfayez/svelte-native/vite";

export default defineConfig({ plugins: [svelteNative({ target: "native" })] });
