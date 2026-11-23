/**
 * A route id with its parameters in place: `/blog/[slug]/[...rest]` with `{ slug: "hello", rest: "a/b" }` is `/blog/hello/a/b`. SvelteKit's `resolve_route`
 * (`utils/routing.js`, 3.4.0), written out here because its package keeps `src/` closed and the device has no SvelteKit to import it from: the same segments, the same
 * `(group)` that adds nothing to the path, the same `[x+2f]` and `[u+0041]` escapes, optional (`[[x]]`) and rest (`[...x]`) parameters, a search or a hash after the id that stays as it is,
 * and the same refusals. A matcher (`[id=integer]`) names the parameter and checks nothing: the matchers are `src/params`, which a native route has no counterpart of.
 */
export type ParamValue = string | number | boolean | bigint;

const ESCAPE = /\[([ux])\+([^\]]+)\]/;
const PARAMETER = /\[(\[)?(\.\.\.)?([\w-]+?)(?:=([\w-]+))?\]\]?/g;
const SEGMENT = new RegExp(`${ESCAPE.source}|${PARAMETER.source}`, "g");

/** The characters a pathname keeps encoded, so that a decoded escape still reads as the character it stands for. */
const encodePathnameChars = (text: string) => text.replace(/[%/?#]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
const decodeEscape = (code: string) => String.fromCodePoint(...code.split("-").map((codepoint) => Number.parseInt(codepoint, 16)));
/** A segment that is a group, `(app)`, adds nothing to the path. */
const affectsPath = (segment: string) => segment !== "" && !/^\([^)]+\)$/.test(segment);

export function resolveRoute(id: string, params?: Readonly<Record<string, ParamValue | undefined>>): string {
  // Only the route takes part in the removal of groups, the parameters and the escapes.
  const [route = "", suffix = ""] = id.split(/([?#].*)/s);
  const trailingSlash = route.endsWith("/");
  const segments = route.slice(1).split("/").filter(affectsPath).map((segment) =>
    segment.replace(SEGMENT, (_match, escapeType: string | undefined, escapeCode: string, optional: string | undefined, rest: string | undefined, name: string) => {
      if (escapeType) return encodePathnameChars(decodeEscape(escapeCode));
      if (!params) throw new Error(`Missing params for dynamic route ID \`${id}\``);
      const value = params[name];
      if (value === undefined || value === "") {
        if (optional) return "";
        if (rest && value !== undefined) return "";
        throw new Error(`Missing parameter \`${name}\` in route \`${id}\``);
      }
      if (typeof value === "string") {
        if (value.startsWith("/") || value.endsWith("/")) throw new Error(`Parameter \`${name}\` in route \`${id}\` cannot start or end with a slash: this would make an invalid route like \`foo/bar\``);
        return value;
      }
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
      throw new Error(`Parameter \`${name}\` in route \`${id}\` must be a string, number, boolean, or bigint`);
    }),
  );
  const resolved = `/${segments.filter(Boolean).join("/")}`;
  return resolved + (trailingSlash && resolved !== "/" ? "/" : "") + suffix;
}

/** SvelteKit's route id of a route of the tree: its directory under `src/routes`, groups included, with a leading slash (`/(app)/blog/[slug]`; the root is `/`). */
export const routeIdOf = (route: { readonly id: string }): string => `/${route.id}`;
