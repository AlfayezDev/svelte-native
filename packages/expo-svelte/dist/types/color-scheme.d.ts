/**
 * The system's light or dark mode, reactive like Svelte's `prefersReducedMotion`: a template, `$derived` or `$effect` that reads
 * `colorScheme.current` runs again when the user switches. A system that reports no scheme counts as light, as React Native's views do.
 * `Appearance.setColorScheme` (`expo-svelte/platform`) overrides it for the app.
 */
export declare const colorScheme: {
    readonly current: "light" | "dark";
};
