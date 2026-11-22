import { expect, test } from "bun:test";
import { find, turns, activityOf, navigationWorld } from "./support/world.ts";

/** The router loads each route's modules on its first navigation and shows what its screens say while they load, fail, or wait. */
const { host, load, texts } = navigationWorld();

type RouterApp = {
  loadLog: () => string[];
  release: (id: string) => void;
  fail: (id: string, message: string) => void;
  goto: (href: string, options?: { replaceState?: boolean; reset?: boolean }) => void;
  back: () => boolean;
  stack: () => string[];
  modulesOf: (id: string) => string;
};

test("the router loads the first screen's route when it is created and every other route on its first navigation", async () => {
  const m = await load("router-fixture.svelte");
  const app = m.startSurface(41, m.Fixture, {}) as RouterApp;
  expect(app.loadLog()).toEqual(["home"]);
  expect(app.modulesOf("home")).toBe("loading");
  expect(app.modulesOf("section")).toBe("loading");
  app.release("home");
  await turns(m);
  expect(app.modulesOf("home")).toBe("ready");
  expect(texts(41)).toEqual(["page /"]);

  app.goto("/a");
  app.goto("/b/7");
  expect(app.loadLog()).toEqual(["home", "section", "item"]); // the loader runs inside goto, before the screen mounts
  app.release("section");
  app.release("item");
  await turns(m);
  expect(texts(41)).toEqual(["page /", "page /a", "page /b/7:7"]);

  expect(app.back()).toBe(true);
  app.goto("/a/", { replaceState: true });
  app.goto("/b/7", { reset: true });
  await turns(m);
  expect(app.loadLog()).toEqual(["home", "section", "item"]); // each route loads once
  expect(app.stack()).toEqual(["/b/7"]);
  // The left screens stay mounted (activityState 0) until the stack reports their exit.
  for (const screen of host.roots[41][0].children) if (activityOf(screen) === "0") host.emit(screen.target, "topExited", {});
  await turns(m);
  expect(texts(41)).toEqual(["page /b/7:7"]);
});

test("a screen is empty until its route loads, shows the loading snippet when given one, and keeps its presentation", async () => {
  const bare = await load("router-fixture.svelte");
  const plain = bare.startSurface(42, bare.Fixture, {}) as RouterApp;
  const screen = () => host.roots[42][0].children[0];
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screen().children).toHaveLength(1); // the outer Screen's content view, still empty
  expect(screen().children[0].children).toHaveLength(0);
  plain.release("home");
  await turns(bare);
  expect(texts(42)).toEqual(["page /"]);

  const m = await load("router-fixture.svelte");
  host.reset();
  const app = m.startSurface(43, m.Fixture, { withLoading: true, initial: "/b/9" }) as RouterApp;
  expect(texts(43)).toEqual(["loading item"]);
  expect(host.roots[43][0].children[0].props.nativeID).toBe("svelte:screen;a=2;p=modal;g=1;s=default;b=1"); // modal before the modules arrive
  app.release("item");
  await turns(m);
  expect(texts(43)).toEqual(["page /b/9:9"]);
  expect(app.loadLog()).toEqual(["item"]);
});

test("layouts render around the page once the route's modules are in, outermost first", async () => {
  const m = await load("router-fixture.svelte");
  const app = m.startSurface(44, m.Fixture, { initial: "/a" }) as RouterApp;
  expect(find(host.roots[44], "RCTView").filter((node) => node.props.testID === "layout")).toHaveLength(0);
  app.release("section");
  await turns(m);
  const [layout] = find(host.roots[44], "RCTView").filter((node) => node.props.testID === "layout");
  expect(layout).toBeDefined();
  expect(find([layout], "RCTRawText").map((node) => node.props.text)).toEqual(["page /a"]);
});

test("createRouter takes the route tree: the array of routes it took before fails by naming the contract", async () => {
  const m = await load("router-array-fixture.svelte");
  delete (globalThis as { __routerError?: string }).__routerError;
  m.startSurface(46, m.Fixture, {});
  const message = (globalThis as { __routerError?: string }).__routerError ?? "";
  expect(message).toContain("createRouter takes the route tree");
  expect(message).toContain("kind: \"stack\"");
  expect(message).toContain(".svelte-native/routes.<variant>.ts");
  expect(message).not.toContain("iterable");
});

test("a route that fails to load throws where it renders and loads again on its next navigation", async () => {
  const m = await load("router-fixture.svelte");
  const app = m.startSurface(45, m.Fixture, {}) as RouterApp;
  app.release("home");
  app.goto("/a");
  app.fail("section", "chunk missing");
  await turns(m);
  expect(app.modulesOf("section")).toBe("failed: chunk missing");
  expect(texts(45)).toEqual(["failed: chunk missing"]); // the nearest boundary draws what the screen threw
  expect(app.modulesOf("home")).toBe("ready");
  app.back();
  app.goto("/a");
  expect(app.loadLog()).toEqual(["home", "section", "section"]);
  expect(app.modulesOf("section")).toBe("loading"); // the failure is cleared while the new load runs
  app.release("section");
  await turns(m);
  expect(app.modulesOf("section")).toBe("ready");
});

test("a route that fails to load after Back took its screen away does not take the place of the screen the user went back to (#92)", async () => {
  const m = await load("router-fixture.svelte");
  const app = m.startSurface(47, m.Fixture, {}) as RouterApp;
  app.release("home");
  await turns(m);
  app.goto("/a");
  await turns(m);
  expect(app.back()).toBe(true);
  expect(app.stack()).toEqual(["/"]);
  // The load of the route Back left fails before the stack reports the exit of its screen, and after.
  app.fail("section", "chunk missing");
  await turns(m);
  expect(app.modulesOf("section")).toBe("failed: chunk missing");
  expect(texts(47)).toEqual(["page /"]);
  for (const screen of host.roots[47][0].children) if (activityOf(screen) === "0") host.emit(screen.target, "topExited", {});
  await turns(m);
  expect(texts(47)).toEqual(["page /"]);
  // A route on the stack that fails still throws where it renders.
  app.goto("/a");
  app.fail("section", "chunk missing again");
  await turns(m);
  expect(texts(47)).toEqual(["failed: chunk missing again"]);
});

test("a pushed screen is made once its page has loaded, so its options are there from the start; a slow load lets it come in empty", async () => {
  const m = await load("router-fixture.svelte");
  const app = m.startSurface(48, m.Fixture, {}) as RouterApp;
  const screens = () => host.roots[48][0].children;
  app.release("home");
  await turns(m);
  const first = screens()[0];
  expect(screens()).toHaveLength(1);
  app.goto("/a");
  await turns(m);
  expect(app.stack()).toEqual(["/", "/a"]);
  expect(screens()).toHaveLength(1); // the route is loading: no native screen yet
  app.release("section");
  await turns(m);
  expect(screens()).toHaveLength(2); // made with its page in the same commit
  expect(texts(48)).toEqual(["page /", "page /a"]);
  expect(screens()[0]).toBe(first); // the screen below was never made again

  app.goto("/b/7");
  await turns(m);
  expect(screens()).toHaveLength(2);
  await new Promise((done) => setTimeout(done, 300)); // longer than the router waits for a page
  await turns(m);
  expect(screens()).toHaveLength(3); // in anyway, empty
  expect(texts(48)).toEqual(["page /", "page /a"]);
  app.release("item");
  await turns(m);
  expect(texts(48)).toEqual(["page /", "page /a", "page /b/7:7"]);
});

test("the first screen is made once and stays while its route loads", async () => {
  const m = await load("router-fixture.svelte");
  m.startSurface(49, m.Fixture, {});
  const first = host.roots[49][0].children[0];
  expect(first).toBeDefined();
  await turns(m);
  expect(host.roots[49][0].children[0]).toBe(first);
});
