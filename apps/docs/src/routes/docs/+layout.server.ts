import { pageList } from "#lib/docs.server";

export function load() {
	return { pages: pageList() };
}
