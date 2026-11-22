import { defineConfig } from "vite";
import { expoSvelte } from "expo-svelte/vite";

export default defineConfig({ plugins: [expoSvelte({ target: "native" })] });
