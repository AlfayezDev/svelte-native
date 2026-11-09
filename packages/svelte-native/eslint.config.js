import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import ts from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["node_modules/**", "dist/**", "tests/fixtures/**/.svelte-kit/**"] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "no-undef": "off" },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
);
