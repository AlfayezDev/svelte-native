import { describe, expect, test } from "bun:test";
import { resolveRoute } from "../../src/kit/route-id.ts";

describe("resolveRoute: SvelteKit's route ids with their parameters", () => {
  test("static, dynamic, optional and rest parameters, groups, escapes and a trailing slash", () => {
    expect(resolveRoute("/", {})).toBe("/");
    expect(resolveRoute("/blog/[slug]", { slug: "hello" })).toBe("/blog/hello");
    expect(resolveRoute("/[a]/[b]", { a: "x", b: "y" })).toBe("/x/y");
    expect(resolveRoute("/(app)/settings/(tabs)/[id]", { id: "7" })).toBe("/settings/7");
    // Optional: left out when missing or empty, a segment when given.
    expect(resolveRoute("/[[lang]]/about", {})).toBe("/about");
    expect(resolveRoute("/[[lang]]/about", { lang: "" })).toBe("/about");
    expect(resolveRoute("/[[lang]]/about", { lang: "ar" })).toBe("/ar/about");
    expect(resolveRoute("/[[lang]]", { lang: undefined })).toBe("/");
    // Rest: any number of segments, none when empty, and a rest parameter that is not given at all is missing.
    expect(resolveRoute("/docs/[...rest]", { rest: "a/b/c" })).toBe("/docs/a/b/c");
    expect(resolveRoute("/docs/[...rest]", { rest: "" })).toBe("/docs");
    expect(resolveRoute("/docs/[...rest]/edit", { rest: "a/b" })).toBe("/docs/a/b/edit");
    expect(() => resolveRoute("/docs/[...rest]", {})).toThrow("Missing parameter `rest` in route `/docs/[...rest]`");
    // A matcher names the parameter and checks nothing; a parameter shares a segment with text.
    expect(resolveRoute("/items/[id=integer]", { id: 5 })).toBe("/items/5");
    expect(resolveRoute("/files/[name].[ext]", { name: "a", ext: "png" })).toBe("/files/a.png");
    // Scalars: numbers, booleans and bigints are their text.
    expect(resolveRoute("/[a]/[b]/[c]", { a: 1, b: true, c: 10n })).toBe("/1/true/10");
    // Escapes: `[x+2f]` is a slash that is not a separator, `[u+0041]` a letter.
    expect(resolveRoute("/a[x+2f]b", {})).toBe("/a%2Fb");
    expect(resolveRoute("/[u+0041]bc", {})).toBe("/Abc");
    // A route id with a trailing slash keeps it, and a search or a hash after the id stays.
    expect(resolveRoute("/blog/[slug]/", { slug: "a" })).toBe("/blog/a/");
    expect(resolveRoute("/blog/[slug]?page=2#top", { slug: "a" })).toBe("/blog/a?page=2#top");
    // Only the route is resolved: what follows a `?` or a `#` is the caller's, whatever it looks like.
    expect(resolveRoute("/blog/[slug]?next=/a/[b]#(c)", { slug: "a" })).toBe("/blog/a?next=/a/[b]#(c)");
    expect(resolveRoute("/(app)/?x=1")).toBe("/?x=1");
    // A route that has no parameter is given none, and an escape is not a parameter.
    expect(resolveRoute("/about")).toBe("/about");
    expect(resolveRoute("/a[x+2f]b")).toBe("/a%2Fb");
  });

  test("it refuses a missing parameter, one with a slash at either end, and one that is not a scalar", () => {
    expect(() => resolveRoute("/blog/[slug]")).toThrow("Missing params for dynamic route ID `/blog/[slug]`");
    expect(() => resolveRoute("/blog/[slug]", {})).toThrow("Missing parameter `slug` in route `/blog/[slug]`");
    expect(() => resolveRoute("/blog/[slug]", { slug: "" })).toThrow("Missing parameter `slug`");
    expect(() => resolveRoute("/blog/[slug]", { slug: "/a" })).toThrow("Parameter `slug` in route `/blog/[slug]` cannot start or end with a slash");
    expect(() => resolveRoute("/blog/[slug]", { slug: "a/" })).toThrow("cannot start or end with a slash");
    expect(() => resolveRoute("/blog/[slug]", { slug: {} as never })).toThrow("must be a string, number, boolean, or bigint");
  });
});
