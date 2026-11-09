import { theme } from "#lib/native/state.svelte.ts";

/** The look of the lab page's text fields. */
export const field = { minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: "hidden" as const, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface, color: theme.foreground, fontSize: 17 };
