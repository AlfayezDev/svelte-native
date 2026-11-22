import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withAndroidManifest, withAppBuildGradle, withAppDelegate, withDangerousMod, withGradleProperties, withMainActivity, withMainApplication, withPodfile, withSettingsGradle, type AndroidConfig, type ConfigPlugin } from "expo/config-plugins";
import { syncNative } from "./build.ts";
import { withCapabilities, type Capabilities } from "./capabilities.ts";
export type { Capabilities, LocationCapability, PushCapability } from "./capabilities.ts";
import { checkLibraries, LibrariesConfigError, libraryLinks, libraryPlugin, type Libraries, type LibraryLinks, type LibrariesOption } from "./libraries.ts";
export type { LibrariesOption, LibraryOptions } from "./libraries.ts";
import { EXTRA_KEY, type RemoteHostConfig } from "./remote/host.ts";
import { withRemoteHost } from "./remote/plugin.ts";
import { applyUserInterfaceStyle, hasSystemUi, userInterfaceStyleOf } from "./user-interface-style.ts";
import { collisionMessage, declaredVendored, optionalPackages, vendoredPackage } from "./vendored.ts";

export type ViewRecycling = { view?: boolean; text?: boolean; image?: boolean; scrollView?: boolean };
export type ExpoSvelteOptions = {
  /**
   * Reuse Android native views across mounts through React Native's view recycling flags.
   * `true` recycles `<View>` and `<Text>`; pass an object to choose per view manager.
   * Keyed Svelte lists replace many native views at once, and creating a React Native
   * Android view costs about half a millisecond on mid-range phones.
   */
  androidViewRecycling?: boolean | ViewRecycling;
  /** Marks the Android app `<profileable android:shell="true">`, so Perfetto and simpleperf can sample its stacks on a release build. For QA builds. */
  androidProfileable?: boolean;
  /**
   * React Native Android feature flags to force (`ReactNativeFeatureFlags.dangerouslyForceOverride`), by method name, over the library's
   * defaults ([defaultAndroidFeatureFlags]).
   */
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
   * `extra.expoSvelte.remote` (where the runtime reads it, from the manifest `expo-constants` embeds) and, for an `http:` origin, the
   * Android and iOS builds are allowed to use plain HTTP to it. Leave it out and the app has no host: a remote function throws when called
   * until `configureRemote({ origin })` sets one.
   */
  remote?: RemoteHostConfig;
  /**
   * The variant whose route table (`.expo-svelte/routes.<variant>.ts`) the prebuild writes. Default: `APP_VARIANT`, or `app` when that is empty. An app whose own default is
   * another name passes it here instead of setting the environment from its config (which every tool that imports the config would inherit).
   */
  variant?: string;
  /**
   * The web APIs that need a permission of the system, each turned on by saying why the app uses it. Their native code is part of the library, in every app, and does nothing
   * until the prebuild turns it on: nothing is installed. `location` is `navigator.geolocation` while the app is in use: `{ location: "Shows the stores near you." }`, the
   * text iOS shows when it asks, or `{ location: { whenInUse } }` (Android gets the two location permissions; background location is not part of it). `push` is push
   * notifications, from the app's identifiers: `{ push: { android: { googleServicesFile }, ios: { mode } } }`, and never a server key. A config that cannot be built as
   * it stands (a secret, an empty reason, two answers to one question) stops the prebuild (`capabilities.ts`).
   */
  capabilities?: Capabilities;
  /**
   * The optional native view libraries the app uses, from the ones `expo-svelte` carries (`vendor/`): `expo-image`, `expo-blur`, `expo-linear-gradient`, `expo-conic-gradient`,
   * `expo-video`, `react-native-video`, `lottie-react-native`, `rive-react-native`, `@react-native-community/datetimepicker`, `react-native-pdf` (which turns `react-native-blob-util` on too),
   * `react-native-webview`, `react-native-maps`, `react-native-view-shot`, `react-native-fast-shadow` and `react-native-animateable-text`. Each is `true`, or the options of the library's own
   * config plugin (`"react-native-maps": { androidGoogleMapsApiKey }`, `"expo-video": { supportsPictureInPicture: true }`), which the plugin runs from the library's copy; `false` is the same as
   * leaving it out. A listed library is linked on Android and iOS and bundled by Metro. An unlisted one is neither: no native code of it in the build (on iOS not even compiled: react-native-maps
   * references CoreLocation, which App Store Connect would hold every app to), and its name resolves to a stub that says how to turn it on. Nothing is installed for any of them: an app that lists
   * one in its `package.json` or `plugins` is refused. Prebuild again after changing it.
   */
  libraries?: LibrariesOption;
  /**
   * libsodium in `crypto` and in Node's `crypto` (react-native-quick-crypto, which the library carries: `vendor/react-native-quick-crypto`): the algorithms OpenSSL lacks (XSalsa20 and the other
   * libsodium ciphers). It is the option of the same name that react-native-quick-crypto's own Expo plugin took, and an app that lists that plugin moves the option here, since the package is not
   * the app's any more. Android: `sodiumEnabled=true` in `gradle.properties`, which links `io.github.ronickg:sodium`; iOS: `ENV['SODIUM_ENABLED'] = '1'` at the top of the Podfile, which makes
   * the pod download libsodium's source (1.0.20) and compile it. Default `false`: neither platform has libsodium. The plugin owns the setting: it is written again, or removed, on every prebuild.
   */
  sodiumEnabled?: boolean;
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
  "expo-updates", // the engine host ships its own updates module (native/svelte-core); this package only lets `eas update` run
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
const headlessPackageName = "ExpoSvelteHeadlessMainPackage";
const onDemandPackageName = "ExpoSvelteOnDemandPackage";
const onDemandLegacyPackageName = "ExpoSvelteOnDemandLegacyPackage";
const onDemandFactoryName = "expoSvelteOnDemand";
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
const delegateImport = "internal import SvelteCore // Svelte native: navigation state restoration (generated, do not edit)";
// The generated import of any module, so a prebuild replaces the one an older version wrote (`SvelteNavigation`, before the native code was one pod).
const delegateImportLine = /^internal import \w+ \/\/ Svelte native: navigation state restoration \(generated, do not edit\)\n/m;
// `SceneDelegate.swift` (Expo SDK 58's scene-based template) has the same block, with UIKit imported beside SvelteCore: the scene's methods name UIKit's types, which a file that imports only `Expo` (`internal import`) does not see.
const sceneUiKitImport = "import UIKit // Svelte native: navigation state restoration (generated, do not edit)";
const sceneImportLines = /^(?:internal )?import \w+ \/\/ Svelte native: navigation state restoration \(generated, do not edit\)\n/gm;
const gradleBegin = "// Svelte native: headless autolinking excludes (generated, do not edit)";
const gradleEnd = "// Svelte native: end of headless autolinking excludes";
/** The package `settings.gradle` resolves to find the library's CLI (`android-autolinking`). */
const libraryPackage = "expo-svelte";
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
/**
 * The React Native flags the engine is built and measured with, which every app gets unless it overrides one: view preallocation off (the
 * engine mounts its own views; React Native's preallocation creates views when shadow nodes are made, before the eager modules exist, so an
 * `Image` on the first screen reached Fresco before `FrescoModule` initialised it and the app crashed: the showcase, 9 Nov 2026), and
 * prepared text layouts (the engine draws React Native's `PreparedLayout` as is). Both were set only by the QA app's config before.
 */
export const defaultAndroidFeatureFlags: Readonly<Record<string, boolean>> = { disableViewPreallocationAndroid: true, enablePreparedTextLayout: true };

/** The flags the plugin writes: the library's defaults, the view-recycling overrides, then the app's own `androidFeatureFlags`. */
export function androidFeatureFlagsFor(options?: Pick<ExpoSvelteOptions, "androidViewRecycling" | "androidFeatureFlags">): Record<string, boolean> {
  return {
    ...defaultAndroidFeatureFlags,
    ...Object.fromEntries(recyclingOverrides(options?.androidViewRecycling).map((name) => [name, true])),
    ...options?.androidFeatureFlags,
  };
}

export function applyFeatureFlags(contents: string, overrides: string[] | Record<string, boolean>): string {
  const flags: Record<string, boolean> = Array.isArray(overrides) ? Object.fromEntries(overrides.map((name) => [name, true])) : overrides;
  const stripped = contents.replace(new RegExp(`\\n${escapeRegExp(flagsBegin)}[\\s\\S]*?${escapeRegExp(flagsEnd)}`), "");
  if (Object.keys(flags).length === 0) return stripped;
  const anchor = /^[ \t]*loadReactNative\(this\)[ \t]*$/m.exec(stripped);
  if (!anchor) throw new Error("Svelte native could not find loadReactNative(this) in MainApplication.kt");
  const block = [
    flagsBegin,
    "    val expoSvelteAccessedFlags = com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(",
    "      object : com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults() {",
    ...Object.entries(flags).map(([name, value]) => `        override fun ${name}(): Boolean = ${value}`),
    "      }",
    "    )",
    "    if (expoSvelteAccessedFlags != null) android.util.Log.w(\"ExpoSvelte\", \"React Native feature flags were read before override: \" + expoSvelteAccessedFlags)",
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
    "    // Expo modules register lazily on first use (patched expo-modules-core; see patches/expo-modules-core@58.1.0.patch).",
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
 * `SvelteNavigationRestoration` (`native/svelte-core/ios/navigation`). UIKit saves the application's restorable state when the app enters the background,
 * asks `shouldRestore` at the next launch only if it still has that state, and has deleted it when the user swiped the app away: that call is how the
 * navigation module tells a process the system ended (restore) from one the user ended (start from the first screen), as Android's saved instance
 * state does. The methods keep the protocol's Objective-C selectors under names of their own, so a later `ExpoAppDelegate` that forwards them is a
 * compile error to read, not a silent override. Idempotent (prebuild re-runs on the same file).
 */
export function applyAppDelegate(contents: string): string {
  const stripped = contents
    .replace(blockPattern(delegateBegin, delegateEnd), "")
    .replace(delegateImportLine, "");
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

/**
 * `SceneDelegate.swift` (iOS, Expo SDK 58): the template starts React Native from a `UIWindowSceneDelegate` (`ExpoAppSceneDelegate`, which iOS 27 requires of every app), and UIKit does not call the
 * application delegate's four state restoration callbacks (`applyAppDelegate`) of an app that has scenes. The same signal is the scene's: `stateRestorationActivity(for:)` is asked when the app
 * enters the background, and the session the system connects at the next launch has that activity only if the system kept the state (it deletes it for an app the user swiped away). The
 * scene's `willConnectTo` notes it before `ExpoAppSceneDelegate` starts React Native, which is when JavaScript can ask (`SvelteNavigationRestoration`, `native/svelte-core/ios/navigation`).
 * A project whose template has no `SceneDelegate.swift` keeps `applyAppDelegate`'s callbacks alone. Idempotent.
 */
export function applySceneDelegate(contents: string): string {
  const stripped = contents.replace(blockPattern(delegateBegin, delegateEnd), "").replace(sceneImportLines, "");
  const imports = [...stripped.matchAll(/^(?:(?:internal|public|package|private|fileprivate) |@_exported |@preconcurrency )*import [\w.]+[ \t]*$/gm)];
  const lastImport = imports.at(-1);
  const declaration = /^[ \t]*(?:(?:public|open|final|internal) )*class \w+[ \t]*:[ \t]*ExpoAppSceneDelegate\b[^{\n]*\{[ \t]*$/m.exec(stripped);
  if (!lastImport || !declaration) throw new Error("Svelte native could not find the imports and `class SceneDelegate: ExpoAppSceneDelegate` in SceneDelegate.swift");
  const block = [
    delegateBegin,
    "  func stateRestorationActivity(for scene: UIScene) -> NSUserActivity? {",
    "    SvelteNavigationRestoration.stateRestorationActivity()",
    "  }",
    "",
    "  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {",
    "    SvelteNavigationRestoration.sceneWillConnect(session.stateRestorationActivity)",
    "    super.scene(scene, willConnectTo: session, options: connectionOptions)",
    "  }",
    delegateEnd,
  ].join("\n");
  const declarationEnd = declaration.index + declaration[0].length;
  const importEnd = lastImport.index + lastImport[0].length;
  return `${stripped.slice(0, importEnd)}\n${delegateImport}\n${sceneUiKitImport}${stripped.slice(importEnd, declarationEnd)}\n${block}${stripped.slice(declarationEnd)}`;
}

/** The community CLI's command (`EXPO_USE_COMMUNITY_AUTOLINKING=1`) through the library's: React Native's default, `cmd /c` first on Windows as React Native's `windowsAwareCommandLine` does. */
const communityCall = "expoSvelteConfigCommand + expoSvelteCommunityCommand, expoSvelteAppRoot.asFile, expoSvelteLockFiles";

/**
 * `settings.gradle`: excludes packages from Expo and React Native autolinking, the headless ones and `extra`, and runs React Native's config command
 * through the library's `android-autolinking` (`autolinking.ts`: the packages the library carries are linked from its directory, and the Nitro modules' native libraries load
 * after the start). With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the community CLI's command goes through it too: the copies are in no app's `package.json`, so the community CLI alone
 * would link none of them. Idempotent.
 *
 * The optional libraries the app turned on (`links`, `libraries.ts`): the React Native ones are `--link` arguments of `android-autolinking`, and the Expo modules are search paths of Expo's
 * autolinker (`expoAutolinking.searchPaths`: the directory of each copy, under the library's own directory, which the block finds from the CLI's path). The Expo modules that are off join
 * Expo's `exclude`, so a copy installed for another package's sake is not linked either. Expo's command line puts the search paths after its `--exclude` options, and `--exclude` takes any
 * number of values, so without a `--` in front the paths would be read as names to leave out and the modules would not be found: the first search path is that `--`. The block's
 * lock files include `settings.gradle` itself: React Native keeps the command's output until a lock file changes, and a changed `libraries` changes the `--link` arguments.
 */
export function applyHeadlessSettings(contents: string, extra: readonly string[] = [], links?: LibraryLinks): string {
  const stripped = contents.replace(blockPattern(gradleBegin, gradleEnd), "").replace(/autolinkLibrariesFromCommand\((?:(?:expoSvelte|svelteNative)ConfigCommand \+ )?expoAutolinking\.rnConfigCommand \+ (?:expoSvelte|svelteNative)ExcludeArgs(?:, (?:expoSvelte|svelteNative)AppRoot\.asFile, (?:expoSvelte|svelteNative)LockFiles)?\)/, "autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)")
    .replace(`autolinkLibrariesFromCommand(${communityCall})`, "autolinkLibrariesFromCommand()");
  const anchor = /^extensions\.configure\(com\.facebook\.react\.ReactSettingsExtension\)/m.exec(stripped);
  if (!anchor || !stripped.includes("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)")) throw new Error("Svelte native could not find the autolinking block in settings.gradle");
  const quoted = (names: readonly string[]) => names.map((name) => `"${name}"`).join(", ");
  const list = quoted([...new Set([...headlessExcludedPackages, ...extra, ...(links?.expoOff ?? [])])]);
  const expoModules = links?.expo ?? [];
  const reactNative = links?.reactNative ?? [];
  const block = [
    gradleBegin,
    `def expoSvelteExclude = [${list}]`,
    'def expoSvelteExcludeArgs = expoSvelteExclude.collectMany { ["--exclude", it] }',
    "expoAutolinking.exclude = expoSvelteExclude",
    `def expoSvelteCli = new File(providers.exec { workingDir(rootDir); commandLine("node", "--print", "require.resolve('${libraryPackage}/package.json')") }.standardOutput.asText.get().trim()).getParentFile().toPath().resolve("dist/node/cli.js").toString()`,
    ...(expoModules.length === 0
      ? []
      : [
          `// The Expo modules the app turned on (libraries): the directories of their copies in the library are Expo's search paths. "--" first: see applyHeadlessSettings.`,
          `def expoSvelteExpoModules = [${quoted(expoModules)}]`,
          'def expoSvelteLibrary = new File(expoSvelteCli).getParentFile().getParentFile().getParentFile()',
          'expoAutolinking.searchPaths = ["--"] + expoSvelteExpoModules.collect { new File(expoSvelteLibrary, "vendor/" + it).toString() }',
        ]),
    `def expoSvelteConfigCommand = ["node", expoSvelteCli, "android-autolinking"${reactNative.map((name) => `, "--link", "${name}"`).join("")}]`,
    'def expoSvelteCommunityCommand = (System.getProperty("os.name").toLowerCase().contains("windows") ? ["cmd", "/c"] : []) + ["npx", "@react-native-community/cli", "config"]',
    // React Native keeps the command's output until a lockfile of the app changes: React Native's own list, the CLI, and this file, so that a new version of the
    // library (a workspace or file: dependency changes no lockfile) and a changed `libraries` (the `--link` arguments above) run the command again.
    'def expoSvelteAppRoot = settings.layout.rootDirectory.dir("../")',
    'def expoSvelteLockFiles = expoSvelteAppRoot.files("yarn.lock", "package-lock.json", "package.json", "react-native.config.js", expoSvelteCli, new File(settingsDir, "settings.gradle").toString())',
    gradleEnd,
    "",
  ].join("\n");
  return `${stripped.slice(0, anchor.index)}${block}${stripped.slice(anchor.index)}`.replace("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)", "autolinkLibrariesFromCommand(expoSvelteConfigCommand + expoAutolinking.rnConfigCommand + expoSvelteExcludeArgs, expoSvelteAppRoot.asFile, expoSvelteLockFiles)")
    .replace("autolinkLibrariesFromCommand()", `autolinkLibrariesFromCommand(${communityCall})`);
}

const podfileBegin = "  # Svelte native: autolinking excludes (generated, do not edit)";
const podfileEnd = "  # Svelte native: end of autolinking excludes";
const podfileCommandBegin = "  # Svelte native: autolinking excludes for React Native's config command (generated, do not edit)";
const podfileCommandEnd = "  # Svelte native: end of config command excludes";

/**
 * `Podfile`: the packages Expo's `use_expo_modules!` and the React Native config command (`expo-modules-autolinking
 * react-native-config`) leave out. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command is the community CLI's own, which
 * reads `react-native.config.js` instead. Idempotent; an empty list restores the template.
 *
 * `expoModules` are the optional Expo modules the app turned on (`libraries.ts`): `use_expo_modules!` gets their directories in the library (`vendor/<name>`, which the block finds from the
 * app with `require.resolve`, as it finds the CLI) as `searchPaths`, and nothing else of the library's copies is looked at.
 */
export function applyPodfileAutolinkingExclude(contents: string, names: readonly string[], expoModules: readonly string[] = []): string {
  const stripped = contents
    .replace(blockPattern(podfileBegin, podfileEnd), "")
    .replace(blockPattern(podfileCommandBegin, podfileCommandEnd), "")
    .replace(/use_expo_modules!\((?:exclude: (?:expo_svelte|svelte_native)_exclude)?(?:, )?(?:searchPaths: [^\n]*?)?\)(?=[ \t]*$)/m, "use_expo_modules!");
  if (names.length === 0 && expoModules.length === 0) return stripped;
  const useAnchor = /^[ \t]*use_expo_modules!(?!\()[ \t]*$/m.exec(stripped);
  const commandAnchor = /^[ \t]*config = use_native_modules!\(config_command\)[ \t]*$/m.exec(stripped);
  if (!useAnchor || !commandAnchor || useAnchor.index > commandAnchor.index) throw new Error("Svelte native could not find use_expo_modules! and use_native_modules!(config_command) in the Podfile");
  const list = [
    podfileBegin,
    `  expo_svelte_exclude = [${[...new Set(names)].map((name) => `"${name}"`).join(", ")}]`,
    ...(expoModules.length === 0
      ? []
      : [
          `  expo_svelte_expo_modules = [${expoModules.map((name) => `"${name}"`).join(", ")}]`,
          `  expo_svelte_library = File.dirname(\`node --print "require.resolve('${libraryPackage}/package.json')"\`)`,
        ]),
    podfileEnd,
  ].join("\n");
  const command = [
    podfileCommandBegin,
    "  config_command += expo_svelte_exclude.flat_map { |name| ['--exclude', name] } if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] != '1'",
    podfileCommandEnd,
  ].join("\n");
  const useCall = `use_expo_modules!(exclude: expo_svelte_exclude${expoModules.length === 0 ? "" : ", searchPaths: expo_svelte_expo_modules.map { |name| File.join(expo_svelte_library, 'vendor', name) }"})`;
  const useEnd = useAnchor.index + useAnchor[0].length;
  return `${stripped.slice(0, useAnchor.index)}${list}\n${stripped.slice(useAnchor.index, useEnd).replace("use_expo_modules!", useCall)}${stripped.slice(useEnd, commandAnchor.index)}${command}\n${stripped.slice(commandAnchor.index)}`;
}

const podfileLinkBegin = "  # Svelte native: the packages the library carries are linked from its own directory (generated, do not edit)";
const podfileLinkEnd = "  # Svelte native: end of the library's own packages";

/**
 * `Podfile`: the config command that `use_native_modules!` runs goes through the library's `ios-autolinking` (`autolinking.ts`), which adds the packages the library carries
 * (`vendored.ts`, which lists them, and the optional libraries `links` names, `libraries.ts`) to its output, with the podspecs
 * of `vendor/` in the library's directory, so the app's package.json lists none of them. The block goes in front of the line that reads the config, after anything that already extended the
 * command; stripped and written again on every prebuild, so an update of the library moves it. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command underneath is the community CLI's, and its output
 * gets the same entries.
 */
export function applyPodfileVendoredLinking(contents: string, links: readonly string[] = []): string {
  const stripped = contents.replace(blockPattern(podfileLinkBegin, podfileLinkEnd), "");
  const anchor = /^[ \t]*config = use_native_modules!\(config_command\)[ \t]*$/m.exec(stripped);
  if (!anchor) throw new Error("Svelte native could not find use_native_modules!(config_command) in the Podfile");
  const block = [
    podfileLinkBegin,
    `  expo_svelte_cli = File.join(File.dirname(\`node --print "require.resolve('${libraryPackage}/package.json')"\`), 'dist/node/cli.js')`,
    `  config_command = ['node', expo_svelte_cli, 'ios-autolinking'${links.map((name) => `, '--link', '${name}'`).join("")}] + config_command`,
    podfileLinkEnd,
  ].join("\n");
  return `${stripped.slice(0, anchor.index)}${block}\n${stripped.slice(anchor.index)}`;
}

const podfileSodiumBegin = "# Svelte native: libsodium for react-native-quick-crypto (generated, do not edit)";
const podfileSodiumEnd = "# Svelte native: end of libsodium";

/**
 * `Podfile`: `ENV['SODIUM_ENABLED'] = '1'` before anything else, which the podspec of react-native-quick-crypto reads when CocoaPods evaluates it (what quick-crypto's own Expo plugin wrote
 * at the top of the Podfile when `sodiumEnabled` was its option). Stripped and written again on every prebuild, so a project prebuilt with the option and then without it loses the line.
 */
export function applyPodfileSodium(contents: string, enabled: boolean): string {
  const stripped = contents.replace(new RegExp(`(^|\\n)${escapeRegExp(podfileSodiumBegin)}[\\s\\S]*?${escapeRegExp(podfileSodiumEnd)}(?:\\n|$)`), "$1");
  return enabled ? `${[podfileSodiumBegin, "ENV['SODIUM_ENABLED'] = '1'", podfileSodiumEnd].join("\n")}\n${stripped}` : stripped;
}

/**
 * `gradle.properties`: `sodiumEnabled=true`, which the Gradle project of react-native-quick-crypto reads (`hasProperty('sodiumEnabled')`: it passes `-DSODIUM_ENABLED` to CMake and adds
 * `io.github.ronickg:sodium`). Without the option the property is removed, so the setting is the plugin's alone and one directory can be prebuilt with and without it.
 */
export function applyGradleSodium(properties: AndroidConfig.Properties.PropertiesItem[], enabled: boolean): AndroidConfig.Properties.PropertiesItem[] {
  const others = properties.filter((item) => !(item.type === "property" && item.key === "sodiumEnabled"));
  return enabled ? [...others, { type: "property", key: "sodiumEnabled", value: "true" }] : others;
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

// Generated by expo-svelte. MainReactPackage without the modules the engine does not use.
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

// Generated by expo-svelte. A package whose view managers React Native creates on first use: the host would
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
 * Expo's prebuild applies a built-in plugin for every installed package it thinks is autolinked (expo-local-authentication's biometric
 * permissions, expo-notifications', …), and it asks the autolinker with `package.json`'s options only, so
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

/**
 * The prebuild stops for an app that installs a package the library carries (`vendored.ts`): the library links its copy, and the app's own would be linked beside it, two
 * native modules of one name. The same refusal as `expo-svelte doctor`'s and `ios-autolinking`'s.
 */
export function assertNoVendoredOriginals(projectRoot: string): void {
  const declared = declaredVendored(projectRoot);
  if (declared.length > 0) throw new Error(collisionMessage(declared, libraryPackage));
}

/**
 * The `androidOnDemandViewManagers` the app gave, without the entries of an optional library that is off: the entry names the library's package class, which is not in the build
 * (Kotlin would not compile `is com.rnmaps.maps.MapsPackage` without it), so one config can serve the builds that turn a library on and those that do not.
 */
export function onDemandForLibraries(onDemand: Record<string, string[]> | undefined, enabled: readonly string[]): Record<string, string[]> | undefined {
  if (onDemand === undefined) return undefined;
  const absent = optionalPackages.filter((vendored) => !enabled.includes(vendored.name)).map((vendored) => /^import ([\w.]+);$/.exec(vendored.android?.packageImportPath ?? "")?.[1]);
  return Object.fromEntries(Object.entries(onDemand).filter(([packageClass]) => !absent.includes(packageClass)));
}

/**
 * The optional libraries the app turned on, applied to the Expo config: each library's own config plugin runs from its copy in `vendor/` with the options the app gave it (as if the app
 * had listed the library in `plugins`), and the names of the libraries that are on go to `extra.expoSvelte.libraries`, which the device reads from the manifest embedded in the build
 * (`fabric/foreign-libraries.ts`) so that a component whose library is not in the build says how to turn it on. An app that lists a library's own plugin in `plugins` is refused: the
 * package is not installed, so Expo could not find the plugin, and its options belong to `libraries`.
 */
export const withLibraries: ConfigPlugin<Libraries> = (config, libraries) => {
  const listedPlugins = (config.plugins ?? []).map((plugin) => String(Array.isArray(plugin) ? plugin[0] : plugin)).filter((name) => vendoredPackage(name) !== undefined);
  const optionalPlugins = listedPlugins.filter((name) => vendoredPackage(name)?.optional !== undefined);
  if (optionalPlugins.length > 0) {
    throw new LibrariesConfigError(`\`plugins\` lists ${optionalPlugins.join(", ")}, which ${libraryPackage} carries and is not installed: its plugin runs from the library's copy, with its options under \`libraries\` ` +
      `(\`["${libraryPackage}", { libraries: { ${optionalPlugins.map((name) => `"${name}": { … }`).join(", ")} } }]\`). Remove it from \`plugins\`.`);
  }
  if (listedPlugins.length > 0) {
    const sodium = listedPlugins.includes("react-native-quick-crypto") ? ` react-native-quick-crypto's \`sodiumEnabled\` is an option of ${libraryPackage}'s plugin: \`["${libraryPackage}", { sodiumEnabled: true }]\`.` : "";
    throw new LibrariesConfigError(`\`plugins\` lists ${listedPlugins.join(", ")}, which ${libraryPackage} carries and links itself, and is not installed. Remove it from \`plugins\`.${sodium}`);
  }
  for (const name of libraries.enabled) {
    const vendored = vendoredPackage(name);
    const plugin = vendored && libraryPlugin(vendored);
    if (plugin) config = plugin(config as never, libraries.listed.get(name) as never) as typeof config;
  }
  const expoSvelte = (config.extra?.[EXTRA_KEY] ?? {}) as Record<string, unknown>;
  return { ...config, extra: { ...config.extra, [EXTRA_KEY]: { ...expoSvelte, libraries: [...libraries.enabled] } } };
};

const withExpoSvelte: ConfigPlugin<ExpoSvelteOptions | undefined> = (config, options) => {
  if (options?.sodiumEnabled !== undefined && typeof options.sodiumEnabled !== "boolean") throw new Error(`Svelte native: sodiumEnabled must be true or false, not ${JSON.stringify(options.sodiumEnabled)}`);
  const sodium = options?.sodiumEnabled === true;
  const libraries = checkLibraries(options?.libraries);
  const links = libraryLinks(libraries.enabled);
  config = leaveOutOfAutoPlugins(config, options?.autolinkingExclude ?? []);
  config = withLibraries(config, libraries);
  config = withCapabilities(config, options?.capabilities, { excluded: options?.autolinkingExclude });
  if (options?.remote) config = withRemoteHost(config, options.remote);
  for (const platform of ["android", "ios"] as const) {
    config = withDangerousMod(config, [platform, async (config) => {
      assertNoVendoredOriginals(config.modRequest.projectRoot);
      await syncNative(config.modRequest.projectRoot, { variant: options?.variant });
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
    applyUserInterfaceStyle(application as AndroidConfig.Manifest.ManifestApplication, hasSystemUi(config.modRequest.projectRoot) ? null : userInterfaceStyleOf(config));
    return config;
  });
  config = withSettingsGradle(config, (config) => {
    config.modResults.contents = applyHeadlessSettings(config.modResults.contents, options?.autolinkingExclude, links);
    return config;
  });
  config = withPodfile(config, (config) => {
    config.modResults.contents = applyPodfileSodium(applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(config.modResults.contents, [...(options?.autolinkingExclude ?? []), ...links.expoOff], links.expo), links.reactNative), sodium);
    return config;
  });
  config = withGradleProperties(config, (config) => {
    config.modResults = applyGradleSodium(config.modResults, sodium);
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
  config = withDangerousMod(config, ["ios", async (config) => {
    // Expo SDK 58's template has a `SceneDelegate.swift` beside `AppDelegate.swift` (one folder below ios/, named for the project); an older template has none.
    const root = config.modRequest.platformProjectRoot;
    const folders = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    for (const folder of folders) {
      const file = join(root, folder, "SceneDelegate.swift");
      const contents = await readFile(file, "utf8").catch(() => undefined);
      if (contents !== undefined) await writeFile(file, applySceneDelegate(contents));
    }
    return config;
  }]);
  config = withMainApplication(config, (config) => {
    if (config.modResults.language !== "kt") throw new Error("Svelte native requires Expo's Kotlin MainApplication");
    config.modResults.contents = applyHeadlessApplication(applyFeatureFlags(config.modResults.contents, androidFeatureFlagsFor(options)), onDemandForLibraries(options?.androidOnDemandViewManagers, links.enabled));
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

export default withExpoSvelte;

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
