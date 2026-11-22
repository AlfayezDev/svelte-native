/**
 * Which optional library a foreign component or Expo view belongs to, and whether the build has it. The libraries are the package's own copies, turned on in the app's config
 * (`libraries` of the plugin options: `libraries.ts`, `optional-libraries.ts`), and the plugin writes the names that are on to `extra.expoSvelte.libraries`, which `expo-constants` embeds
 * in the build. A component whose library is not in the build then says how to turn it on, where it would otherwise fail inside the native mounting with a name nobody asked for.
 *
 * A build that has no list (an app prebuilt before the option existed, a host test) is taken to have every library: this only makes the message better, it never refuses a component
 * that would have mounted. Nothing here imports the Node side (`libraries.ts` reads files); `tests/foreign/libraries.test.ts` keeps the two in step.
 */

/** The Fabric components of the libraries (a name, or a prefix with `*`), by library. */
const components: Readonly<Record<string, readonly string[]>> = {
  "react-native-webview": ["RNCWebView"],
  "react-native-maps": ["RNMaps*"],
  "react-native-video": ["RCTVideo"],
  "@react-native-community/datetimepicker": ["RNDateTimePicker"],
  "lottie-react-native": ["LottieAnimationView"],
  "react-native-pdf": ["RNPDFPdfView"],
  "rive-react-native": ["RiveReactNativeView"],
  "react-native-fast-shadow": ["FastShadowView"],
  "react-native-animateable-text": ["JBAnimatedText"],
};

/** The Expo modules of the libraries: the module a view belongs to (`expoViewName`). */
const expoModules: Readonly<Record<string, string>> = {
  ExpoImage: "expo-image",
  ExpoBlur: "expo-blur",
  ExpoLinearGradient: "expo-linear-gradient",
  ConicGradient: "expo-conic-gradient",
  ExpoVideo: "expo-video",
};

/** The same sentence Metro's stub throws (`enableMessage` in `libraries.ts`). */
export const enableMessage = (name: string): string =>
  `${name} is not in this app: turn it on with \`libraries: { "${name}": true }\` in the expo-svelte plugin options (app.json or app.config.*), then prebuild and build the app again`;

/** The library a Fabric component name belongs to, if it belongs to one. */
export function libraryOfComponent(component: string): string | undefined {
  for (const [library, names] of Object.entries(components)) {
    if (names.some((name) => (name.endsWith("*") ? component.startsWith(name.slice(0, -1)) : component === name))) return library;
  }
  return undefined;
}

/** The library an Expo module belongs to (`ExpoImage` is `expo-image`), if it belongs to one. */
export const libraryOfExpoModule = (module: string): string | undefined => expoModules[module];

let embedded: readonly string[] | undefined | null = null;

/** The libraries the build has, from the config embedded in it; `undefined` when the build has no list. Read once. */
function libraryList(): readonly string[] | undefined {
  if (embedded !== null) return embedded;
  embedded = undefined;
  try {
    // Lazily: the manifest is only read when a foreign component is made, which is not at boot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constants = (require("expo-constants") as { default?: { expoConfig?: { extra?: Record<string, unknown> } | null } }).default;
    const section = constants?.expoConfig?.extra?.expoSvelte as { libraries?: unknown } | undefined;
    if (Array.isArray(section?.libraries)) embedded = section.libraries.filter((name): name is string => typeof name === "string");
  } catch {
    // No list: every library is taken to be in the build, as the header says.
  }
  return embedded;
}

/** Throws how to turn `library` on when the build has a list of libraries and the library is not in it. */
export function assertLibrary(library: string): void {
  const list = libraryList();
  if (list !== undefined && !list.includes(library)) throw new Error(enableMessage(library));
}

/** `assertLibrary` for a Fabric component, when the component belongs to a library (any other name is no library's concern). */
export function assertComponent(component: string): void {
  const library = libraryOfComponent(component);
  if (library !== undefined) assertLibrary(library);
}
