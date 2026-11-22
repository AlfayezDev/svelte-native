import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import { defineConfig } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";

export default defineConfig(
	{ ignores: ["node_modules/**", ".expo-svelte/**", ".expo/**", "android/**", "ios/**"] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	{
		languageOptions: { globals: { ...globals.node } },
		rules: { "no-undef": "off" },
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts"],
		languageOptions: { parserOptions: { parser: ts.parser } },
	},
	{
		files: ["*.config.cjs"],
		rules: { "@typescript-eslint/no-require-imports": "off" },
	},
);
