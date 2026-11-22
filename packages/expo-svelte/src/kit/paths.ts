import { untrack } from "svelte";
import type * as Kit from "$app/paths";
import { BASE, resolve as resolveHref } from "../route-tree.ts";
import { rootRouter } from "../router.svelte.ts";
import { resolveRoute, routeIdOf, type ParamValue } from "./route-id.ts";

/**
 * `$app/paths` on the device (Metro resolves the import here, `withExpoSvelte`). An app on the device has no base path and no
 * `static` directory, so the paths are SvelteKit's with an empty base: `resolve("/blog/[slug]", { slug: "a" })` is `/blog/a`.
 */

/** Always empty: the app is not served from a path. SvelteKit 3 no longer exports it; code written for SvelteKit 2 and libraries that still import it get this. */
export const base = "";
/** Always empty, as `base`: there is no `paths.assets` either. */
export const assets = "";

/** The path of a file in `static/`, as SvelteKit builds it with no base: `/file`. A device has no `static` directory, so nothing serves this path; it is for code shared with the web. */
export const asset: typeof Kit.asset = (file) => `${assets || base}/${file.startsWith("/") ? file.slice(1) : file}`;

/**
 * A route id with its parameters in place (`resolve("/blog/[slug]", { slug: "hello" })` is `/blog/hello`), or a pathname (`resolve("blog/hello")` is `/blog/hello`).
 * A search or a hash after a route id stays (`"/blog/[slug]?page=2"`). Optional (`[[x]]`) and rest (`[...x]`) parameters, `(group)` segments and the `[x+2f]`
 * escapes work as in SvelteKit; a route id that has a parameter and is given none throws, as does a missing, slashed or non-scalar value.
 */
export const resolve = ((...args: [string, Record<string, ParamValue | undefined>?]): string => {
  const [id, params] = args;
  if (!id.startsWith("/")) return `${base}/${id}`;
  if (id.includes("[") && !params) throw new Error(`Missing params for dynamic route ID \`${id}\``);
  return base + resolveRoute(id, params ?? {});
}) as typeof Kit.resolve;

/** The route of `href`'s path: its id (SvelteKit's, with the groups: `/(app)/blog/[slug]`) and its parameters, or `null` when no screen of the app has that path. Rejects before the app has created its router. */
export const match: typeof Kit.match = (url) =>
  // Untracked: called in an effect, it must not run again for every screen the user pushes.
  untrack(async () => {
    const router = rootRouter();
    if (!router) throw new Error("match needs the app's router, which does not exist yet: it is made by createRouter in the app shell");
    const { node } = router; // the root router's tree, a stack
    const target = node.kind === "stack" ? resolveHref(node, new URL(String(url), BASE).pathname) : null;
    return (target ? { id: routeIdOf(target.page), params: target.params } : null) as Awaited<ReturnType<typeof Kit.match>>;
  });
