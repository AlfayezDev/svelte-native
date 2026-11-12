// Auto, Light or Dark. The choice is the class of <html> ("light" or "dark", none for Auto, which follows the system) and the attribute data-theme,
// both set before the first paint by the script in app.html, and stored in localStorage.
import { write } from "#lib/storage";

export type ThemeMode = "auto" | "light" | "dark";

export const theme = $state<{ mode: ThemeMode }>({ mode: "auto" });

/** Reads what app.html set; run once in the browser. */
export function loadTheme() {
	const mode = document.documentElement.dataset.theme;
	theme.mode = mode === "light" || mode === "dark" ? mode : "auto";
}

export function setTheme(mode: ThemeMode) {
	theme.mode = mode;
	const root = document.documentElement;
	root.dataset.theme = mode;
	root.classList.remove("light", "dark");
	if (mode !== "auto") root.classList.add(mode);
	write("docs-theme", mode === "auto" ? null : mode);
}
