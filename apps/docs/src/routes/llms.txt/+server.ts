export const prerender = true;

import { getLlmsTxt } from "#lib/docs.server";

export function GET() {
	return new Response(getLlmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
