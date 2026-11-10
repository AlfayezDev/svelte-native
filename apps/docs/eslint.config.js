import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import { defineConfig } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";

export default defineConfig(
	{ ignores: ["node_modules/**", ".svelte-kit/**", "build/**"] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	{
		languageOptions: { globals: { ...globals.node, ...globals.browser } },
		rules: { "no-undef": "off", "svelte/no-navigation-without-resolve": "off" },
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts"],
		languageOptions: { parserOptions: { parser: ts.parser } },
	},
);
