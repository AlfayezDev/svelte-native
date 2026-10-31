import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainActivity, withMainApplication, withPodfile, withSettingsGradle, type ConfigPlugin } from "expo/config-plugins";
import { syncNative } from "./build.ts";

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
   * first commit); a package such as react-native-maps creates a dozen. The package keeps providing its TurboModules.
   */
  androidOnDemandViewManagers?: Record<string, string[]>;
  /**
   * Packages both autolinkers leave out of this build, on top of the headless ones: Expo's (`expoAutolinking.exclude` in
   * `settings.gradle`, `use_expo_modules!(exclude:)` in the Podfile) and React Native's (`--exclude` on the config command both
   * pass). The platform app gives the product the packages of the native module smoke test, so only the QA app links them.
   */
  autolinkingExclude?: string[];
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
const packagesBegin = "          // Svelte native: headless package list (generated, do not edit)";
const packagesEnd = "          // Svelte native: end of headless package list";
const startBegin = "    // Svelte native: headless host start (generated, do not edit)";
const startEnd = "    // Svelte native: end of headless host start";
const activityBegin = "  // Svelte native: navigation state across recreation and process death (generated, do not edit)";
const activityEnd = "  // Svelte native: end of navigation state";
const savedBegin = "    // Svelte native: the navigation this Activity was saved with (generated, do not edit)";
const savedEnd = "    // Svelte native: end of saved navigation";
const launchBegin = "            // Svelte native: the saved navigation reaches JavaScript as initialProps.navigation (generated, do not edit)";
const launchEnd = "            // Svelte native: end of launch options";
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
  const stripped = contents.replace(blockPattern(packagesBegin, packagesEnd), "").replace(blockPattern(startBegin, startEnd), "");
  const packagesAnchor = /^[ \t]*\/\/ add\(MyReactNativePackage\(\)\)[ \t]*$/m.exec(stripped);
  const startAnchor = /^[ \t]*ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)[ \t]*$/m.exec(stripped);
  if (!packagesAnchor || !startAnchor) throw new Error("Svelte native could not find the package list or onApplicationCreate in MainApplication.kt");
  const packages = [
    packagesBegin,
    "          for (index in indices) {",
    `            if (this[index] is com.facebook.react.shell.MainReactPackage) this[index] = ${headlessPackageName}()`,
    ...Object.entries(onDemand).map(([packageClass, names]) => `            if (this[index] is ${packageClass}) this[index] = ${onDemandPackageName}(this[index], listOf(${names.map((name) => `"${name}"`).join(", ")}))`),
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
    "    // Hermes and TurboModule setup run on a pool thread; beginning now overlaps them with activity creation.",
    "    reactHost.start()",
    startEnd,
  ].join("\n");
  const packagesAt = packagesAnchor.index + packagesAnchor[0].length;
  const startAt = startAnchor.index + startAnchor[0].length;
  return `${stripped.slice(0, packagesAt)}\n${packages}${stripped.slice(packagesAt, startAt)}\n${start}${stripped.slice(startAt)}`;
}

/**
 * `MainActivity.kt`: keeps the root router's navigation state in the Activity's saved instance state and passes it back to
 * JavaScript when the surface starts again (`initialProps.navigation`): after the Activity was recreated (font scale, locale)
 * and after the process was killed in the background. Expo's template calls `super.onCreate(null)`, so the saved state is read
 * in `onCreate` before that. Idempotent (prebuild re-runs on the same file).
 */
export function applyMainActivity(contents: string): string {
  const stripped = contents.replace(blockPattern(activityBegin, activityEnd), "").replace(blockPattern(savedBegin, savedEnd), "").replace(blockPattern(launchBegin, launchEnd), "");
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
  const saved = [savedBegin, "    svelteNavigation = expo.modules.svelteengine.NavigationState.restoredFrom(savedInstanceState)", savedEnd, ""].join("\n");
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

// Generated by @rasheed/svelte-native. MainReactPackage without the modules the engine does not use.
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

// Generated by @rasheed/svelte-native. A package whose view managers React Native creates on first use: the host would
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
`;
}

const withSvelteNative: ConfigPlugin<SvelteNativeOptions | undefined> = (config, options) => {
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
