import { describe, expect, test } from "bun:test";
import { kitExports } from "./support/kit-types.ts";
import { kitWorld } from "./support/kit.ts";

/** `$app/env` and `$app/paths` on the device. */
const { world, load, mountApp } = kitWorld();

describe("$app/env", () => {
  test("browser, dev, building, version and mobile: what the device is", async () => {
    world.__kitConstants = { name: "App", version: "3.4.5" };
    let m = await load();
    expect(m.env).toEqual({ browser: false, dev: true, building: false, version: "3.4.5", mobile: true });
    // A release build is not `__DEV__`, and a build without the embedded config has no version.
    world.__DEV__ = false;
    world.__kitConstants = undefined;
    m = await load();
    expect(m.env).toEqual({ browser: false, dev: false, building: false, version: "", mobile: true });
  });

  test("it has the names SvelteKit declares (`browser`, `dev`, `building`, `version`) and the library's `mobile`", async () => {
    const declared = kitExports("$app/env");
    expect(declared).toEqual(["browser", "building", "dev", "version"]);
    expect(Object.keys((await load()).env).toSorted()).toEqual([...declared, "mobile"].toSorted());
  });
});

describe("$app/paths", () => {
  test("it has the names SvelteKit declares, and `base` and `assets`, empty, for code written for SvelteKit 2", async () => {
    const m = await load();
    expect(Object.keys(m.paths).toSorted()).toEqual([...kitExports("$app/paths"), "assets", "base"].toSorted());
    expect([m.paths.base, m.paths.assets]).toEqual(["", ""]);
  });

  test("resolve builds the path of a route id and of a pathname; asset is the path of a file with no base", async () => {
    const { paths } = await load();
    expect(paths.resolve("/")).toBe("/");
    expect(paths.resolve("/about")).toBe("/about");
    expect(paths.resolve("/blog/[slug]", { slug: "hello-world" })).toBe("/blog/hello-world");
    expect(paths.resolve("blog/hello")).toBe("/blog/hello");
    expect(paths.resolve("/blog/[slug]?page=2#top", { slug: "a" })).toBe("/blog/a?page=2#top");
    expect(paths.asset("potato.jpg")).toBe("/potato.jpg");
    expect(paths.asset("/potato.jpg")).toBe("/potato.jpg");
    expect(() => paths.resolve("/blog/[slug]")).toThrow("Missing params for dynamic route ID `/blog/[slug]`");
  });

  test("match finds the route of a path, with its parameters, through the root router", async () => {
    const m = await load();
    await expect(m.paths.match("/workspaces")).rejects.toThrow("match needs the app's router");
    await mountApp(m, { initial: "/workspaces" });
    expect(await m.paths.match("/workspaces")).toEqual({ id: "/workspaces", params: {} });
    expect(await m.paths.match("acme/home/thread/7")).toEqual({ id: "/(workspace)/[slug]/(tabs)/home/thread/[id]", params: { slug: "acme", id: "7" } });
    expect(await m.paths.match(new URL("https://example.org/acme/settings/profile?x=1"))).toEqual({ id: "/(workspace)/[slug]/settings/[[section]]", params: { slug: "acme", section: "profile" } });
    expect(await m.paths.match("/nowhere/at/all")).toBeNull();
  });
});
