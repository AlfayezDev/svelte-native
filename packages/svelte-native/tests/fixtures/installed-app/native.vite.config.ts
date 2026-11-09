import { defineConfig } from "vite";
import { svelteNative } from "@example/svelte-native/vite";

export default defineConfig({ plugins: [svelteNative({ target: "native" })] });
