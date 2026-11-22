import { describe, expect, test } from "bun:test";
import { createRunOncePlugin } from "expo/config-plugins";
import { applyAppDelegate, applySceneDelegate, applyHeadlessApplication, applyHeadlessSettings, applyMainActivity, applyPodfileAutolinkingExclude, applyPodfileVendoredLinking, leaveOutOfAutoPlugins, headlessExcludedPackages, headlessPackageSource, onDemandPackageSource } from "../../src/expo.ts";

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
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;
/** The `AppDelegate.swift` Expo's template generates (SDK 58, `expo/template.tgz`). */
const appDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // The window is created and React Native is started by \`SceneDelegate\` under the
    // scene-based life cycle (required by the iOS 27 SDK).
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;
/** The `SceneDelegate.swift` of the same template: the window is created and React Native started there. */
const sceneDelegate = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;
/** The `MainActivity.kt` Expo's template generates (SDK 58). */
const activity = `package io.example.app

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
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

type ConfigLike = Parameters<ReturnType<typeof createRunOncePlugin>>[0];

/** The relevant lines of the Podfile Expo's template generates (SDK 58). */
const podfile = `target 'RasheedSvelteQA' do
  use_expo_modules!

  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
    config_command = ['node', '-e', "process.argv=['', '', 'config'];require('@react-native-community/cli').run()"];
  else
    config_command = [
      'node',
      'expo-modules-autolinking',
      'react-native-config',
      '--json',
      '--platform',
      'ios'
    ]
  end

  config = use_native_modules!(config_command)
end
`;

describe("headless Android config", () => {
  test("MainApplication is idempotent", () => {
    const once = applyHeadlessApplication(application);
    expect(once).toContain("ExpoSvelteHeadlessMainPackage()");
    expect(once).toContain("add(expo.modules.svelteengine.ExpoViewsPackage())");
    // The updates module's bundle handler (`native-host/contracts/updates-module.test.ts`) works only while the host is still built through Expo's factory.
    expect(once).toContain("ExpoReactHostFactory.getDefaultReactHost(");
    expect(once.indexOf("reactHost.start()")).toBeGreaterThan(once.indexOf("onApplicationCreate(this)"));
    // The start-up threads are pinned to the big cores around the host start: begin before it, hand the main thread back after it.
    expect(once.indexOf("BootBoost.begin()")).toBeLessThan(once.indexOf("reactHost.start()"));
    expect(once.indexOf("BootBoost.handOver()")).toBeGreaterThan(once.indexOf("reactHost.start()"));
    // The native libraries load from attachBaseContext, the first code of the app that runs, before the content providers and onCreate.
    expect(once).toContain("override fun attachBaseContext(base: android.content.Context) {");
    expect(once.indexOf("BootBoost.preloadLibraries(base)")).toBeGreaterThan(once.indexOf("super.attachBaseContext(base)"));
    expect(once.indexOf("BootBoost.preloadLibraries(base)")).toBeLessThan(once.indexOf("override fun onCreate()"));
    expect(applyHeadlessApplication(once)).toBe(once);
  });
  test("a MainApplication that overrides attachBaseContext fails with a message, unless the override makes the call itself", () => {
    const override = (body: string) => application.replace("  override fun onCreate() {", `  override fun attachBaseContext(base: Context) {\n    super.attachBaseContext(base)\n${body}  }\n  override fun onCreate() {`);
    expect(() => applyHeadlessApplication(override(""))).toThrow("already overrides attachBaseContext");
    expect(() => applyHeadlessApplication(override(""))).toThrow("BootBoost.preloadLibraries(base)");
    const own = applyHeadlessApplication(override("    expo.modules.svelteengine.BootBoost.preloadLibraries(base)\n"));
    expect(own.match(/override fun attachBaseContext/g)).toHaveLength(1);
    expect(applyHeadlessApplication(own)).toBe(own);
    // The file the plugin generated is not a consumer's override: a second prebuild over it is fine.
    expect(() => applyHeadlessApplication(applyHeadlessApplication(application))).not.toThrow();
  });
  test("packages whose view managers are on demand are wrapped, and unwrapped again when the option goes", () => {
    const onDemand = { "com.rnmaps.maps.MapsPackage": ["RNMapsMapView", "RNMapsMarker"], "com.reactnativecommunity.webview.RNCWebViewPackage": ["RNCWebView"] };
    const once = applyHeadlessApplication(application, onDemand);
    expect(once).toContain('if (this[index] is com.rnmaps.maps.MapsPackage) this[index] = expoSvelteOnDemand(this[index], listOf("RNMapsMapView", "RNMapsMarker"))');
    expect(once).toContain('if (this[index] is com.reactnativecommunity.webview.RNCWebViewPackage) this[index] = expoSvelteOnDemand(this[index], listOf("RNCWebView"))');
    expect(applyHeadlessApplication(once, onDemand)).toBe(once);
    expect(applyHeadlessApplication(once)).toBe(applyHeadlessApplication(application));
  });
  test("the on-demand package serves the delegate's TurboModules and creates its view managers once, by name", () => {
    const source = onDemandPackageSource("io.example.app");
    expect(source).toStartWith("package io.example.app\n");
    expect(source).toContain("class ExpoSvelteOnDemandPackage(private val delegate: ReactPackage, private val names: Collection<String>) : BaseReactPackage(), ViewManagerOnDemandReactPackage");
    expect(source).toContain("delegate.createViewManagers(reactContext).associateBy { it.name }");
    expect(source).toContain("if (viewManagerName !in names) return null");
    // Announced names would each be read (and so created) by React Native's UIManager when JavaScript starts.
    expect(source).toContain("getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()");
  });
  test("a package that builds its native modules with createNativeModules keeps them: the wrapper follows the package's kind", () => {
    const source = onDemandPackageSource("io.example.app");
    // react-native-video's `VideoManager` comes from `createNativeModules`; a `BaseReactPackage` wrapper would hide it from React Native.
    expect(source).toContain("class ExpoSvelteOnDemandLegacyPackage(private val delegate: ReactPackage, private val names: Collection<String>) : ReactPackage, ViewManagerOnDemandReactPackage");
    expect(source).toContain("override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = delegate.createNativeModules(reactContext)");
    expect(source).toContain("if (delegate is BaseReactPackage) ExpoSvelteOnDemandPackage(delegate, names) else ExpoSvelteOnDemandLegacyPackage(delegate, names)");
    // Both wrappers create the package's managers once and only for the names it was given.
    expect(source.match(/if \(viewManagerName !in names\) return null/g)).toHaveLength(2);
  });
  test("MainActivity keeps the navigation in its saved state and hands it back as launch options, idempotently", () => {
    const once = applyMainActivity(activity);
    // Saved on the way to the background, read in onCreate before the template's super.onCreate(null), given to JavaScript as initialProps.navigation.
    expect(once).toContain("expo.modules.svelteengine.NavigationState.saveTo(outState)");
    expect(once).toContain("expo.modules.svelteengine.NavigationState.destroyed(isFinishing)");
    expect(once.indexOf("NavigationState.restoredFrom(savedInstanceState)")).toBeLessThan(once.indexOf("super.onCreate(null)"));
    expect(once.indexOf("NavigationState.restoredFrom(savedInstanceState)")).toBeGreaterThan(once.indexOf("setTheme(R.style.AppTheme)"));
    // The process was started for the screen (the boost holds until the first mount) and the first screen's indicator is built off the main
    // thread: both after the template's setTheme(R.style.AppTheme) (the theme the splash screen needs) and before its super.onCreate(null). The indicator takes the
    // Application's theme (the engine's views do), so nothing here depends on the theme set on the Activity.
    expect(once.indexOf("BootBoost.activityCreated()")).toBeGreaterThan(once.indexOf("setTheme(R.style.AppTheme)"));
    expect(once.indexOf("ViewWarmup.begin(this)")).toBeGreaterThan(once.indexOf("BootBoost.activityCreated()"));
    expect(once.indexOf("ViewWarmup.begin(this)")).toBeLessThan(once.indexOf("super.onCreate(null)"));
    expect(once).toContain('putString("navigation", json)');
    expect(once).toMatch(/fabricEnabled\n {10}\) \{\n[\s\S]*override fun getLaunchOptions\(\): android\.os\.Bundle\? =[\s\S]*\n {10}\}\)\n/);
    expect(applyMainActivity(once)).toBe(once);
  });
  test("MainActivity: a template without the expected shape fails with a message", () => {
    expect(() => applyMainActivity("class MainActivity : AppCompatActivity() {}")).toThrow("could not find the class, super.onCreate(null) and the ReactActivityDelegate in MainActivity.kt");
  });
  test("AppDelegate forwards the four state restoration callbacks of UIKit to the navigation module, idempotently", () => {
    const once = applyAppDelegate(appDelegate);
    // The selectors UIKit calls (UIApplicationDelegate, iOS 13.2 and later), under Swift names of their own.
    for (const selector of ["application:shouldSaveSecureApplicationState:", "application:willEncodeRestorableStateWithCoder:", "application:shouldRestoreSecureApplicationState:", "application:didDecodeRestorableStateWithCoder:"])
      expect(once).toContain(`@objc(${selector})`);
    expect(once).toContain("SvelteNavigationRestoration.shouldSave(coder)");
    expect(once).toContain("SvelteNavigationRestoration.encode(coder)");
    expect(once).toContain("SvelteNavigationRestoration.shouldRestore(coder)");
    expect(once).toContain("SvelteNavigationRestoration.didDecode(coder)");
    // Every method has as many parameters as its selector has colons.
    for (const [, selector, parameters] of once.matchAll(/@objc\(([^)]+)\)\n {2}func \w+\(([^)]*)\)/g)) expect([selector, (parameters as string).split(",").length]).toEqual([selector, (selector as string).split(":").length - 1]);
    // The import follows the others, the methods are inside AppDelegate (before `class ReactNativeDelegate`), after the stored properties.
    // Expo's generated ExpoModulesProvider imports the module as `internal import`; a plain import in the app target is "ambiguous" to the compiler (the first iPhone build said so).
    expect(once).toContain("\ninternal import SvelteCore //");
    expect(once.indexOf("import SvelteCore")).toBeGreaterThan(once.indexOf("import ReactAppDependencyProvider"));
    expect(once.indexOf("import SvelteCore")).toBeLessThan(once.indexOf("@main"));
    expect(once.indexOf("var reactNativeFactory")).toBeLessThan(once.indexOf("@objc(application:shouldSaveSecureApplicationState:)"));
    expect(once.indexOf("@objc(application:didDecodeRestorableStateWithCoder:)")).toBeLessThan(once.indexOf("didFinishLaunchingWithOptions"));
    expect(once.indexOf("@objc(application:didDecodeRestorableStateWithCoder:)")).toBeLessThan(once.indexOf("class ReactNativeDelegate"));
    // What was there is still there, once, and applying again changes nothing.
    expect(once.replace(/\n {2}\/\/ Svelte native: navigation state restoration[\s\S]*?end of navigation state restoration/, "").replace(/^internal import SvelteCore.*\n/m, "")).toBe(appDelegate);
    expect(applyAppDelegate(once)).toBe(once);
    expect(once.match(/import SvelteCore/g)).toHaveLength(1);
  });
  test("AppDelegate: the import an older version wrote (the module was the pod SvelteNavigation) is replaced, not kept beside the new one", () => {
    const once = applyAppDelegate(appDelegate);
    const older = once.replace("internal import SvelteCore //", "internal import SvelteNavigation //");
    expect(applyAppDelegate(older)).toBe(once);
  });
  test("SceneDelegate (Expo SDK 58's template: React Native starts there) answers the scene's state restoration and notes the saved activity before React Native starts, idempotently", () => {
    const once = applySceneDelegate(sceneDelegate);
    expect(once).toContain("func stateRestorationActivity(for scene: UIScene) -> NSUserActivity?");
    expect(once).toContain("SvelteNavigationRestoration.stateRestorationActivity()");
    expect(once).toContain("override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions)");
    expect(once).toContain("SvelteNavigationRestoration.sceneWillConnect(session.stateRestorationActivity)");
    // The session is read before ExpoAppSceneDelegate starts React Native (its `willConnectTo` calls `startReactNative`).
    expect(once.indexOf("sceneWillConnect(")).toBeLessThan(once.indexOf("super.scene(scene, willConnectTo: session, options: connectionOptions)"));
    // The two imports follow the template's, the methods are the class's first members; UIKit is imported because the methods name its types.
    expect(once).toContain("\ninternal import SvelteCore //");
    expect(once).toContain("\nimport UIKit //");
    expect(once.indexOf("import SvelteCore")).toBeGreaterThan(once.indexOf("internal import Expo"));
    expect(once.indexOf("import SvelteCore")).toBeLessThan(once.indexOf("class SceneDelegate"));
    expect(once.indexOf("class SceneDelegate")).toBeLessThan(once.indexOf("stateRestorationActivity(for scene"));
    expect(once.indexOf("end of navigation state restoration")).toBeLessThan(once.indexOf("// Extension point for config plugins."));
    // What was there is still there, once, and applying again changes nothing.
    expect(once.replace(/\n {2}\/\/ Svelte native: navigation state restoration[\s\S]*?end of navigation state restoration/, "").replace(/^(?:internal )?import \w+ \/\/ Svelte native.*\n/gm, "")).toBe(sceneDelegate);
    expect(applySceneDelegate(once)).toBe(once);
    expect(once.match(/import SvelteCore/g)).toHaveLength(1);
    expect(once.match(/import UIKit/g)).toHaveLength(1);
  });
  test("SceneDelegate: a file without the expected shape fails with a message", () => {
    expect(() => applySceneDelegate("import UIKit\nclass SceneDelegate: UIResponder {}")).toThrow("could not find the imports and `class SceneDelegate: ExpoAppSceneDelegate` in SceneDelegate.swift");
  });
  test("AppDelegate: a template without the expected shape fails with a message", () => {
    expect(() => applyAppDelegate("import UIKit\n@main class AppDelegate: UIResponder {}")).toThrow("could not find the imports and `var reactNativeFactory: RCTReactNativeFactory?` in AppDelegate.swift");
  });
  test("settings.gradle is idempotent", () => {
    const once = applyHeadlessSettings(settings);
    for (const name of headlessExcludedPackages) expect(once).toContain(`"${name}"`);
    expect(once).toContain("rnConfigCommand + expoSvelteExcludeArgs");
    expect(applyHeadlessSettings(once)).toBe(once);
  });
  test("settings.gradle: React Native's config command runs through the library's android-autolinking, found from the app, and so does the community CLI's", () => {
    const once = applyHeadlessSettings(settings);
    expect(once).toContain("ex.autolinkLibrariesFromCommand(expoSvelteConfigCommand + expoAutolinking.rnConfigCommand + expoSvelteExcludeArgs, expoSvelteAppRoot.asFile, expoSvelteLockFiles)");
    // React Native's lockfiles (its default for the command's cache), the CLI and settings.gradle itself: a new library version, and a changed `libraries` (its `--link` arguments), run the command again.
    expect(once).toContain('expoSvelteAppRoot.files("yarn.lock", "package-lock.json", "package.json", "react-native.config.js", expoSvelteCli, new File(settingsDir, "settings.gradle").toString())');
    expect(once).toContain(`commandLine("node", "--print", "require.resolve('expo-svelte/package.json')")`);
    expect(once).toContain('.resolve("dist/node/cli.js")');
    expect(once).toContain('def expoSvelteConfigCommand = ["node", expoSvelteCli, "android-autolinking"]');
    // The definitions come before the block that uses them.
    expect(once.indexOf("def expoSvelteConfigCommand")).toBeLessThan(once.indexOf("extensions.configure(com.facebook.react.ReactSettingsExtension)"));
    const community = `
extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  if (System.getenv('EXPO_USE_COMMUNITY_AUTOLINKING') == '1') {
    ex.autolinkLibrariesFromCommand()
  } else {
    ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)
  }
}
`;
    // The copies are in no package.json, so the community CLI's command (React Native's default, `cmd /c` first on Windows) goes through android-autolinking too, with React Native's cache files.
    const wrapped = applyHeadlessSettings(community);
    expect(wrapped).toContain("    ex.autolinkLibrariesFromCommand(expoSvelteConfigCommand + expoSvelteCommunityCommand, expoSvelteAppRoot.asFile, expoSvelteLockFiles)\n");
    expect(wrapped).toContain('def expoSvelteCommunityCommand = (System.getProperty("os.name").toLowerCase().contains("windows") ? ["cmd", "/c"] : []) + ["npx", "@react-native-community/cli", "config"]');
    expect(wrapped).not.toContain("ex.autolinkLibrariesFromCommand()");
    expect(applyHeadlessSettings(wrapped)).toBe(wrapped);
  });
  test("settings.gradle: the block an older version wrote (no android-autolinking) is replaced by the new one", () => {
    // What 0.4.0-rc.8 wrote: the block before the extension, and the command with the excludes only.
    const older = `
// Svelte native: headless autolinking excludes (generated, do not edit)
def expoSvelteExclude = ["react-native-screens"]
def expoSvelteExcludeArgs = expoSvelteExclude.collectMany { ["--exclude", it] }
expoAutolinking.exclude = expoSvelteExclude
// Svelte native: end of headless autolinking excludes
${settings.trimStart().replace("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)", "autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand + expoSvelteExcludeArgs)")}`;
    expect(applyHeadlessSettings(older)).toBe(applyHeadlessSettings(settings));
    // And the one this branch's first version wrote (the command through android-autolinking, React Native's default cache).
    const first = applyHeadlessSettings(settings).replace(", expoSvelteAppRoot.asFile, expoSvelteLockFiles)", ")");
    expect(applyHeadlessSettings(first)).toBe(applyHeadlessSettings(settings));
  });
  test("settings.gradle: extra packages join the headless ones in both lists, and go again with the option", () => {
    const extra = ["react-native-mmkv", "@sentry/react-native", "expo-haptics"];
    const once = applyHeadlessSettings(settings, extra);
    for (const name of [...headlessExcludedPackages, ...extra]) expect(once).toContain(`"${name}"`);
    expect(once.match(/def expoSvelteExclude = \[(.*)\]/)?.[1]?.split(", ")).toHaveLength(headlessExcludedPackages.length + extra.length);
    expect(applyHeadlessSettings(once, extra)).toBe(once);
    expect(applyHeadlessSettings(once)).toBe(applyHeadlessSettings(settings));
    // A package named twice (the product list and the headless list) is excluded once.
    expect(applyHeadlessSettings(settings, ["expo-updates"]).match(/"expo-updates"/g)).toHaveLength(1);
  });
  test("Podfile: Expo's use_expo_modules! and the React Native config command both get the excludes", () => {
    const names = ["react-native-mmkv", "@react-native-firebase/app"];
    const once = applyPodfileAutolinkingExclude(podfile, names);
    expect(once).toContain('expo_svelte_exclude = ["react-native-mmkv", "@react-native-firebase/app"]');
    expect(once).toContain("use_expo_modules!(exclude: expo_svelte_exclude)");
    expect(once).toContain("config_command += expo_svelte_exclude.flat_map { |name| ['--exclude', name] }");
    // The list is defined before both uses, and the command is extended before the config is read from it.
    expect(once.indexOf("expo_svelte_exclude = [")).toBeLessThan(once.indexOf("use_expo_modules!(exclude"));
    expect(once.indexOf("config_command +=")).toBeLessThan(once.indexOf("config = use_native_modules!(config_command)"));
    expect(once.indexOf("config_command +=")).toBeGreaterThan(once.indexOf("config_command = ["));
    expect(applyPodfileAutolinkingExclude(once, names)).toBe(once);
    expect(applyPodfileAutolinkingExclude(once, [])).toBe(podfile);
    expect(applyPodfileAutolinkingExclude(podfile, [])).toBe(podfile);
  });
  test("Podfile: the config command goes through the library's ios-autolinking, which adds the vendored packages (the app lists none of them)", () => {
    const once = applyPodfileVendoredLinking(podfile);
    expect(once).toContain("# Svelte native: the packages the library carries are linked from its own directory (generated, do not edit)");
    // The CLI is found from the app, as Expo's own lines find expo, and runs around the command that is already there.
    expect(once).toContain("require.resolve('expo-svelte/package.json')");
    expect(once).toContain("File.join(File.dirname(`node --print");
    expect(once).toContain("'dist/node/cli.js')");
    expect(once).toContain("config_command = ['node', expo_svelte_cli, 'ios-autolinking'] + config_command");
    // Both branches of the template have set config_command by then, and the config is read from it after.
    expect(once.indexOf("config_command = ['node', expo_svelte_cli")).toBeGreaterThan(once.indexOf("  end\n"));
    expect(once.indexOf("config_command = ['node', expo_svelte_cli")).toBeLessThan(once.indexOf("config = use_native_modules!(config_command)"));
    expect(once.endsWith("  # Svelte native: end of the library's own packages\n  config = use_native_modules!(config_command)\nend\n")).toBe(true);
  });
  test("Podfile: the vendored linking is idempotent, replaces itself, and goes with the excludes in either order", () => {
    const once = applyPodfileVendoredLinking(podfile);
    expect(applyPodfileVendoredLinking(once)).toBe(once);
    // The block is replaced, not stacked, when an older one is there.
    expect(applyPodfileVendoredLinking(once.replace("'ios-autolinking'", "'ios-autolinking-old'"))).toBe(once);
    expect(once.match(/ios-autolinking/g)).toHaveLength(1);
    const names = ["react-native-pdf", "@react-native-firebase/app"];
    // What a prebuild does: the excludes, then the vendored linking; and again on the next prebuild, over what is there.
    const prebuild = (contents: string) => applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(contents, names));
    const first = prebuild(podfile);
    expect(prebuild(first)).toBe(first);
    expect(first).toContain("config_command += expo_svelte_exclude.flat_map");
    // Both extend the command before the config is read, and a Podfile that had them in the other order is put in this one by the next prebuild.
    expect(first.indexOf("config_command += expo_svelte_exclude")).toBeLessThan(first.indexOf("config = use_native_modules!(config_command)"));
    expect(first.indexOf("config_command = ['node', expo_svelte_cli")).toBeLessThan(first.indexOf("config = use_native_modules!(config_command)"));
    expect(prebuild(applyPodfileAutolinkingExclude(applyPodfileVendoredLinking(podfile), names))).toBe(first);
    // A variant without excludes loses them and keeps the linking.
    const without = applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(first, []));
    expect(without).toBe(once);
  });
  test("Podfile: without the line that reads the config the vendored linking fails with a message", () => {
    expect(() => applyPodfileVendoredLinking("target 'App' do\nend\n")).toThrow("could not find use_native_modules!(config_command) in the Podfile");
  });
  test("Podfile: a template without the expected lines fails with a message", () => {
    expect(() => applyPodfileAutolinkingExclude("target 'App' do\nend\n", ["react-native-mmkv"])).toThrow("could not find use_expo_modules! and use_native_modules!(config_command) in the Podfile");
  });
  test("Expo's auto plugins skip the excluded packages: they are in the plugin history before the prebuild applies its own", () => {
    const config: { _internal?: Record<string, unknown> } = { _internal: { projectRoot: "/app" } };
    leaveOutOfAutoPlugins(config, ["expo-location", "expo-local-authentication"]);
    const history = config._internal?.pluginHistory as Record<string, { name: string }>;
    expect(Object.keys(history)).toEqual(["expo-location", "expo-local-authentication"]);
    expect(history["expo-location"]?.name).toBe("expo-location");
    expect(config._internal?.projectRoot).toBe("/app");
    // `withRunOnce` looks a plugin up by name in this history and returns the config as it is.
    let ran = false;
    const runOnce = createRunOncePlugin((config: ConfigLike) => { ran = true; return config; }, "expo-location", "57.0.0");
    runOnce(config as ConfigLike);
    expect(ran).toBe(false);
    // A package that is not excluded still runs its plugin, and an entry already there stays.
    createRunOncePlugin((config: ConfigLike) => { ran = true; return config; }, "expo-haptics", "57.0.0")(config as ConfigLike);
    expect(ran).toBe(true);
    const early: { _internal?: Record<string, unknown> } = { _internal: { pluginHistory: { a: { name: "a", version: "1" } } } };
    leaveOutOfAutoPlugins(early, ["a", "b"]);
    expect((early._internal?.pluginHistory as Record<string, { version: string }> | undefined)?.a?.version).toBe("1");
    const untouched: { _internal?: Record<string, unknown> } = {};
    expect(leaveOutOfAutoPlugins(untouched, [])).toBe(untouched);
    expect(untouched._internal).toBeUndefined();
  });
  test("settings.gradle excludes the local modules the variant leaves out, for Expo and React Native autolinking, and replaces them on the next prebuild", () => {
    const product = applyHeadlessSettings(settings, ["svelte-qa-android", "svelte-qa-ios"]);
    expect(product).toContain('def expoSvelteExclude = ["react-native-screens"');
    const list = /def expoSvelteExclude = \[([^\]]*)\]/.exec(product)?.[1] ?? "";
    for (const name of [...headlessExcludedPackages, "svelte-qa-android", "svelte-qa-ios"]) expect(list).toContain(`"${name}"`);
    // Both autolinkers read the same list.
    expect(product).toContain("expoAutolinking.exclude = expoSvelteExclude");
    expect(product).toContain("rnConfigCommand + expoSvelteExcludeArgs");
    expect(applyHeadlessSettings(product, ["svelte-qa-android", "svelte-qa-ios"])).toBe(product);
    // The QA variant after a product prebuild on the same directory: the exclusion is gone.
    const qa = applyHeadlessSettings(product, []);
    expect(qa).not.toContain("svelte-qa");
    expect(qa).toBe(applyHeadlessSettings(settings));
  });
  test("the Podfile carries the product's exclusion (smoke libraries and QA modules) for both autolinkers, idempotently, and loses it for the next variant", () => {
    const qaModules = ["svelte-qa-ios", "view-bench"];
    const product = applyPodfileAutolinkingExclude(podfile, ["react-native-mmkv", ...qaModules]);
    expect(product).toContain('expo_svelte_exclude = ["react-native-mmkv", "svelte-qa-ios", "view-bench"]');
    expect(product).toContain("use_expo_modules!(exclude: expo_svelte_exclude)");
    expect(product).toContain("config_command += expo_svelte_exclude.flat_map");
    expect(applyPodfileAutolinkingExclude(product, ["react-native-mmkv", ...qaModules])).toBe(product);
    // The QA variant after a product prebuild on the same directory: the QA modules are gone, the smoke libraries stay out.
    const qa = applyPodfileAutolinkingExclude(product, ["react-native-mmkv"]);
    expect(qa).not.toContain("svelte-qa-ios");
    expect(qa).toContain('expo_svelte_exclude = ["react-native-mmkv"]');
    // The smoke variant excludes nothing smoke-related, and the template is back.
    expect(applyPodfileAutolinkingExclude(product, [])).toBe(podfile);
  });
  test("package source targets the application id", () => {
    expect(headlessPackageSource("io.example.app")).toStartWith("package io.example.app\n");
  });
});

describe("the React Native flags every app gets", () => {
  test("view preallocation is off and prepared text layouts are on without any option, and an app can still override either", async () => {
    const { androidFeatureFlagsFor, defaultAndroidFeatureFlags } = await import("../../src/expo.ts");
    expect(defaultAndroidFeatureFlags).toEqual({ disableViewPreallocationAndroid: true, enablePreparedTextLayout: true });
    expect(androidFeatureFlagsFor()).toEqual({ disableViewPreallocationAndroid: true, enablePreparedTextLayout: true });
    expect(androidFeatureFlagsFor({ androidFeatureFlags: { enablePreparedTextLayout: false } })).toEqual({ disableViewPreallocationAndroid: true, enablePreparedTextLayout: false });
    expect(androidFeatureFlagsFor({ androidViewRecycling: true })).toMatchObject({ disableViewPreallocationAndroid: true, enableViewRecyclingForView: true });
  });
});
