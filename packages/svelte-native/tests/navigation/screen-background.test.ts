import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadRouter } from "../support/router.ts";
import { src } from "../support/bundle.ts";
import { fakeHost } from "../support/fake-host.ts";
import { ofKind, settle } from "./support/world.ts";

/**
 * A screen with no background of its own has the system's, in the app's light or dark mode (`system-colors.ts`), under the screen's class and style: React Native leaves a screen
 * transparent, so a pushed screen showed the one below it through itself while it slid in. A modal or a sheet has the elevated one (a dark grey on iOS in the dark mode); a
 * transparent modal has none.
 */
const host = fakeHost();
/** A style as the platform reads it: nested arrays flattened, later entries winning. */
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {}));
type App = { set(patch: object): void; setOuter(style: object | undefined): void };
type Loaded = { startSurface(tag: number, app: unknown, props: object): unknown; tick(): Promise<void>; Fixture: unknown; __setColorScheme(scheme: "light" | "dark"): void };

const navigation = globalThis as { __navigationOS?: string };
afterEach(() => { delete navigation.__navigationOS; });

async function mount(surface: number, os: "android" | "ios", fixture = "screen-fixture.svelte") {
  navigation.__navigationOS = os;
  const m = await loadRouter<Loaded>(`import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures", fixture))};
    import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
    import { tick } from 'svelte';
    import { __setColorScheme } from 'react-native/Libraries/Utilities/Appearance';
    export { startSurface, tick, Fixture, __setColorScheme };`);
  const app = m.startSurface(surface, m.Fixture, {}) as App;
  await settle(m);
  const backgrounds = () => ofKind(host.roots[surface] ?? [], "screen").map((screen) => flat(screen.props.style).backgroundColor);
  return { m, app, background: () => backgrounds()[0], backgrounds };
}

test("Android: Material 3's surface in each mode, the screen's own background over it, and none for a transparent modal", async () => {
  const { m, app, background } = await mount(31, "android");
  expect(background()).toBe("#FFFBFE");
  m.__setColorScheme("dark");
  await settle(m);
  expect(background()).toBe("#1C1B1F");
  app.set({ style: { backgroundColor: "#123456" } });
  await settle(m);
  expect(background()).toBe("#123456");
  app.set({ style: undefined, presentation: "transparentModal" });
  await settle(m);
  expect(background()).toBeUndefined();
  m.__setColorScheme("light");
});

test("iOS: the system background, and the elevated one for a modal or a sheet in the dark mode", async () => {
  const { m, app, background } = await mount(32, "ios");
  expect(background()).toBe("#FFFFFF");
  m.__setColorScheme("dark");
  await settle(m);
  expect(background()).toBe("#000000");
  app.set({ presentation: "sheet" });
  await settle(m);
  expect(background()).toBe("#1C1C1E");
  m.__setColorScheme("light");
  await settle(m);
  expect(background()).toBe("#FFFFFF");
});

test("a screen inside another takes its background: a tab's screen looks as the tab bar's screen does, and has the system's when that one has none", async () => {
  const { m, app, backgrounds } = await mount(33, "android", "screen-background-fixture.svelte");
  expect(backgrounds()).toEqual(["#123456", "#123456"]);
  app.setOuter({ backgroundColor: "#654321" });
  await settle(m);
  expect(backgrounds()).toEqual(["#654321", "#654321"]);
  app.setOuter(undefined);
  await settle(m);
  expect(backgrounds()).toEqual(["#FFFBFE", "#FFFBFE"]);
  m.__setColorScheme("dark");
  await settle(m);
  expect(backgrounds()).toEqual(["#1C1B1F", "#1C1B1F"]);
  m.__setColorScheme("light");
});
