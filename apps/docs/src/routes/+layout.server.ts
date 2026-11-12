import { navigation } from "#lib/docs.server";

export function load() {
	return { areas: navigation() };
}
