import { expect, test } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./support/harness.ts";
import type { AnimLog } from "../support/reanimated-stubs.ts";

/**
 * A foreign view's own props are not Reanimated's (SPEC.md, "Foreign views", "Device verification of the libraries"). The host treats a top-level prop that
 * starts with `animation` or `transition` as a CSS animation key once the animation layer is loaded, and `transition` of expo-image (a number) reached the
 * CSS parser, which threw "iterator method is not callable": a JavaScript fatal that destroyed the React host, found on the emulator the moment a
 * lab that had animated something opened the image section. `animationName` of Rive was taken away from the native view the same way.
 */
const imageConfigs = expoViewConfigs("expo-image/android/src/main/java/expo/modules/image/ExpoImageModule.kt");
const log = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

/** The fixture mounted on a harness of its own: each test starts from nothing, and support puts the global object back when it ends. */
async function mount(surface: number) {
  const harness = createHarness("android", { expo: { ExpoImage: imageConfigs } });
  const loaded = await harness.load("animation-fixture.svelte");
  const app = loaded.startSurface(surface, loaded.Fixture, {}) as { setTransition(value: unknown): void };
  return { harness, loaded, app };
}

test("with the animation layer loaded, expo-image keeps its transition and Rive its animationName", async () => {
  const { harness, loaded, app } = await mount(201);
  const [image] = find(harness.roots()[201], "ViewManagerAdapter_ExpoImage");
  const [rive] = find(harness.roots()[201], "RiveReactNativeView");
  // The animated view loaded the layer; the foreign views' props went through it unchanged.
  expect(image?.props.transition).toEqual({ duration: 150 });
  expect(rive?.props.animationName).toBe("idle");

  app.setTransition(0);
  await settle(loaded);
  expect(find(harness.roots()[201], "ViewManagerAdapter_ExpoImage")[0]?.props.transition).toEqual({ duration: 0 });
  app.setTransition({ effect: "flip-from-left", duration: 300 });
  await settle(loaded);
  expect(find(harness.roots()[201], "ViewManagerAdapter_ExpoImage")[0]?.props.transition).toMatchObject({ effect: "flip-from-left", duration: 300 });
});

test("an engine node nested in a foreign view keeps its CSS keys: Reanimated's CSS manager is attached to it", async () => {
  const { harness } = await mount(202);
  const nested = find(harness.roots()[202], "RCTView").find((node) => node.props.testID === "nested");
  expect(nested).toBeDefined();
  for (const key of ["animationName", "animationDuration"]) expect(key in (nested?.props ?? {}), key).toBe(false);
  const css = log().css as { viewTag: number; updates: Record<string, unknown>[] }[];
  const own = css.filter((entry) => entry.viewTag === nested?.tag);
  expect(own).toHaveLength(1);
  expect(own[0]?.updates[0]).toMatchObject({ animationDuration: "1s" });
  // and nothing of the foreign views themselves went to the CSS manager
  const foreignTags = ["ViewManagerAdapter_ExpoImage", "RiveReactNativeView", "RNCWebView"].flatMap((name) => find(harness.roots()[202], name).map((node) => node.tag));
  expect(css.filter((entry) => foreignTags.includes(entry.viewTag))).toEqual([]);
});

test("a Modal keeps its animationType once an animated node has loaded the layer", async () => {
  const { harness } = await mount(203);
  const [modal] = find(harness.roots()[203], "RCTModalHostView");
  expect(modal?.props.animationType).toBe("slide");
});
