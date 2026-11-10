import { getPage, pageList } from "#lib/docs.server";
import { error } from "@sveltejs/kit";

export function entries() {
	return pageList().map(({ slug }) => ({ slug }));
}

export function load({ params }) {
	const page = getPage(params.slug);
	if (!page) error(404, "Not found");
	const pages = pageList();
	const index = pages.findIndex((p) => p.slug === params.slug);
	return { page, previous: pages[index - 1], next: pages[index + 1] };
}
