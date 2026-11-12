export const prerender = true;

import { getMarkdown, pageList } from "#lib/docs.server";
import { error } from "@sveltejs/kit";

// Every page of the guide as Markdown, next to the page: /docs/routing.md.
export function entries() {
	return pageList().map(({ slug }) => ({ slug }));
}

export function GET({ params }) {
	const markdown = getMarkdown(params.slug);
	if (markdown === undefined) error(404, "Not found");
	return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
