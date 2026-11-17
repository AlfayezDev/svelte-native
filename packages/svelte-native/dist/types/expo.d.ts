import { type ConfigPlugin } from "expo/config-plugins";
import { type Capabilities } from "./capabilities.js";
export type { Capabilities, LocationCapability, PushCapability } from "./capabilities.js";
import type { RemoteHostConfig } from "./remote/host.js";
export type ViewRecycling = {
    view?: boolean;
    text?: boolean;
    image?: boolean;
    scrollView?: boolean;
};
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
     * `extra.svelteNative.remote` (where the runtime reads it, from the manifest `expo-constants` embeds) and, for an `http:` origin, the
     * Android and iOS builds are allowed to use plain HTTP to it. Leave it out and the app has no host: a remote function throws when called
     * until `configureRemote({ origin })` sets one.
     */
    remote?: RemoteHostConfig;
    /**
     * The variant whose route table (`.svelte-native/routes.<variant>.ts`) the prebuild writes. Default: `APP_VARIANT`, or `app` when that is empty. An app whose own default is
     * another name passes it here instead of setting the environment from its config (which every tool that imports the config would inherit).
     */
    variant?: string;
    /**
     * The web APIs that need a permission of the system, each turned on by saying why the app uses it. `location` (with expo-location installed) is
     * `navigator.geolocation`: `{ location: "Shows the stores near you." }`, the text iOS shows when it asks, or `{ location: { whenInUse, background } }` for the
     * background too. `push` is push notifications (its native code is part of the library), from the app's identifiers: `{ push: { android: { googleServicesFile },
     * ios: { mode } } }`, and never a server key. A capability on without its library, and a library installed without its capability, stop the prebuild (`capabilities.ts`).
     */
    capabilities?: Capabilities;
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
export declare function androidFeatureFlagsFor(options?: Pick<SvelteNativeOptions, "androidViewRecycling" | "androidFeatureFlags">): Record<string, boolean>;
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
 * `settings.gradle`: excludes packages from Expo and React Native autolinking, the headless ones and `extra`, and runs React Native's config command
 * through the library's `android-autolinking` (`autolinking.ts`: the packages the library carries are linked from its directory, and the Nitro modules' native libraries load
 * after the start). With
 * `EXPO_USE_COMMUNITY_AUTOLINKING=1` the community CLI's command runs as it is. Idempotent.
 */
export declare function applyHeadlessSettings(contents: string, extra?: readonly string[]): string;
/**
 * `Podfile`: the packages Expo's `use_expo_modules!` and the React Native config command (`expo-modules-autolinking
 * react-native-config`) leave out. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command is the community CLI's own, which
 * reads `react-native.config.js` instead. Idempotent; an empty list restores the template.
 */
export declare function applyPodfileAutolinkingExclude(contents: string, names: readonly string[]): string;
/**
 * `Podfile`: the config command that `use_native_modules!` runs goes through the library's `ios-autolinking` (`autolinking.ts`), which adds the packages the library carries
 * (`vendored.ts`: the Nitro runtime and MMKV) to its output, with the podspecs of `vendor/` in the library's directory, so the app's package.json lists none of them. The block
 * goes in front of the line that reads the config, after anything that already extended the command; stripped and written again on every prebuild, so an update of the
 * library moves it. With `EXPO_USE_COMMUNITY_AUTOLINKING=1` the command underneath is the community CLI's, and its output gets the same entries.
 */
export declare function applyPodfileVendoredLinking(contents: string): string;
/** Kotlin source for the package that replaces `MainReactPackage` in headless builds. */
export declare function headlessPackageSource(applicationId: string): string;
/** Kotlin source of the wrapper that makes a package's view managers on demand (`androidOnDemandViewManagers`). */
export declare function onDemandPackageSource(applicationId: string): string;
/**
 * Expo's prebuild applies a built-in plugin for every installed package it thinks is autolinked (expo-location's location
 * permissions, expo-local-authentication's biometric ones, …), and it asks the autolinker with `package.json`'s options only, so
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
 * native modules of one name. The same refusal as `svelte-native doctor`'s and `ios-autolinking`'s.
 */
export declare function assertNoVendoredOriginals(projectRoot: string): void;
declare const withSvelteNative: ConfigPlugin<SvelteNativeOptions | undefined>;
export default withSvelteNative;
/** Baseline profile rules (the Android Gradle plugin's text format): every method of the engine and the updates module, hot + startup + post-startup. */
export declare function baselineProfile(): string;
