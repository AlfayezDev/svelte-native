import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withAndroidManifest, withAppBuildGradle, withAppDelegate, withDangerousMod, withMainActivity, withMainApplication, withPodfile, withSettingsGradle, type ConfigPlugin } from "expo/config-plugins";
import { syncNative } from "./build.ts";
import type { RemoteHostConfig } from "./remote/host.ts";
import { withRemoteHost } from "./remote/plugin.ts";

export type ViewRecycling = { view?: boolean; text?: boolean; image?: boolean; scrollView?: boolean };
export type SvelteNativeOptions = {
  /**
   * Reuse Android native views across mounts through React Native's view recycling flags.
   * `true` recycles `<View>` and `<Text>`; pass an object to choose per view manager.
   * Keyed Svelte lists replace many native views at once, and creating a React Native
   * Android view costs about half a millisecond on mid-range phones.
   */
  androidViewRecycling?: boolean | ViewRecycling;
  /** Marks the Android app `<profileable android:shell="true">`, so Perfetto and simpleperf can sample its stacks on a release build. For QA builds. */
  androidProfileable?: boolean;
  /** React Native Android feature flags to force (`ReactNativeFeatureFlags.dangerouslyForceOverride`), by method name. The engine spike switches view preallocation off with these. */
  androidFeatureFlags?: Record<string, boolean>;
  /**
   * Packages whose view managers React Native creates on first use instead of at host start: the package's class name
   * (as autolinking lists it in `PackageList`) to the Fabric component names it provides. React Native builds the view
   * managers of every package that does not offer them on demand when the host starts (the JavaScript thread, before the
   * first commit); a package such as react-native-maps creates a dozen. The package keeps providing its modules: TurboModules
   * through `getModule`, and the legacy modules of a package that still uses `createNativeModules` (react-native-video).
   */
  androidOnDemandViewManagers?: Record<string, string[]>;
  /**
   * Packages and local Expo modules (directories of `modules/`, or packages) both autolinkers leave out of this build, by name,
   * on top of the headless ones: Expo's (`expoAutolinking.exclude` in `settings.gradle`, `use_expo_modules!(exclude:)` in the
   * Podfile) and React Native's (`--exclude` on the config command both pass). One list serves two purposes: the libraries of the
   * native module smoke test, which only the smoke app links, and code that only a QA build needs (the touch injector, the iOS QA
   * modules, the view bench), which the product leaves out so the class is not compiled into the app at all. Prebuild writes the
   * list every time, so one directory can be prebuilt for one variant and then for the other.
   */
  autolinkingExclude?: string[];
  /**
   * The SvelteKit server the app's remote functions (`*.remote.ts`) call: `{ origin, base?, appDir? }`. It is validated here, written to
   * `extra.svelteNative.remote` (where the runtime reads it, from the manifest `expo-constants` embeds) and, for an `http:` origin, the
   * Android and iOS builds are allowed to use plain HTTP to it. Leave it out and the app has no host: a remote function throws when called
   * until `configureRemote({ origin })` sets one.
   */
  remote?: RemoteHostConfig;
};

/**
 * The Android build is headless: no React host, so native boot is trimmed. AndroidX `EmojiCompatInitializer` is removed,
 * the packages below leave autolinking, `MainReactPackage` is swapped for one without Fresco (its eager initialization
 * costs ~13 ms and the engine loads images itself), and the React host starts from `Application.onCreate` so the Hermes
 * instance initializes while the activity is created.
 */
/** Autolinked packages the build leaves out, passed to both Expo and React Native autolinking in `settings.gradle`. */
export const headlessExcludedPackages = [
  "react-native-screens",
  "react-native-safe-area-context",
  "expo-updates", // the engine host ships its own updates module (modules/svelte-updates); this package only lets `eas update` run
  "expo-dev-client",
  "expo-dev-launcher",
  "expo-dev-menu",
  "expo-dev-menu-interface",
  "expo-updates-interface",
  "expo-manifests",
  "expo-json-utils",
  "@expo/log-box",
  "@expo/dom-webview",
];
/** TurboModules the headless `MainReactPackage` replacement does not offer. Fresco is `needsEagerInit`; ImageLoader and ImageStore need it. */
export const headlessDroppedTurboModules = ["FrescoModule", "ImageLoader", "ImageStoreManager"];

const bundleMarker = "// Svelte native: bundle the current Metro graph on every release build.";
const flagsBegin = "    // Svelte native: React Native feature flags (generated, do not edit)";
const flagsEnd = "    // Svelte native: end of React Native feature flags";
const headlessPackageName = "SvelteNativeHeadlessMainPackage";
const onDemandPackageName = "SvelteNativeOnDemandPackage";
const onDemandLegacyPackageName = "SvelteNativeOnDemandLegacyPackage";
const onDemandFactoryName = "svelteNativeOnDemand";
const packagesBegin = "          // Svelte native: headless package list (generated, do not edit)";
const packagesEnd = "          // Svelte native: end of headless package list";
const attachBegin = "  // Svelte native: the native libraries the start needs load while the Application is set up (generated, do not edit)";
const attachEnd = "  // Svelte native: end of native library preload";
const startBegin = "    // Svelte native: headless host start (generated, do not edit)";
const startEnd = "    // Svelte native: end of headless host start";
const activityBegin = "  // Svelte native: navigation state across recreation and process death (generated, do not edit)";
const activityEnd = "  // Svelte native: end of navigation state";
const savedBegin = "    // Svelte native: the navigation this Activity was saved with (generated, do not edit)";
const savedEnd = "    // Svelte native: end of saved navigation";
const warmBegin = "    // Svelte native: the process was started for the screen; the view the first screen creates is built off the main thread (generated, do not edit)";
const warmEnd = "    // Svelte native: end of view warm-up";
const launchBegin = "            // Svelte native: the saved navigation reaches JavaScript as initialProps.navigation (generated, do not edit)";
const launchEnd = "            // Svelte native: end of launch options";
const delegateBegin = "  // Svelte native: navigation state restoration (generated, do not edit)";
const delegateEnd = "  // Svelte native: end of navigation state restoration";
// `internal`: Expo's generated ExpoModulesProvider imports every module as `internal import`, and Swift refuses a plain import of the same module in the app target as ambiguous ("ambiguous implicit access level").
const delegateImport = "internal import SvelteNavigation // Svelte native: navigation state restoration (generated, do not edit)";
const gradleBegin = "// Svelte native: headless autolinking excludes (generated, do not edit)";
const gradleEnd = "// Svelte native: end of headless autolinking excludes";
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function recyclingOverrides(option: boolean | ViewRecycling | undefined): string[] {
  const recycling = option === true ? { view: true, text: true } : option || {};
  const names = [
    recycling.view && "enableViewRecyclingForView",
    recycling.text && "enableViewRecyclingForText",
    recycling.image && "enableViewRecyclingForImage",
    recycling.scrollView && "enableViewRecyclingForScrollView",
  ].filter((name): name is string => typeof name === "string");
  return names.length ? ["enableViewRecycling", ...names] : [];
}

/** Rewrites the generated feature-flag block after `loadReactNative(this)`, which installs React Native's own stable overrides first. */
export function applyFeatureFlags(contents: string, overrides: string[] | Record<string, boolean>): string {
  const flags: Record<string, boolean> = Array.isArray(overrides) ? Object.fromEntries(overrides.map((name) => [name, true])) : overrides;
  const stripped = contents.replace(new RegExp(`\\n${escapeRegExp(flagsBegin)}[\\s\\S]*?${escapeRegExp(flagsEnd)}`), "");
  if (Object.keys(flags).length === 0) return stripped;
  const anchor = /^[ \t]*loadReactNative\(this\)[ \t]*$/m.exec(stripped);
  if (!anchor) throw new Error("Svelte native could not find loadReactNative(this) in MainApplication.kt");
  const block = [
    flagsBegin,
    "    val svelteNativeAccessedFlags = com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(",
    "      object : com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults() {",
    ...Object.entries(flags).map(([name, value]) => `        override fun ${name}(): Boolean = ${value}`),
    "      }",
    "    )",
    "    if (svelteNativeAccessedFlags != null) android.util.Log.w(\"SvelteNative\", \"React Native feature flags were read before override: \" + svelteNativeAccessedFlags)",
    flagsEnd,
  ].join("\n");
  const end = anchor.index + anchor[0].length;
  return `${stripped.slice(0, end)}\n${block}${stripped.slice(end)}`;
}

const blockPattern = (begin: string, end: string) => new RegExp(`\\n${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);

/** `MainApplication.kt`: swaps `MainReactPackage` and starts the React host in `onCreate`. Idempotent (prebuild re-runs on the same file). */
export function applyHeadlessApplication(contents: string, onDemand: Record<string, string[]> = {}): string {
  const stripped = contents
    .replace(blockPattern(packagesBegin, packagesEnd), "")
    .replace(blockPattern(startBegin, startEnd), "")
    .replace(blockPattern(attachBegin, attachEnd), "");
  // The plugin adds `attachBaseContext` (the native libraries load while the Application is set up). A consumer's own override is theirs: it must make the call itself.
  const ownAttach = /\boverride\s+fun\s+attachBaseContext\s*\(/.test(stripped);
  if (ownAttach && !stripped.includes("BootBoost.preloadLibraries(")) {
    throw new Error("Svelte native: MainApplication.kt already overrides attachBaseContext. Call expo.modules.svelteengine.BootBoost.preloadLibraries(base) in it, after super.attachBaseContext(base); the plugin adds its own override only where there is none.");
  }
  const packagesAnchor = /^[ \t]*\/\/ add\(MyReactNativePackage\(\)\)[ \t]*$/m.exec(stripped);
  const startAnchor = /^[ \t]*ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)[ \t]*$/m.exec(stripped);
  if (!packagesAnchor || !startAnchor) throw new Error("Svelte native could not find the package list or onApplicationCreate in MainApplication.kt");
  const packages = [
    packagesBegin,
    "          for (index in indices) {",
    `            if (this[index] is com.facebook.react.shell.MainReactPackage) this[index] = ${headlessPackageName}()`,
    ...Object.entries(onDemand).map(([packageClass, names]) => `            if (this[index] is ${packageClass}) this[index] = ${onDemandFactoryName}(this[index], listOf(${names.map((name) => `"${name}"`).join(", ")}))`),
    "          }",
    "          // Views of Expo modules registered lazily are served on demand (see ExpoViews.kt in the engine module).",
    "          add(expo.modules.svelteengine.ExpoViewsPackage())",
    packagesEnd,
  ].join("\n");
  const start = [
    startBegin,
    "    // Expo modules register lazily on first use (patched expo-modules-core; see patches/expo-modules-core@57.0.23.patch).",
    "    System.setProperty(\"expo.modules.lazy\", \"true\")",
    "    // The patch's prewarm thread (app context and boot-time modules built off the pool thread) stays off until a phone A/B and a cold-start soak clear it.",
    "    System.setProperty(\"expo.modules.prewarm\", \"false\")",
    "    // This thread stays on the big cores while the host starts: the pool thread that initializes Hermes and the TurboModules, and the",
    "    // JavaScript thread it creates, inherit that and keep them until the first mount (BootBoost in the engine module).",
    "    expo.modules.svelteengine.BootBoost.begin()",
    "    // Hermes and TurboModule setup run on a pool thread; beginning now overlaps them with activity creation.",
    "    reactHost.start()",
    "    expo.modules.svelteengine.BootBoost.handOver()",
    startEnd,
  ].join("\n");
  const createAnchor = /^[ \t]*override fun onCreate\(\) \{[ \t]*$/m.exec(stripped);
  if (!createAnchor) throw new Error("Svelte native could not find onCreate in MainApplication.kt");
  const attach = [
    attachBegin,
    "  override fun attachBaseContext(base: android.content.Context) {",
    "    super.attachBaseContext(base)",
    "    expo.modules.svelteengine.BootBoost.preloadLibraries(base)",
    "  }",
    attachEnd,
    "",
  ].join("\n");
  const packagesAt = packagesAnchor.index + packagesAnchor[0].length;
  const startAt = startAnchor.index + startAnchor[0].length;
  // The anchors come in file order: the package list (the host's lazy initializer sits above onCreate), onCreate, the application hook.
  if (packagesAt > createAnchor.index || createAnchor.index > startAt) throw new Error("Svelte native expected the package list, onCreate and onApplicationCreate in that order in MainApplication.kt");
  return `${stripped.slice(0, packagesAt)}\n${packages}${stripped.slice(packagesAt, createAnchor.index)}${ownAttach ? "" : attach}${stripped.slice(createAnchor.index, startAt)}\n${start}${stripped.slice(startAt)}`;
}

/**
 * `MainActivity.kt`: keeps the root router's navigation state in the Activity's saved instance state and passes it back to
 * JavaScript when the surface starts again (`initialProps.navigation`): after the Activity was recreated (font scale, locale)
 * and after the process was killed in the background. Expo's template calls `super.onCreate(null)`, so the saved state is read
 * in `onCreate` before that. Idempotent (prebuild re-runs on the same file).
 */
export function applyMainActivity(contents: string): string {
  const stripped = contents
    .replace(blockPattern(activityBegin, activityEnd), "")
    .replace(blockPattern(savedBegin, savedEnd), "")
    .replace(blockPattern(warmBegin, warmEnd), "")
    .replace(blockPattern(launchBegin, launchEnd), "");
  const classAnchor = /^class MainActivity : ReactActivity\(\) \{[ \t]*$/m.exec(stripped);
  const createAnchor = /^[ \t]*super\.onCreate\(null\)[ \t]*$/m.exec(stripped);
  const delegateAnchor = /(fabricEnabled\s*\))\s*\{\s*\}/.exec(stripped);
  if (!classAnchor || !createAnchor || !delegateAnchor || !(classAnchor.index < createAnchor.index && createAnchor.index < delegateAnchor.index)) {
    throw new Error("Svelte native could not find the class, super.onCreate(null) and the ReactActivityDelegate in MainActivity.kt");
  }
  const members = [
    activityBegin,
    "  private var svelteNavigation: String? = null",
    "",
    "  override fun onSaveInstanceState(outState: Bundle) {",
    "    super.onSaveInstanceState(outState)",
    "    expo.modules.svelteengine.NavigationState.saveTo(outState)",
    "  }",
    "",
    "  override fun onDestroy() {",
    "    expo.modules.svelteengine.NavigationState.destroyed(isFinishing)",
    "    super.onDestroy()",
    "  }",
    activityEnd,
  ].join("\n");
  const saved = [
    warmBegin,
    "    expo.modules.svelteengine.BootBoost.activityCreated()",
    "    expo.modules.svelteengine.views.ViewWarmup.begin(this)",
    warmEnd,
    savedBegin,
    "    svelteNavigation = expo.modules.svelteengine.NavigationState.restoredFrom(savedInstanceState)",
    savedEnd,
    "",
  ].join("\n");
  const launch = [
    `${delegateAnchor[1]} {`,
    launchBegin,
    "            override fun getLaunchOptions(): android.os.Bundle? =",
    "              svelteNavigation?.let { json -> android.os.Bundle().apply { putString(\"navigation\", json) } }",
    launchEnd,
    "          }",
  ].join("\n");
  const classEnd = classAnchor.index + classAnchor[0].length;
  const delegateEnd = delegateAnchor.index + delegateAnchor[0].length;
  return `${stripped.slice(0, classEnd)}\n${members}${stripped.slice(classEnd, createAnchor.index)}${saved}${stripped.slice(createAnchor.index, delegateAnchor.index)}${launch}${stripped.slice(delegateEnd)}`;
}

/**
 * `AppDelegate.swift` (iOS): the four state restoration callbacks of `UIApplicationDelegate`, which Expo's `ExpoAppDelegate` does not forward, call
 * `SvelteNavigationRestoration` (`modules/svelte-navigation-ios`). UIKit saves the application's restorable state when the app enters the background,
 * asks `shouldRestore` at the next launch only if it still has that state, and has deleted it when the user swiped the app away: that call is how the
 * navigation module tells a process the system ended (restore) from one the user ended (start from the first screen), as Android's saved instance
 * state does. The methods keep the protocol's Objective-C selectors under names of their own, so a later `ExpoAppDelegate` that forwards them is a
 * compile error to read, not a silent override. Idempotent (prebuild re-runs on the same file).
 */
export function applyAppDelegate(contents: string): string {
  const stripped = contents
    .replace(blockPattern(delegateBegin, delegateEnd), "")
    .replace(new RegExp(`^${escapeRegExp(delegateImport)}\\n`, "m"), "");
  const imports = [...stripped.matchAll(/^(?:(?:internal|public|package|private|fileprivate) |@_exported |@preconcurrency )*import [\w.]+[ \t]*$/gm)];
  const lastImport = imports.at(-1);
  const property = /^[ \t]*var reactNativeFactory: RCTReactNativeFactory\?[ \t]*$/m.exec(stripped);
  if (!lastImport || !property) throw new Error("Svelte native could not find the imports and `var reactNativeFactory: RCTReactNativeFactory?` in AppDelegate.swift");
  const block = [
    delegateBegin,
    "  @objc(application:shouldSaveSecureApplicationState:)",
    "  func svelteNavigationShouldSave(_ application: UIApplication, _ coder: NSCoder) -> Bool {",
    "    SvelteNavigationRestoration.shouldSave(coder)",
    "  }",
    "",
    "  @objc(application:willEncodeRestorableStateWithCoder:)",
    "  func svelteNavigationEncode(_ application: UIApplication, _ coder: NSCoder) {",
    "    SvelteNavigationRestoration.encode(coder)",
    "  }",
    "",
    "  @objc(application:shouldRestoreSecureApplicationState:)",
    "  func svelteNavigationShouldRestore(_ application: UIApplication, _ coder: NSCoder) -> Bool {",
    "    SvelteNavigationRestoration.shouldRestore(coder)",
    "  }",
    "",
    "  @objc(application:didDecodeRestorableStateWithCoder:)",
    "  func svelteNavigationDidDecode(_ application: UIApplication, _ coder: NSCoder) {",
    "    SvelteNavigationRestoration.didDecode(coder)",
    "  }",
    delegateEnd,
  ].join("\n");
  // The later position first, so the earlier one is still where it was found.
  const propertyEnd = property.index + property[0].length;
  const importEnd = lastImport.index + lastImport[0].length;
  return `${stripped.slice(0, importEnd)}\n${delegateImport}${stripped.slice(importEnd, propertyEnd)}\n${block}${stripped.slice(propertyEnd)}`;
}

/** `settings.gradle`: excludes packages from Expo and React Native autolinking, the headless ones and `extra`. Idempotent. */
export function applyHeadlessSettings(contents: string, extra: readonly string[] = []): string {
  const stripped = contents.replace(blockPattern(gradleBegin, gradleEnd), "").replace(/autolinkLibrariesFromCommand\(expoAutolinking\.rnConfigCommand \+ svelteNativeExcludeArgs\)/, "autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)");
  const anchor = /^extensions\.configure\(com\.facebook\.react\.ReactSettingsExtension\)/m.exec(stripped);
  if (!anchor || !stripped.includes("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)")) throw new Error("Svelte native could not find the autolinking block in settings.gradle");
  const list = [...new Set([...headlessExcludedPackages, ...extra])].map((name) => `"${name}"`).join(", ");
  const block = [
    gradleBegin,
    `def svelteNativeExclude = [${list}]`,
    'def svelteNativeExcludeArgs = svelteNativeExclude.collectMany { ["--exclude", it] }',
    "expoAutolinking.exclude = svelteNativeExclude",
    gradleEnd,
    "",
  ].join("\n");
  return `${stripped.slice(0, anchor.index)}${block}${stripped.slice(anchor.index)}`.replace("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)", "autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand + svelteNativeExcludeArgs)");
}

const podfileBegin = "  # Svelte native: autolinking excludes (generated, do not edit)";
const podfileEnd = "  # Svelte native: end of autolinking excludes";
const podfileCommandBegin = "  # Svelte native: autolinking excludes for React Native's config command (generated, do not edit)";
const podfileCommandEnd = "  # Svelte native: end of config command excludes";

/**
 * `Podfile`: the packages Expo's `use_expo_modules!` and the React Native config command (`expo-modules-autolinking
 * react-native-config`) leave out. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command is the community CLI's own, which
 * reads `react-native.config.js` instead. Idempotent; an empty list restores the template.
 */
export function applyPodfileAutolinkingExclude(contents: string, names: readonly string[]): string {
  const stripped = contents
    .replace(blockPattern(podfileBegin, podfileEnd), "")
    .replace(blockPattern(podfileCommandBegin, podfileCommandEnd), "")
    .replace(/use_expo_modules!\(exclude: svelte_native_exclude\)/, "use_expo_modules!");
  if (names.length === 0) return stripped;
  const useAnchor = /^[ \t]*use_expo_modules!(?!\()[ \t]*$/m.exec(stripped);
  const commandAnchor = /^[ \t]*config = use_native_modules!\(config_command\)[ \t]*$/m.exec(stripped);
  if (!useAnchor || !commandAnchor || useAnchor.index > commandAnchor.index) throw new Error("Svelte native could not find use_expo_modules! and use_native_modules!(config_command) in the Podfile");
  const list = [
    podfileBegin,
    `  svelte_native_exclude = [${[...new Set(names)].map((name) => `"${name}"`).join(", ")}]`,
    podfileEnd,
  ].join("\n");
  const command = [
    podfileCommandBegin,
    "  config_command += svelte_native_exclude.flat_map { |name| ['--exclude', name] } if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] != '1'",
    podfileCommandEnd,
  ].join("\n");
  const useEnd = useAnchor.index + useAnchor[0].length;
  return `${stripped.slice(0, useAnchor.index)}${list}\n${stripped.slice(useAnchor.index, useEnd).replace("use_expo_modules!", "use_expo_modules!(exclude: svelte_native_exclude)")}${stripped.slice(useEnd, commandAnchor.index)}${command}\n${stripped.slice(commandAnchor.index)}`;
}

/** Kotlin source for the package that replaces `MainReactPackage` in headless builds. */
export function headlessPackageSource(applicationId: string): string {
  const dropped = headlessDroppedTurboModules.map((name) => `"${name}"`).join(", ");
  return `package ${applicationId}

import com.facebook.react.BaseReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.ModuleSpec
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.uimanager.ViewManager

// Generated by @example/svelte-native. MainReactPackage without the modules the engine does not use.
// View managers stay on demand through MainReactPackage, so nothing is created at startup.
@OptIn(UnstableReactNativeAPI::class)
class ${headlessPackageName} : BaseReactPackage(), ViewManagerOnDemandReactPackage {
  private val main = MainReactPackage()
  private val dropped = setOf(${dropped})

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name in dropped) null else main.getModule(name, reactContext)

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    val infos = main.getReactModuleInfoProvider().getReactModuleInfos().filterKeys { it !in dropped }
    return ReactModuleInfoProvider { infos }
  }

  @Suppress("DEPRECATION")
  override fun getViewManagers(reactContext: ReactApplicationContext): List<ModuleSpec> = main.getViewManagers(reactContext)

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = main.getViewManagerNames(reactContext)

  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? =
    main.createViewManager(reactContext, viewManagerName)
}
`;
}

/** Kotlin source of the wrapper that makes a package's view managers on demand (`androidOnDemandViewManagers`). */
export function onDemandPackageSource(applicationId: string): string {
  return `package ${applicationId}

import com.facebook.react.BaseReactPackage
import com.facebook.react.ReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

// Generated by @example/svelte-native. A package whose view managers React Native creates on first use: the host would
// create all of them when it starts. The package's TurboModules are served as before; its managers are built together
// (the package creates them as a set) the first time one of its components is mounted. The names are not announced:
// React Native's JavaScript reads one property of \`UIManager\` per announced name when it starts, and each read creates the
// manager. \`createViewManager\` is asked for any component name a mount needs, announced or not.
@OptIn(UnstableReactNativeAPI::class)
class ${onDemandPackageName}(private val delegate: ReactPackage, private val names: Collection<String>) : BaseReactPackage(), ViewManagerOnDemandReactPackage {
  private var managers: Map<String, ViewManager<*, *>>? = null

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    (delegate as? BaseReactPackage)?.getModule(name, reactContext)

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    (delegate as? BaseReactPackage)?.getReactModuleInfoProvider() ?: ReactModuleInfoProvider { emptyMap() }

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()

  @Synchronized
  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? {
    if (viewManagerName !in names) return null
    val created = managers ?: delegate.createViewManagers(reactContext).associateBy { it.name }.also { managers = it }
    return created[viewManagerName]
  }
}

// The same for a package that still builds its native modules with \`createNativeModules\` (react-native-video's \`VideoManager\`,
// which the library's functions call with the view's tag): React Native reads such a package's modules from that method, and a
// \`BaseReactPackage\` would hide them.
@OptIn(UnstableReactNativeAPI::class)
class ${onDemandLegacyPackageName}(private val delegate: ReactPackage, private val names: Collection<String>) : ReactPackage, ViewManagerOnDemandReactPackage {
  private var managers: Map<String, ViewManager<*, *>>? = null

  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = delegate.createNativeModules(reactContext)

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()

  @Synchronized
  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? {
    if (viewManagerName !in names) return null
    val created = managers ?: delegate.createViewManagers(reactContext).associateBy { it.name }.also { managers = it }
    return created[viewManagerName]
  }
}

/** The wrapper that keeps the kind of package it wraps: modules through \`getModule\` for a \`BaseReactPackage\`, through \`createNativeModules\` for any other. */
fun ${onDemandFactoryName}(delegate: ReactPackage, names: Collection<String>): ReactPackage =
  if (delegate is BaseReactPackage) ${onDemandPackageName}(delegate, names) else ${onDemandLegacyPackageName}(delegate, names)
`;
}

/**
 * Expo's prebuild applies a built-in plugin for every installed package it thinks is autolinked (expo-location's location
 * permissions, expo-local-authentication's biometric ones, …), and it asks the autolinker with `package.json`'s options only, so
 * it never sees the excludes this plugin passes on the command line: a package left out of the build would still add its manifest
 * permissions and Info.plist texts. Every Expo plugin runs once per config (`createRunOncePlugin`, keyed by package name), so the
 * excluded packages are entered in the config's plugin history here, before the prebuild applies its own, and those plugins
 * do nothing.
 */
export function leaveOutOfAutoPlugins<Config extends { _internal?: Record<string, unknown> }>(config: Config, names: readonly string[]): Config {
  if (names.length === 0) return config;
  config._internal ??= {};
  const internal = config._internal;
  internal.pluginHistory ??= {};
  const history = internal.pluginHistory as Record<string, { name: string; version: string }>;
  for (const name of names) history[name] ??= { name, version: "left out of autolinking" };
  return config;
}

const withSvelteNative: ConfigPlugin<SvelteNativeOptions | undefined> = (config, options) => {
  config = leaveOutOfAutoPlugins(config, options?.autolinkingExclude ?? []);
  if (options?.remote) config = withRemoteHost(config, options.remote);
  for (const platform of ["android", "ios"] as const) {
    config = withDangerousMod(config, [platform, async (config) => {
      await syncNative(config.modRequest.projectRoot);
      return config;
    }]);
  }
  config = withDangerousMod(config, ["android", async (config) => {
    const applicationId = config.android?.package;
    if (!applicationId) throw new Error("Svelte native needs android.package in the Expo config");
    const directory = join(config.modRequest.platformProjectRoot, "app/src/main/java", ...applicationId.split("."));
    const file = join(directory, `${headlessPackageName}.kt`);
    await mkdir(directory, { recursive: true });
    await writeFile(file, headlessPackageSource(applicationId));
    await writeFile(join(directory, `${onDemandPackageName}.kt`), onDemandPackageSource(applicationId));
    return config;
  }]);
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0] as (Record<string, unknown> & { provider?: Record<string, unknown>[] }) | undefined;
    if (!application) throw new Error("Svelte native could not find <application> in AndroidManifest.xml");
    const emoji = "androidx.emoji2.text.EmojiCompatInitializer";
    const providers = (application.provider ?? []) as { $: Record<string, string>; "meta-data"?: { $: Record<string, string> }[] }[];
    const startup = providers.find((provider) => provider.$["android:name"] === "androidx.startup.InitializationProvider");
    // The merger drops the entry the library manifest declares; the provider itself stays for ProfileInstaller and ProcessLifecycle.
    manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
    const entry = { $: { "android:name": emoji, "tools:node": "remove" } };
    if (startup) startup["meta-data"] = [...(startup["meta-data"] ?? []).filter((item) => item.$["android:name"] !== emoji), entry];
    else providers.push({ $: { "android:name": "androidx.startup.InitializationProvider", "android:authorities": `${config.android?.package}.androidx-startup`, "android:exported": "false", "tools:node": "merge" }, "meta-data": [entry] });
    application.provider = providers;
    return config;
  });
  config = withSettingsGradle(config, (config) => {
    config.modResults.contents = applyHeadlessSettings(config.modResults.contents, options?.autolinkingExclude);
    return config;
  });
  config = withPodfile(config, (config) => {
    config.modResults.contents = applyPodfileAutolinkingExclude(config.modResults.contents, options?.autolinkingExclude ?? []);
    return config;
  });
  if (options?.androidProfileable) {
    config = withAndroidManifest(config, (config) => {
      const application = config.modResults.manifest.application?.[0] as (Record<string, unknown> & { profileable?: { $: Record<string, string> }[] }) | undefined;
      if (!application) throw new Error("Svelte native could not find <application> in AndroidManifest.xml");
      application.profileable = [{ $: { "android:shell": "true" } }];
      return config;
    });
  }
  // A baseline profile for the engine and the updates module. With it in the APK, the install-time compile of a Play
  // install (or the background dexopt after androidx.profileinstaller's first-run copy on a sideload) covers the mounting
  // path, which otherwise runs in the interpreter until the JIT catches up: a 127-view push cost 20 ms interpreted
  // against 11 ms compiled on a Galaxy A16 (26 Oct 2026).
  config = withDangerousMod(config, ["android", async (config) => {
    const dir = join(config.modRequest.platformProjectRoot, "app", "src", "main");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "baseline-prof.txt"), baselineProfile());
    return config;
  }]);
  config = withMainActivity(config, (config) => {
    if (config.modResults.language !== "kt") throw new Error("Svelte native requires Expo's Kotlin MainActivity");
    config.modResults.contents = applyMainActivity(config.modResults.contents);
    return config;
  });
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") throw new Error("Svelte native requires Expo's Swift AppDelegate");
    config.modResults.contents = applyAppDelegate(config.modResults.contents);
    return config;
  });
  config = withMainApplication(config, (config) => {
    if (config.modResults.language !== "kt") throw new Error("Svelte native requires Expo's Kotlin MainApplication");
    const flags: Record<string, boolean> = { ...Object.fromEntries(recyclingOverrides(options?.androidViewRecycling).map((name) => [name, true])), ...options?.androidFeatureFlags };
    config.modResults.contents = applyHeadlessApplication(applyFeatureFlags(config.modResults.contents, flags), options?.androidOnDemandViewManagers);
    return config;
  });
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") throw new Error("Svelte native requires Expo's Groovy Android template");
    if (!config.modResults.contents.includes(bundleMarker)) {
      // React Native's Gradle input list omits Svelte files and workspace packages.
      config.modResults.contents += `\n${bundleMarker}\ntasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {\n    outputs.upToDateWhen { false }\n}\n`;
    }
    return config;
  });
};

export default withSvelteNative;

/** Baseline profile rules (the Android Gradle plugin's text format): every method of the engine and the updates module, hot + startup + post-startup. */
export function baselineProfile(): string {
  return [
    "HSPLexpo/modules/svelteengine/**->**(**)**",
    "HSPLexpo/modules/svelteupdates/**->**(**)**",
    "Lexpo/modules/svelteengine/**;",
    "Lexpo/modules/svelteupdates/**;",
    "",
  ].join("\n");
}
