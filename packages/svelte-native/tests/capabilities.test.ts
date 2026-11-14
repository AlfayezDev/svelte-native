// The `capabilities` option of the Expo config plugin (`src/capabilities.ts`): a capability gives its library's plugin the app's texts, and the half-made states
// (on without the library, the library without the capability, the capability and the library's own plugin entry both) stop the prebuild.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CapabilityConfigError, locationPluginProps, withCapabilities } from "../src/capabilities.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function app(dependencies: Record<string, string>): { root: string; [Symbol.dispose](): void } {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "svelte-native-capabilities-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", dependencies }));
  return { root, [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }) };
}

const thrown = (call: () => unknown): Error => { try { call(); } catch (error) { return error as Error; } throw new Error("did not throw"); };

/** A stand-in for expo-location's config plugin: records the props it was applied with. */
function fakePlugin() {
  const applied: Record<string, unknown>[] = [];
  const plugin = (config: any, props: Record<string, unknown>) => { applied.push(props); return { ...config, applied: true }; };
  return { applied, load: (request: string) => (request === "expo-location/package.json" ? { name: "expo-location" } : (expect(request).toBe("expo-location/app.plugin.js"), plugin)) };
}

describe("capabilities.location", () => {
  test("a string is the while-in-use text; nothing of the background unless it is asked for", () => {
    expect(locationPluginProps("Shows the stores near you.")).toEqual({
      locationWhenInUsePermission: "Shows the stores near you.",
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
    });
    expect(locationPluginProps({ whenInUse: "Shows the stores near you.", background: "Tells you when you reach the store." })).toEqual({
      locationWhenInUsePermission: "Shows the stores near you.",
      locationAlwaysAndWhenInUsePermission: "Tells you when you reach the store.",
      locationAlwaysPermission: "Tells you when you reach the store.",
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
    });
  });

  test("an empty text is refused: it is what the user reads when the app asks", () => {
    for (const location of ["", "  ", { whenInUse: "" }, { whenInUse: "ok", background: " " }, { whenInUse: "ok", motion: "" }] as any[]) expect(thrown(() => locationPluginProps(location))).toBeInstanceOf(CapabilityConfigError);
  });

  test("a motion text is passed as expo-location's NSMotionUsageDescription; without one, expo-location writes its own", () => {
    expect(locationPluginProps({ whenInUse: "Shows the stores near you.", motion: "Counts your steps." }).motionUsagePermission).toBe("Counts your steps.");
    expect("motionUsagePermission" in locationPluginProps("Shows the stores near you.")).toBe(false);
  });

  test("on, while expo-location is left out of autolinking: refused, since its plugin would silently do nothing", () => {
    using project = app({ "expo-location": "~57.0.21" });
    expect(thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load: fakePlugin().load, excluded: ["expo-location"] })).message)
      .toContain("expo-location is left out of autolinking");
    using inManifest = app({ "expo-location": "~57.0.21" });
    writeFileSync(join(inManifest.root, "package.json"), JSON.stringify({ name: "app", dependencies: { "expo-location": "~57.0.21" }, expo: { autolinking: { ios: { exclude: ["expo-location"] } } } }));
    expect(thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: inManifest.root, load: fakePlugin().load })).message).toContain("left out of autolinking");
    // Off, the package.json's exclusion is honored like the plugin's: nothing to say.
    const config = { name: "app" };
    expect(withCapabilities(config, { location: false }, { projectRoot: inManifest.root })).toBe(config);
  });

  test("an expo-location whose plugin fails to load is reported as that, not as missing", () => {
    using project = app({ "expo-location": "~57.0.21" });
    const load = (request: string) => { if (request.endsWith("package.json")) return {}; throw new Error("Cannot find module '@expo/image-utils'"); };
    expect(thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load })).message).toBe("expo-location's config plugin (expo-location/app.plugin.js) failed to load: Cannot find module '@expo/image-utils'");
  });

  test("on, with expo-location installed: its plugin is applied with the texts", () => {
    using project = app({ "expo-location": "~57.0.21" });
    const { applied, load } = fakePlugin();
    const result = withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load }) as any;
    expect(result.applied).toBe(true);
    expect(applied).toEqual([locationPluginProps("Shows the stores near you.")]);
  });

  test("on, without expo-location: the prebuild stops and says what to install", () => {
    using project = app({});
    const error = thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load: () => { throw new Error("Cannot find module"); } }));
    expect([error.name, error.message]).toEqual(["CapabilityConfigError", "capabilities.location needs expo-location, which is not installed: `npx expo install expo-location`, then prebuild again."]);
  });

  test("expo-location installed, the capability off: the prebuild stops instead of shipping Expo's default text", () => {
    using project = app({ "expo-location": "~57.0.21" });
    const error = thrown(() => withCapabilities({ name: "app" }, undefined, { projectRoot: project.root, load: fakePlugin().load }));
    expect(error).toBeInstanceOf(CapabilityConfigError);
    expect(error.message).toContain("expo-location is installed, but the location capability is off");
    expect(error.message).toContain('capabilities: { location: "Shows the stores near you." }');
    expect(thrown(() => withCapabilities({ name: "app" }, {}, { projectRoot: project.root })).message).toContain("the location capability is off");
    expect(thrown(() => withCapabilities({ name: "app" }, { location: false }, { projectRoot: project.root })).message).toContain("the location capability is off");
  });

  test("off, and expo-location not installed or left out of autolinking: nothing changes", () => {
    using bare = app({ expo: "~57.0.27" });
    const config = { name: "app" };
    expect(withCapabilities(config, undefined, { projectRoot: bare.root })).toBe(config);
    using excluded = app({ "expo-location": "~57.0.21" });
    expect(withCapabilities(config, undefined, { projectRoot: excluded.root, excluded: ["expo-location"] })).toBe(config);
  });

  test("expo-location's own plugin entry configures it: no capability is needed, and both at once are refused", () => {
    using project = app({ "expo-location": "~57.0.21" });
    for (const entry of ["expo-location", ["expo-location", { locationWhenInUsePermission: "Shows the stores near you." }]]) {
      const config = { name: "app", plugins: [entry] };
      expect(withCapabilities(config, undefined, { projectRoot: project.root })).toBe(config);
      const error = thrown(() => withCapabilities(config, { location: "Shows the stores near you." }, { projectRoot: project.root, load: fakePlugin().load }));
      expect([error.name, error.message.startsWith("The app config sets capabilities.location and also lists expo-location's own plugin")]).toEqual(["CapabilityConfigError", true]);
    }
  });

  test("the real expo-location plugin writes the texts into Info.plist, and none for the background unless asked", async () => {
    using project = app({ "expo-location": "~57.0.21" });
    // The optional peer, installed with the library's development dependencies.
    const library = createRequire(resolve(import.meta.dirname, "../package.json"));
    const { compileModsAsync } = library("expo/config-plugins") as typeof import("expo/config-plugins");
    const plist = async (location: any) => {
      const base = { name: "app", slug: "app", _internal: { projectRoot: project.root }, ios: { infoPlist: { NSLocationAlwaysUsageDescription: "stale" } } };
      const config = withCapabilities(base as any, { location }, { projectRoot: project.root, load: (request) => library(request) }) as any;
      // Expo's run-once record: the auto plugin Expo applies for an installed expo-location now does nothing.
      expect(Object.keys(config._internal.pluginHistory ?? {})).toContain("expo-location");
      const compiled = await compileModsAsync(config, { projectRoot: project.root, introspect: true, platforms: ["ios"], assertMissingModProviders: false });
      return (compiled.ios?.infoPlist ?? {}) as Record<string, unknown>;
    };
    const plain = await plist("Shows the stores near you.");
    expect(plain.NSLocationWhenInUseUsageDescription).toBe("Shows the stores near you.");
    expect(["NSLocationAlwaysAndWhenInUseUsageDescription" in plain, "NSLocationAlwaysUsageDescription" in plain, "UIBackgroundModes" in plain]).toEqual([false, false, false]);
    // CoreMotion is linked with expo-location: the motion key is always there, expo-location's text unless the app gives one.
    expect(String(plain.NSMotionUsageDescription)).toContain("motion activity");
    const full = await plist({ whenInUse: "Shows the stores near you.", background: "Tells you when you reach the store.", motion: "Counts your steps." });
    expect([full.NSLocationAlwaysAndWhenInUseUsageDescription, full.NSMotionUsageDescription, full.UIBackgroundModes]).toEqual(["Tells you when you reach the store.", "Counts your steps.", ["location"]]);
  });
});
