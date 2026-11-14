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
  return { applied, load: (request: string) => { expect(request).toBe("expo-location/app.plugin.js"); return plugin; } };
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
    for (const location of ["", "  ", { whenInUse: "" }, { whenInUse: "ok", background: " " }] as any[]) expect(thrown(() => locationPluginProps(location))).toBeInstanceOf(CapabilityConfigError);
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

  test("the real expo-location plugin (the QA app's) is what `load` finds and takes these props", () => {
    using project = app({ "expo-location": "~57.0.21" });
    const qa = createRequire(resolve(import.meta.dirname, "../../../apps/qa/package.json"));
    const config = withCapabilities({ name: "app", slug: "app", _internal: {} } as any, { location: "Shows the stores near you." }, { projectRoot: project.root, load: (request) => qa(request) }) as any;
    // Expo's run-once record: the auto plugin Expo would apply for an installed expo-location now does nothing.
    expect(Object.keys(config._internal.pluginHistory ?? {})).toContain("expo-location");
    expect(Object.keys(config.mods?.ios ?? {})).toContain("infoPlist");
  });
});
