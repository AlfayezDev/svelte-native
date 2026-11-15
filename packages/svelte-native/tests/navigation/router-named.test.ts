import { expect, test } from "bun:test";
import { find, turns, handlersOf, navigationWorld } from "./support/world.ts";

/** Routers are named by scope; the back key and the launch link belong to the one that is active or outermost. */
const { host, load, texts } = navigationWorld();

type NestedApp = ScreensApp & { dummy?: never };
type Nested = {
  router: { entries: unknown[]; goto: (href: string) => void; scope?: string; active: () => boolean; back: () => boolean };
  outer: { scope?: string };
  found: { nearest: unknown; root: unknown; self: unknown };
  missing: string;
  setActive: (value: boolean) => void;
};

test("routers are named: the outermost is root, a nested one takes its scope, and useRouter finds either from below", async () => {
  const m = await load("router-screens-fixture.svelte");
  const app = m.startSurface(52, m.Fixture, { nested: true }) as NestedApp;
  await turns(m);
  const nested = (globalThis as unknown as { __nested: Nested }).__nested;
  expect((app as unknown as ScreensApp).scope()).toBe("root");
  expect(nested.outer.scope).toBe("root");
  expect(nested.router.scope).toBe("tab-a");
  expect(nested.found.nearest).toBe(nested.router);
  expect(nested.found.self).toBe(nested.router);
  expect(nested.found.root).toBe(nested.outer);
  expect(nested.missing).toContain("nope");
  // The nested router's own screens are real screens inside the root's first screen, not merged into it.
  expect(find(host.roots[52], "RCTView").filter((node) => String(node.props.nativeID).startsWith("svelte:stack"))).toHaveLength(2);
});

test("a named router carries route params and the query like the root router does", async () => {
  const m = await load("router-screens-fixture.svelte");
  m.startSurface(54, m.Fixture, { nested: true });
  await turns(m);
  const nested = (globalThis as unknown as { __nested: Nested }).__nested;
  nested.router.goto("/t/n/7?x=1");
  const entry = nested.router.entries.at(-1) as { params: Record<string, string>; url: URL; presentation: string };
  expect(entry.params).toEqual({ id: "7" });
  expect(entry.url.search).toBe("?x=1");
  expect(entry.presentation).toBe("push");
  await turns(m);
  expect(texts(54)).toContain("page /t/n/7:7");
});

test("the back key belongs to a router only while it is active, and links only to the outermost one", async () => {
  const m = await load("router-screens-fixture.svelte");
  handlersOf("__backHandlers").length = 0;
  handlersOf("__linkHandlers").length = 0;
  host.reset();
  const app = m.startSurface(53, m.Fixture, { nested: true }) as ScreensApp;
  await turns(m);
  const nested = (globalThis as unknown as { __nested: Nested }).__nested;
  // React Native asks the handlers newest first and stops at the first `true`.
  const back = () => [...handlersOf("__backHandlers")].reverse().some((handler) => (handler as () => boolean)());
  const link = (url: string) => { for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url }); };
  expect(handlersOf("__backHandlers")).toHaveLength(1); // the root's alone: it asks the nested router first while it is active

  expect(back()).toBe(false); // one entry in each stack: nobody takes it, the app may leave
  nested.router.goto("/t/b");
  expect(nested.router.entries).toHaveLength(2);
  nested.setActive(false);
  await turns(m);
  expect(back()).toBe(false); // the tab is not selected: its stack keeps its screens
  expect(nested.router.entries).toHaveLength(2);
  // A link is the app's: the root opens it, a nested router never does, active or not (a tab whose routes match the URL
  // would otherwise push the same screen again).
  link("example://a");
  expect(app.stack()).toEqual(["/:push", "/a:push"]);
  expect(nested.router.entries).toHaveLength(2);
  nested.setActive(true);
  await turns(m);
  link("example://t/a");
  expect(nested.router.entries).toHaveLength(2);
  expect(app.stack()).toEqual(["/:push", "/a:push"]);
  nested.router.goto("/t/a?again");
  expect(nested.router.entries).toHaveLength(3);
  expect(back()).toBe(true);
  expect(back()).toBe(true);
  expect(nested.router.entries).toHaveLength(1);
  expect(back()).toBe(true); // the tab is at its root: the key falls through to the root stack, which pops the screen the link opened
  expect(app.stack()).toEqual(["/:push"]);
  expect(back()).toBe(false);
});
