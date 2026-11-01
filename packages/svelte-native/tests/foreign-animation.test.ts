import { expect, test } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./foreign-harness.ts";

/**
 * A foreign view's own props are not Reanimated's (SPEC.md, "Foreign views", "Device verification of the libraries"). The host treats a top-level prop that
 * starts with `animation` or `transition` as a CSS animation key once the animation layer is loaded, and `transition` of expo-image (a number) reached the
 * CSS parser, which threw "iterator method is not callable": a JavaScript fatal that destroyed the React host, found on the emulator the moment a
 * lab that had animated something opened the image section. `animationName` of Rive was taken away from the native view the same way.
 */
const harness = createHarness("android", {
  expo: { ExpoImage: expoViewConfigs("expo-image/android/src/main/java/expo/modules/image/ExpoImageModule.kt") },
});

test("with the animation layer loaded, expo-image keeps its transition and Rive its animationName", async () => {
  const loaded = await harness.load("foreign-animation-fixture.svelte");
  const app = loaded.startSurface(201, loaded.Fixture, {}) as { setTransition(value: unknown): void };
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
  delete (globalThis as { __anim?: unknown }).__anim; // the stubs' log is global: this test reads only its own surface's
  const loaded = await harness.load("foreign-animation-fixture.svelte");
  loaded.startSurface(202, loaded.Fixture, {});
  const nested = find(harness.roots()[202], "RCTView").find((node) => node.props.testID === "nested");
  expect(nested).toBeDefined();
  for (const key of ["animationName", "animationDuration"]) expect(key in (nested?.props ?? {}), key).toBe(false);
  const css = (globalThis as unknown as { __anim: { css: { viewTag: number; updates: Record<string, unknown>[] }[] } }).__anim.css;
  const own = css.filter((entry) => entry.viewTag === nested?.tag);
  expect(own).toHaveLength(1);
  expect(own[0]?.updates[0]).toMatchObject({ animationDuration: "1s" });
  // and nothing of the foreign views themselves went to the CSS manager
  const foreignTags = ["ViewManagerAdapter_ExpoImage", "RiveReactNativeView", "RNCWebView"].flatMap((name) => find(harness.roots()[202], name).map((node) => node.tag));
  expect(css.filter((entry) => foreignTags.includes(entry.viewTag))).toEqual([]);
});

test("a Modal keeps its animationType once an animated node has loaded the layer", async () => {
  const loaded = await harness.load("foreign-animation-fixture.svelte");
  loaded.startSurface(203, loaded.Fixture, {});
  const [modal] = find(harness.roots()[203], "RCTModalHostView");
  expect(modal?.props.animationType).toBe("slide");
});
