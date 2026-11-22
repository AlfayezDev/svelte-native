import { test, expect, jest, afterEach } from "bun:test";
import { resolve } from "node:path";
import { appStubs, baseStubs, load as loadBundle, src } from "../support/bundle.ts";
import { fakeHost } from "../support/fake-host.ts";

/**
 * The root `<Router>` hands its router to the remote functions runtime while it is mounted (`connectHost`, through `linkRouter` of
 * `src/remote/router-link.ts`): the runtime follows a server `redirect()` through it and reads the screen URL from it. These mount a real
 * `<Router>` on a fake Fabric host and read the registration back the way the runtime does (`linkedRouter()`, `currentUrl()`).
 */
fakeHost();

/** The host listeners the stand-ins for BackHandler and Linking hold, and the routers the fixtures create, as one module of the bundle that the bundle exports. */
const listener = (name: string) => `import { ${name} as handlers } from "router-link-probe"; export default { addEventListener: (event, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }`;
const stubs: Record<string, string> = {
  ...baseStubs(),
  ...appStubs,
  "router-link-probe": "export const back = []; export const links = []; export const roots = {};",
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/BackHandler": `${listener("back")} };`,
  "react-native/Libraries/Linking/Linking": `${listener("links")}, getInitialURL: () => Promise.resolve(null) };`,
};

type Router = { goto: (href: string) => void; current: { url: URL }; nested: boolean };
type Module = {
  startSurface(rootTag: number, App: unknown, props: Record<string, unknown>): unknown; stopSurface(rootTag: number): void; tick(): Promise<void>; Fixture: unknown;
  linkedRouter(): Router | undefined; currentUrl(): string;
  probe: { back: unknown[]; links: unknown[]; roots: Record<string, Router> };
};
const load = (fixture: string) => loadBundle<Module>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures", fixture))};
    import { startSurface, stopSurface } from ${JSON.stringify(src("fabric/host.ts"))};
    import { tick } from 'svelte';
    import * as probe from 'router-link-probe';
    export { linkedRouter } from ${JSON.stringify(src("remote/router-link.ts"))};
    export { currentUrl } from ${JSON.stringify(src("remote/link.ts"))};
    export { startSurface, stopSurface, tick, Fixture, probe };`,
  stubs,
  viewConfigs: "pass-through",
  converters: false,
});

const settle = async (m: Module) => { for (let turn = 0; turn < 4; turn++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };
const registered = (m: Module): Router | undefined => m.linkedRouter();
const hostListeners = (m: Module) => ({ back: m.probe.back.length, links: m.probe.links.length });

let surface = 300;
let started: { m: Module; tag: number } | undefined;
/** A fixture on its own surface, with no host listener left over from another test. */
async function mount(fixture: string) {
  const m = await load(fixture);
  jest.useFakeTimers(); // an exit timer of a screen a navigation leaves must not fire into another test
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, {}) as Record<string, (...args: never[]) => unknown>;
  started = { m, tag };
  await settle(m);
  return { m, app, settle: () => settle(m) };
}
afterEach(() => {
  if (started) started.m.stopSurface(started.tag);
  started = undefined;
  jest.useRealTimers();
});

test("the root <Router> registers its router with the remote runtime while it is mounted, and unmounting it clears the registration", async () => {
  const { m, app, settle: turns } = await mount("router-link-fixture.svelte");
  const { root } = (app.routers as () => { root: Router })();
  // Nothing is mounted yet: the runtime has no router to follow a redirect through, and the screen URL is the origin's root.
  expect(registered(m)).toBeUndefined();
  expect(m.currentUrl().href).toBe("https://native.invalid/");
  expect(hostListeners(m)).toEqual({ back: 0, links: 0 });

  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  expect(m.currentUrl().pathname).toBe("/a"); // the top screen's path
  expect(hostListeners(m)).toEqual({ back: 1, links: 1 });

  // It follows the screen on top, and a redirect the runtime sends through it navigates the app.
  root.goto("/b");
  await turns();
  expect(m.currentUrl().pathname).toBe("/b");
  registered(m)?.goto("/");
  await turns();
  expect(m.currentUrl().pathname).toBe("/");
  expect(root.current.url.pathname).toBe("/");

  (app.showRoot as (value: boolean) => void)(false);
  await turns();
  expect(registered(m)).toBeUndefined();
  expect(m.currentUrl().href).toBe("https://native.invalid/"); // not the stale screen of an unmounted router
  expect(hostListeners(m)).toEqual({ back: 0, links: 0 });
});

test("a <Router> that gives way to another for the same router (an {#if} branch switch) leaves the router registered", async () => {
  const { m, app, settle: turns } = await mount("router-link-fixture.svelte");
  const { root } = (app.routers as () => { root: Router })();
  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  root.goto("/b");
  await turns();
  expect(registered(m)).toBe(root);

  // The old <Router> unmounts and the new one mounts in the same flush; the old one's teardown must not take the new one's registration with it.
  (app.flip as () => void)();
  await turns();
  expect(registered(m)).toBe(root);
  expect(m.currentUrl().pathname).toBe("/b");
  expect(hostListeners(m)).toEqual({ back: 1, links: 1 }); // one set of host listeners, the new mount's

  (app.flip as () => void)();
  await turns();
  expect(registered(m)).toBe(root);

  // And the registration still ends with the last mount.
  (app.showRoot as (value: boolean) => void)(false);
  await turns();
  expect(registered(m)).toBeUndefined();

  // A <Router> mounted anew for the same router (the session resets by unmounting it) registers it again.
  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  expect(m.currentUrl().pathname).toBe("/b");
});

test("a nested router's <Router> registers nothing: not alone, and not in place of the root's", async () => {
  const { m, app, settle: turns } = await mount("router-link-fixture.svelte");
  const { root, inner } = (app.routers as () => { root: Router; inner: Router })();
  expect(root.nested).toBe(false);
  expect(inner.nested).toBe(true);

  // Alone (the root router is created, its <Router> is not mounted): there is nothing for the runtime to follow.
  (app.showInner as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBeUndefined();
  expect(m.currentUrl().href).toBe("https://native.invalid/");
  expect(hostListeners(m)).toEqual({ back: 0, links: 0 });

  // Beside the root's, mounted after it: the root stays the one registered, and the nested router's own screen is not the page's URL.
  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  (app.showInner as (value: boolean) => void)(false);
  await turns();
  (app.showInner as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  inner.goto("/b");
  await turns();
  expect(m.currentUrl().pathname).toBe("/a");

  // Unmounting it leaves the root's registration alone.
  (app.showInner as (value: boolean) => void)(false);
  await turns();
  expect(registered(m)).toBe(root);
  expect(hostListeners(m)).toEqual({ back: 1, links: 1 });
});

test("a <Router> that unmounts after another router has registered does not clear that one", async () => {
  const { m, app, settle: turns } = await mount("router-link-pair-fixture.svelte");
  const show = app.show as (which: "first" | "second", value: boolean) => void;
  show("first", true);
  await turns();
  const first = m.probe.roots.first;
  expect(first).toBeDefined();
  expect(registered(m)).toBe(first);

  show("second", true);
  await turns();
  const second = m.probe.roots.second;
  expect(second).toBeDefined();
  expect(second).not.toBe(first);
  expect(registered(m)).toBe(second); // the newest registration wins

  show("first", false);
  await turns();
  expect(registered(m)).toBe(second);

  show("second", false);
  await turns();
  expect(registered(m)).toBeUndefined();
});
