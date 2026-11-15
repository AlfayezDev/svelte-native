import { expect, jest, test } from "bun:test";
import { EXIT_TIMEOUT_MS } from "../../src/fabric/navigation.ts";
import { type FakeNode, find, turns, onPlatform, activityOf, navigationWorld } from "./support/world.ts";

/** The router renders the contract's outer Screen per entry and names its stacks; a popped screen stays until the native stack reports its exit (SPEC.md "Screen exit"). */
const { host, load } = navigationWorld();

// The router renders the contract's outer Screen per entry and names its stacks.
type ScreensApp = {
  goto: (href: string, options?: { replaceState?: boolean; reset?: boolean; presentation?: string }) => void;
  back: () => boolean;
  screens: () => string[];
  exited: (index: number) => void;
  stack: () => string[];
  scope: () => string | undefined;
};
const header = (screen: FakeNode) => screen.children.find((child) => String(child.props.nativeID).startsWith("svelte:header"));

test("the router renders a Screen per entry: presentation from the route or the navigation, the back button below the first, the page's header merged in", async () => {
  const m = await load("router-screens-fixture.svelte");
  const app = m.startSurface(51, m.Fixture, {}) as ScreensApp;
  await turns(m);
  const screens = () => host.roots[51][0].children;
  expect(screens()).toHaveLength(1);
  expect(screens()[0].props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(header(screens()[0])?.props.nativeID).toBe("svelte:header;t=Page%20%2F"); // the page's own <Screen title> reached the router's screen, no back button on the first screen

  app.goto("/a");
  app.goto("/b/3");
  app.goto("/a?x=1", { presentation: "sheet" });
  await turns(m);
  expect(app.stack()).toEqual(["/:push", "/a:push", "/b/3:modal", "/a:sheet"]);
  expect(screens().map((screen) => String(screen.props.nativeID).split(";").slice(0, 3).join(";"))).toEqual([
    "svelte:screen;a=2;p=push", "svelte:screen;a=2;p=push", "svelte:screen;a=2;p=modal", "svelte:screen;a=2;p=sheet",
  ]);
  expect(String(screens()[3].props.nativeID)).toContain(";dt=0.5,1");
  // The arrow is for a pushed screen with a screen below: not the first, not a modal, not a sheet; the page's `large` merged as well.
  expect(header(screens()[1])?.props.nativeID).toBe("svelte:header;t=Page%20%2Fa;l=1;bk=1");
  expect(header(screens()[2])?.props.nativeID).toBe("svelte:header;t=Page%20%2Fb%2F3");
  expect(header(screens()[3])?.props.nativeID).toBe("svelte:header;t=Page%20%2Fa;l=1");

  // The user dismissing the modal drops it and the sheet above it.
  host.emit(screens()[2].target, "topDismissed", { dismissCount: 1 });
  await turns(m);
  expect(app.stack()).toEqual(["/:push", "/a:push"]);
  expect(screens()).toHaveLength(2);
});

// A popped screen stays in the native stack, inactive, until the stack reports its exit (SPEC.md "Screen exit"): the unmount of its page then leaves the transition.

test.each(["ios", "android"] as const)("on %s a popped screen stays mounted with activityState 0 until the stack sends topExited; the stack the router works on drops it at once", async (os) => {
  onPlatform(os);
  jest.useFakeTimers(); // the exit timeout of what the test leaves leaving never fires
  const m = await load("router-screens-fixture.svelte");
  const app = m.startSurface(56, m.Fixture, {}) as ScreensApp;
  await turns(m);
  app.goto("/a");
  app.goto("/b/3");
  await turns(m);
  const screens = () => host.roots[56][0].children;
  expect(screens().map(activityOf)).toEqual(["2", "2", "2"]);
  expect(app.back()).toBe(true);
  await turns(m);
  expect(app.stack()).toEqual(["/:push", "/a:push"]); // `entries`, `current` and `back` see the live stack
  expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/b/3:back:leaving"]);
  expect(screens()).toHaveLength(3);
  expect(screens().map(activityOf)).toEqual(["2", "2", "0"]);
  expect(find([screens()[2]], "RCTRawText").map((node) => node.props.text)).toEqual(["page /b/3:3"]); // its page is still there
  expect(app.back()).toBe(true);
  await turns(m);
  expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving", "/b/3:back:leaving"]);
  app.exited(2);
  await turns(m);
  expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving"]);
  expect(screens()).toHaveLength(2);
  host.emit(screens()[1].target, "topExited", {});
  await turns(m);
  expect(app.screens()).toEqual(["/:root:live"]);
  expect(screens()).toHaveLength(1);
});

test("a screen pushed while another leaves goes below it; a replacement, a reset and a base replacement retire what they remove; a user dismissal drops at once", async () => {
  onPlatform("ios");
  jest.useFakeTimers(); // the exit timeout of what the test leaves leaving never fires
  const m = await load("router-screens-fixture.svelte");
  const app = m.startSurface(57, m.Fixture, {}) as ScreensApp;
  await turns(m);
  app.goto("/a");
  app.goto("/b/3");
  await turns(m);
  app.back();
  app.goto("/c");
  await turns(m);
  expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/c:back:live", "/b/3:back:leaving"]);
  app.goto("/b/4", { replaceState: true });
  await turns(m);
  expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/b/4:back:live", "/c:back:leaving", "/b/3:back:leaving"]); // the new screen goes under the ones that leave
  app.goto("/a", { reset: true });
  await turns(m);
  expect(app.stack()).toEqual(["/a:push"]);
  expect(app.screens().filter((entry) => entry.endsWith("leaving"))).toHaveLength(5);
  const screens = () => host.roots[57][0].children;
  expect(screens().filter((screen) => activityOf(screen) === "0")).toHaveLength(5);

  // The user's own dismissal has happened natively by the time JavaScript hears of it: nothing to wait for.
  const second = await load("router-screens-fixture.svelte");
  host.reset();
  const plain = second.startSurface(58, second.Fixture, {}) as ScreensApp;
  await turns(second);
  plain.goto("/a");
  plain.goto("/b/3");
  await turns(second);
  host.emit(host.roots[58][0].children[1].target, "topDismissed", { dismissCount: 1 });
  await turns(second);
  expect(plain.screens()).toEqual(["/:root:live"]);
  expect(host.roots[58][0].children).toHaveLength(1);
});

test("a popped screen that never reports its exit is removed after EXIT_TIMEOUT_MS, with a warning", async () => {
  onPlatform("ios");
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  jest.useFakeTimers();
  try {
    const m = await load("router-screens-fixture.svelte");
    const app = m.startSurface(59, m.Fixture, {}) as ScreensApp;
    await turns(m);
    app.goto("/a");
    app.back();
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving"]);
    jest.advanceTimersByTime(EXIT_TIMEOUT_MS - 1);
    expect(app.screens()).toHaveLength(2);
    jest.advanceTimersByTime(2);
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live"]);
    expect(host.roots[59][0].children).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  } finally { console.warn = warn; }
});
