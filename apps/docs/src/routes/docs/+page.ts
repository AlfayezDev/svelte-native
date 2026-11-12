import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";

// /docs is not a page of its own: the guide starts at its introduction.
export function load() {
	redirect(307, resolve("/docs/[slug]", { slug: "introduction" }));
}
