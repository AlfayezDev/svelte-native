import { type AndroidConfig, type ConfigPlugin } from "expo/config-plugins";
import { type Capabilities } from "./capabilities.js";
export type { Capabilities, LocationCapability, PushCapability } from "./capabilities.js";
import { type Libraries, type LibraryLinks, type LibrariesOption } from "./libraries.js";
export type { LibrariesOption, LibraryOptions } from "./libraries.js";
import { type RemoteHostConfig } from "./remote/host.js";
export type ViewRecycling = {
    view?: boolean;
    text?: boolean;
    image?: boolean;
    scrollView?: boolean;
};
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
export declare const headlessExcludedPackages: string[];
/** TurboModules the headless `MainReactPackage` replacement does not offer. Fresco is `needsEagerInit`; ImageLoader and ImageStore need it. */
export declare const headlessDroppedTurboModules: string[];
/** Rewrites the generated feature-flag block after `loadReactNative(this)`, which installs React Native's own stable overrides first. */
/**
 * The React Native flags the engine is built and measured with, which every app gets unless it overrides one: view preallocation off (the
 * engine mounts its own views; React Native's preallocation creates views when shadow nodes are made, before the eager modules exist, so an
 * `Image` on the first screen reached Fresco before `FrescoModule` initialised it and the app crashed: the showcase, 9 Nov 2026), and
 * prepared text layouts (the engine draws React Native's `PreparedLayout` as is). Both were set only by the QA app's config before.
 */
export declare const defaultAndroidFeatureFlags: Readonly<Record<string, boolean>>;
/** The flags the plugin writes: the library's defaults, the view-recycling overrides, then the app's own `androidFeatureFlags`. */
export declare function androidFeatureFlagsFor(options?: Pick<ExpoSvelteOptions, "androidViewRecycling" | "androidFeatureFlags">): Record<string, boolean>;
export declare function applyFeatureFlags(contents: string, overrides: string[] | Record<string, boolean>): string;
/** `MainApplication.kt`: swaps `MainReactPackage` and starts the React host in `onCreate`. Idempotent (prebuild re-runs on the same file). */
export declare function applyHeadlessApplication(contents: string, onDemand?: Record<string, string[]>): string;
/**
 * `MainActivity.kt`: keeps the root router's navigation state in the Activity's saved instance state and passes it back to
 * JavaScript when the surface starts again (`initialProps.navigation`): after the Activity was recreated (font scale, locale)
 * and after the process was killed in the background. Expo's template calls `super.onCreate(null)`, so the saved state is read
 * in `onCreate` before that. Idempotent (prebuild re-runs on the same file).
 */
export declare function applyMainActivity(contents: string): string;
/**
 * `AppDelegate.swift` (iOS): the four state restoration callbacks of `UIApplicationDelegate`, which Expo's `ExpoAppDelegate` does not forward, call
 * `SvelteNavigationRestoration` (`native/svelte-core/ios/navigation`). UIKit saves the application's restorable state when the app enters the background,
 * asks `shouldRestore` at the next launch only if it still has that state, and has deleted it when the user swiped the app away: that call is how the
 * navigation module tells a process the system ended (restore) from one the user ended (start from the first screen), as Android's saved instance
 * state does. The methods keep the protocol's Objective-C selectors under names of their own, so a later `ExpoAppDelegate` that forwards them is a
 * compile error to read, not a silent override. Idempotent (prebuild re-runs on the same file).
 */
export declare function applyAppDelegate(contents: string): string;
/**
 * `SceneDelegate.swift` (iOS, Expo SDK 58): the template starts React Native from a `UIWindowSceneDelegate` (`ExpoAppSceneDelegate`, which iOS 27 requires of every app), and UIKit does not call the
 * application delegate's four state restoration callbacks (`applyAppDelegate`) of an app that has scenes. The same signal is the scene's: `stateRestorationActivity(for:)` is asked when the app
 * enters the background, and the session the system connects at the next launch has that activity only if the system kept the state (it deletes it for an app the user swiped away). The
 * scene's `willConnectTo` notes it before `ExpoAppSceneDelegate` starts React Native, which is when JavaScript can ask (`SvelteNavigationRestoration`, `native/svelte-core/ios/navigation`).
 * A project whose template has no `SceneDelegate.swift` keeps `applyAppDelegate`'s callbacks alone. Idempotent.
 */
export declare function applySceneDelegate(contents: string): string;
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
export declare function applyHeadlessSettings(contents: string, extra?: readonly string[], links?: LibraryLinks): string;
/**
 * `Podfile`: the packages Expo's `use_expo_modules!` and the React Native config command (`expo-modules-autolinking
 * react-native-config`) leave out. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command is the community CLI's own, which
 * reads `react-native.config.js` instead. Idempotent; an empty list restores the template.
 *
 * `expoModules` are the optional Expo modules the app turned on (`libraries.ts`): `use_expo_modules!` gets their directories in the library (`vendor/<name>`, which the block finds from the
 * app with `require.resolve`, as it finds the CLI) as `searchPaths`, and nothing else of the library's copies is looked at.
 */
export declare function applyPodfileAutolinkingExclude(contents: string, names: readonly string[], expoModules?: readonly string[]): string;
/**
 * `Podfile`: the config command that `use_native_modules!` runs goes through the library's `ios-autolinking` (`autolinking.ts`), which adds the packages the library carries
 * (`vendored.ts`, which lists them, and the optional libraries `links` names, `libraries.ts`) to its output, with the podspecs
 * of `vendor/` in the library's directory, so the app's package.json lists none of them. The block goes in front of the line that reads the config, after anything that already extended the
 * command; stripped and written again on every prebuild, so an update of the library moves it. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command underneath is the community CLI's, and its output
 * gets the same entries.
 */
export declare function applyPodfileVendoredLinking(contents: string, links?: readonly string[]): string;
/**
 * `Podfile`: `ENV['SODIUM_ENABLED'] = '1'` before anything else, which the podspec of react-native-quick-crypto reads when CocoaPods evaluates it (what quick-crypto's own Expo plugin wrote
 * at the top of the Podfile when `sodiumEnabled` was its option). Stripped and written again on every prebuild, so a project prebuilt with the option and then without it loses the line.
 */
export declare function applyPodfileSodium(contents: string, enabled: boolean): string;
/**
 * `gradle.properties`: `sodiumEnabled=true`, which the Gradle project of react-native-quick-crypto reads (`hasProperty('sodiumEnabled')`: it passes `-DSODIUM_ENABLED` to CMake and adds
 * `io.github.ronickg:sodium`). Without the option the property is removed, so the setting is the plugin's alone and one directory can be prebuilt with and without it.
 */
export declare function applyGradleSodium(properties: AndroidConfig.Properties.PropertiesItem[], enabled: boolean): AndroidConfig.Properties.PropertiesItem[];
/** Kotlin source for the package that replaces `MainReactPackage` in headless builds. */
export declare function headlessPackageSource(applicationId: string): string;
/** Kotlin source of the wrapper that makes a package's view managers on demand (`androidOnDemandViewManagers`). */
export declare function onDemandPackageSource(applicationId: string): string;
/**
 * Expo's prebuild applies a built-in plugin for every installed package it thinks is autolinked (expo-local-authentication's biometric
 * permissions, expo-notifications', …), and it asks the autolinker with `package.json`'s options only, so
 * it never sees the excludes this plugin passes on the command line: a package left out of the build would still add its manifest
 * permissions and Info.plist texts. Every Expo plugin runs once per config (`createRunOncePlugin`, keyed by package name), so the
 * excluded packages are entered in the config's plugin history here, before the prebuild applies its own, and those plugins
 * do nothing.
 */
export declare function leaveOutOfAutoPlugins<Config extends {
    _internal?: Record<string, unknown>;
}>(config: Config, names: readonly string[]): Config;
/**
 * The prebuild stops for an app that installs a package the library carries (`vendored.ts`): the library links its copy, and the app's own would be linked beside it, two
 * native modules of one name. The same refusal as `expo-svelte doctor`'s and `ios-autolinking`'s.
 */
export declare function assertNoVendoredOriginals(projectRoot: string): void;
/**
 * The `androidOnDemandViewManagers` the app gave, without the entries of an optional library that is off: the entry names the library's package class, which is not in the build
 * (Kotlin would not compile `is com.rnmaps.maps.MapsPackage` without it), so one config can serve the builds that turn a library on and those that do not.
 */
export declare function onDemandForLibraries(onDemand: Record<string, string[]> | undefined, enabled: readonly string[]): Record<string, string[]> | undefined;
/**
 * The optional libraries the app turned on, applied to the Expo config: each library's own config plugin runs from its copy in `vendor/` with the options the app gave it (as if the app
 * had listed the library in `plugins`), and the names of the libraries that are on go to `extra.expoSvelte.libraries`, which the device reads from the manifest embedded in the build
 * (`fabric/foreign-libraries.ts`) so that a component whose library is not in the build says how to turn it on. An app that lists a library's own plugin in `plugins` is refused: the
 * package is not installed, so Expo could not find the plugin, and its options belong to `libraries`.
 */
export declare const withLibraries: ConfigPlugin<Libraries>;
declare const withExpoSvelte: ConfigPlugin<ExpoSvelteOptions | undefined>;
export default withExpoSvelte;
/** Baseline profile rules (the Android Gradle plugin's text format): every method of the engine and the updates module, hot + startup + post-startup. */
export declare function baselineProfile(): string;
