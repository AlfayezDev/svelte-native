import { describe, expect, test } from "bun:test";
import { applyHeadlessApplication, applyHeadlessSettings, headlessExcludedPackages, headlessPackageSource, onDemandPackageSource } from "../src/expo.ts";

const application = `class MainApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
  override fun onCreate() {
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;
const settings = `
extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)
}
expoAutolinking.useExpoModules()
`;

describe("headless Android config", () => {
  test("MainApplication is idempotent", () => {
    const once = applyHeadlessApplication(application);
    expect(once).toContain("SvelteNativeHeadlessMainPackage()");
    expect(once).toContain("add(expo.modules.svelteengine.ExpoViewsPackage())");
    expect(once.indexOf("reactHost.start()")).toBeGreaterThan(once.indexOf("onApplicationCreate(this)"));
    expect(applyHeadlessApplication(once)).toBe(once);
  });
  test("packages whose view managers are on demand are wrapped, and unwrapped again when the option goes", () => {
    const onDemand = { "com.rnmaps.maps.MapsPackage": ["RNMapsMapView", "RNMapsMarker"], "com.reactnativecommunity.webview.RNCWebViewPackage": ["RNCWebView"] };
    const once = applyHeadlessApplication(application, onDemand);
    expect(once).toContain('if (this[index] is com.rnmaps.maps.MapsPackage) this[index] = SvelteNativeOnDemandPackage(this[index], listOf("RNMapsMapView", "RNMapsMarker"))');
    expect(once).toContain('if (this[index] is com.reactnativecommunity.webview.RNCWebViewPackage) this[index] = SvelteNativeOnDemandPackage(this[index], listOf("RNCWebView"))');
    expect(applyHeadlessApplication(once, onDemand)).toBe(once);
    expect(applyHeadlessApplication(once)).toBe(applyHeadlessApplication(application));
  });
  test("the on-demand package serves the delegate's TurboModules and creates its view managers once, by name", () => {
    const source = onDemandPackageSource("io.example.app");
    expect(source).toStartWith("package io.example.app\n");
    expect(source).toContain("class SvelteNativeOnDemandPackage(private val delegate: ReactPackage, private val names: Collection<String>) : BaseReactPackage(), ViewManagerOnDemandReactPackage");
    expect(source).toContain("delegate.createViewManagers(reactContext).associateBy { it.name }");
    expect(source).toContain("if (viewManagerName !in names) return null");
    // Announced names would each be read (and so created) by React Native's UIManager when JavaScript starts.
    expect(source).toContain("getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()");
  });
  test("settings.gradle is idempotent", () => {
    const once = applyHeadlessSettings(settings);
    for (const name of headlessExcludedPackages) expect(once).toContain(`"${name}"`);
    expect(once).toContain("rnConfigCommand + svelteNativeExcludeArgs");
    expect(applyHeadlessSettings(once)).toBe(once);
  });
  test("package source targets the application id", () => {
    expect(headlessPackageSource("io.example.app")).toStartWith("package io.example.app\n");
  });
});
