import { describe, expect, test } from "bun:test";
import { applyAutolinkingExcludePodfile, applyHeadlessApplication, applyHeadlessSettings, applyMainActivity, headlessExcludedPackages, headlessPackageSource, onDemandPackageSource } from "../src/expo.ts";

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
/** The `MainActivity.kt` Expo's template generates (SDK 57, with the splash screen plugin's block). */
const activity = `package io.example.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
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
  test("MainActivity keeps the navigation in its saved state and hands it back as launch options, idempotently", () => {
    const once = applyMainActivity(activity);
    // Saved on the way to the background, read in onCreate before the template's super.onCreate(null), given to JavaScript as initialProps.navigation.
    expect(once).toContain("expo.modules.svelteengine.NavigationState.saveTo(outState)");
    expect(once).toContain("expo.modules.svelteengine.NavigationState.destroyed(isFinishing)");
    expect(once.indexOf("NavigationState.restoredFrom(savedInstanceState)")).toBeLessThan(once.indexOf("super.onCreate(null)"));
    expect(once.indexOf("NavigationState.restoredFrom(savedInstanceState)")).toBeGreaterThan(once.indexOf("expo-splashscreen"));
    expect(once).toContain('putString("navigation", json)');
    expect(once).toMatch(/fabricEnabled\n {10}\) \{\n[^]*override fun getLaunchOptions\(\): android\.os\.Bundle\? =[^]*\n {10}\}\)\n/);
    expect(applyMainActivity(once)).toBe(once);
  });
  test("MainActivity: a template without the expected shape fails with a message", () => {
    expect(() => applyMainActivity("class MainActivity : AppCompatActivity() {}")).toThrow("could not find the class, super.onCreate(null) and the ReactActivityDelegate in MainActivity.kt");
  });
  test("settings.gradle is idempotent", () => {
    const once = applyHeadlessSettings(settings);
    for (const name of headlessExcludedPackages) expect(once).toContain(`"${name}"`);
    expect(once).toContain("rnConfigCommand + svelteNativeExcludeArgs");
    expect(applyHeadlessSettings(once)).toBe(once);
  });
  test("settings.gradle excludes the local modules the variant leaves out, for Expo and React Native autolinking, and replaces them on the next prebuild", () => {
    const product = applyHeadlessSettings(settings, ["svelte-qa-android", "svelte-qa-ios"]);
    expect(product).toContain('def svelteNativeExclude = ["react-native-screens"');
    const list = /def svelteNativeExclude = \[([^\]]*)\]/.exec(product)?.[1] ?? "";
    for (const name of [...headlessExcludedPackages, "svelte-qa-android", "svelte-qa-ios"]) expect(list).toContain(`"${name}"`);
    // Both autolinkers read the same list.
    expect(product).toContain("expoAutolinking.exclude = svelteNativeExclude");
    expect(product).toContain("rnConfigCommand + svelteNativeExcludeArgs");
    expect(applyHeadlessSettings(product, ["svelte-qa-android", "svelte-qa-ios"])).toBe(product);
    // The QA variant after a product prebuild on the same directory: the exclusion is gone.
    const qa = applyHeadlessSettings(product, []);
    expect(qa).not.toContain("svelte-qa");
    expect(qa).toBe(applyHeadlessSettings(settings));
  });
  test("the Podfile's use_expo_modules! carries the exclusion, idempotently, and loses it for the next variant", () => {
    const podfile = "target 'App' do\n  use_expo_modules!\n\n  config_command = ['npx']\nend\n";
    const product = applyAutolinkingExcludePodfile(podfile, ["svelte-qa-ios"]);
    expect(product).toContain("use_expo_modules!(exclude: ['svelte-qa-ios'])");
    expect(product).toContain("config_command = ['npx']");
    expect(applyAutolinkingExcludePodfile(product, ["svelte-qa-ios"])).toBe(product);
    expect(applyAutolinkingExcludePodfile(product, ["svelte-qa-ios", "view-bench"])).toContain("use_expo_modules!(exclude: ['svelte-qa-ios', 'view-bench'])");
    expect(applyAutolinkingExcludePodfile(product, [])).toBe(podfile);
    expect(applyAutolinkingExcludePodfile(podfile, [])).toBe(podfile);
    expect(() => applyAutolinkingExcludePodfile("target 'App' do\nend\n", ["svelte-qa-ios"])).toThrow("could not find use_expo_modules! in the Podfile");
  });
  test("package source targets the application id", () => {
    expect(headlessPackageSource("io.example.app")).toStartWith("package io.example.app\n");
  });
});
