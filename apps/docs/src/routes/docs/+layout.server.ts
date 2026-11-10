import { searchIndex, sections } from "#lib/docs.server";

export function load() {
	return { sections: sections(), search: searchIndex() };
}
