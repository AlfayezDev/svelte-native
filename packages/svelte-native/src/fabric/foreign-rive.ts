/**
 * `rive-react-native` 9.7 without React (`Rive.tsx`, `utils.ts`, `helpers.ts`). The native view is the legacy view manager
 * `RiveReactNativeView`; the library sends its commands with `UIManager.dispatchViewManagerCommand(tag, name, args)`, which
 * Fabric's interop turns into the manager's `receiveCommand` (Android) or the `RCT_EXTERN_METHOD`s (iOS), and the host's
 * `dispatchCommand(name, args)` is the same call. Nothing here imports the library.
 */
import type { Commandable } from "./foreign.ts";

export type RiveFit = "cover" | "contain" | "fill" | "fitWidth" | "fitHeight" | "none" | "scaleDown" | "layout";
export type RiveAlignment = "topLeft" | "topCenter" | "topRight" | "centerLeft" | "center" | "centerRight" | "bottomLeft" | "bottomCenter" | "bottomRight";
export type RiveLoopMode = "oneShot" | "loop" | "pingPong" | "auto";
export type RiveDirection = "backwards" | "auto" | "forwards";
export type RiveRGBA = { r: number; g: number; b: number; a: number };
export type RiveDataBinding = { type: "autobind"; value: boolean } | { type: "index"; value: number } | { type: "name"; value: string } | { type: "empty" };
/** `AutoBind(false)`, the library's default: no data binding. */
export const noAutoBind: RiveDataBinding = { type: "autobind", value: false };

/** The `source` prop: a `require`d `.riv` asset or a `{ uri }`. */
export type RiveSource = number | { uri: string };
export type RiveResource = { resourceName?: string; url?: string };

/**
 * The `useMemo` of `RiveContainer`: `resourceName` (a file in the app's assets or the iOS bundle) wins over `url`, which wins over
 * `source`; an asset is a `url` when it is an `http(s)` address (the dev server), the stripped bundle name on iOS (`file://…/App.app/name.riv`),
 * a `url` for any other file (a downloaded update), and a `resourceName` on Android.
 */
export function riveResource(props: { resourceName?: string; url?: string; source?: RiveSource }, resolveAsset: (asset: number) => { uri?: string } | null | undefined): RiveResource {
  if (props.resourceName) return { resourceName: props.resourceName };
  if (props.url) return { url: props.url };
  const { source } = props;
  const uri = typeof source === "number" ? (source ? resolveAsset(source)?.uri : undefined) : typeof source === "object" ? source.uri : undefined;
  if (!uri) return {};
  if (/^https?:\/\//.test(uri)) return { url: uri };
  if (/^file:\/\//.test(uri)) {
    const name = /.*\.app\/(.*)\.riv/.exec(uri)?.[1];
    return name ? { resourceName: name } : { url: uri };
  }
  return { resourceName: uri };
}

/** A file a `.riv` refers to (an image, a font, an audio clip), in the form the native view takes. */
export type RiveAssetSource = number | { uri: string } | { fileName: string; path?: string };
export type RiveFileSource = { sourceUrl?: string; sourceAsset?: string; sourceAssetId?: string; path?: string };

/** `parsePossibleSources`: a `require`d asset is `sourceAssetId`, `{ uri }` is `sourceUrl`, `{ fileName, path? }` is a packaged `sourceAsset`. */
export function riveAssetSource(source: RiveAssetSource, resolveAsset: (asset: number) => { uri?: string } | null | undefined): RiveFileSource {
  if (typeof source === "number") {
    const uri = resolveAsset(source)?.uri;
    if (uri) return { sourceAssetId: uri };
    throw new Error("Invalid asset source provided.");
  }
  const { uri, fileName, path } = source as { uri?: string; fileName?: string; path?: string };
  if (typeof source === "object" && uri) return { sourceUrl: uri };
  if (typeof source === "object" && fileName) return path ? { sourceAsset: fileName, path } : { sourceAsset: fileName };
  throw new Error("Invalid source provided.");
}

/** `referencedAssets` with each source converted (`transformFilesHandledMapping`). */
export function riveReferencedAssets(mapping: Record<string, { source: RiveAssetSource | RiveFileSource }> | undefined, resolveAsset: (asset: number) => { uri?: string } | null | undefined): Record<string, unknown> | undefined {
  if (mapping === undefined) return undefined;
  const converted: Record<string, unknown> = {};
  for (const key of Object.keys(mapping)) converted[key] = { ...mapping[key], source: riveAssetSource(mapping[key]?.source as RiveAssetSource, resolveAsset) };
  return converted;
}

export const riveErrorTypes = [
  "FileNotFound", "UnsupportedRuntimeVersion", "IncorrectRiveFileUrl", "IncorrectAnimationName", "MalformedFile", "IncorrectArtboardName",
  "IncorrectStateMachineName", "IncorrectStateMachineInput", "TextRunNotFoundError", "DataBindingError", "UnusedReferencedAssetError",
] as const;
export type RiveError = { type: (typeof riveErrorTypes)[number]; message: string };

/** `convertErrorFromNativeToRN`: null for a type the library does not know. */
export function riveError(native: { type: string; message: string }): RiveError | null {
  return (riveErrorTypes as readonly string[]).includes(native.type) ? { type: native.type as RiveError["type"], message: native.message } : null;
}

/** `parseColor`: `#rrggbb` or `#rrggbbaa` as channels; anything else warns and is opaque black. */
export function parseRiveColor(color: string): RiveRGBA {
  const hex = color.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(hex)) {
    console.warn(`Rive invalid hex color: ${color}`);
    return { r: 0, g: 0, b: 0, a: 255 };
  }
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255 };
}

/** The `RiveReactNativeModule` the state getters call with the view's tag (a legacy native module). */
export type RiveModule = {
  getBooleanState(tag: number, inputName: string): Promise<boolean | null>;
  getNumberState(tag: number, inputName: string): Promise<number | null>;
  getBooleanStateAtPath(tag: number, inputName: string, path: string): Promise<boolean | null>;
  getNumberStateAtPath(tag: number, inputName: string, path: string): Promise<number | null>;
};

/** The ref of `Rive` (`RiveRef` of the library, without the property listeners and `viewTag`/`internalNativeEmitter`). */
export type RiveHandle = {
  play(animationName?: string, loop?: RiveLoopMode, direction?: RiveDirection, isStateMachine?: boolean): void;
  pause(): void;
  stop(): void;
  reset(): void;
  fireState(stateMachineName: string, inputName: string): void;
  setInputState(stateMachineName: string, inputName: string, value: boolean | number): void;
  fireStateAtPath(inputName: string, path: string): void;
  setInputStateAtPath(inputName: string, value: boolean | number, path: string): void;
  getBooleanState(inputName: string): Promise<boolean | null>;
  getNumberState(inputName: string): Promise<number | null>;
  getBooleanStateAtPath(inputName: string, path: string): Promise<boolean | null>;
  getNumberStateAtPath(inputName: string, path: string): Promise<number | null>;
  touchBegan(x: number, y: number): void;
  touchEnded(x: number, y: number): void;
  setTextRunValue(textRunName: string, value: string): void;
  setTextRunValueAtPath(textRunName: string, value: string, path: string): void;
  setBoolean(path: string, value: boolean): void;
  setString(path: string, value: string): void;
  setNumber(path: string, value: number): void;
  setColor(path: string, color: RiveRGBA | string): void;
  setEnum(path: string, value: string): void;
  trigger(path: string): void;
};

function riveModule(): RiveModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modules = (require("react-native/Libraries/BatchedBridge/NativeModules") as { default: Record<string, RiveModule | undefined> }).default;
  const module = modules.RiveReactNativeModule;
  if (!module) throw new Error("rive-react-native's RiveReactNativeModule native module is not linked");
  return module;
}

export function riveHandle(host: Commandable, module: () => RiveModule = riveModule): RiveHandle {
  const command = (name: string, args: unknown[]) => host.dispatchCommand(name, args);
  const guarded = <Value>(name: string, read: () => Promise<Value | null>): Promise<Value | null> =>
    new Promise<Value | null>((resolve) => resolve(read())).catch((error: unknown) => { console.error(`Error getting state for ${name}`, error); return null; });
  return {
    play: (animationName = "", loop = "auto", direction = "auto", isStateMachine = false) => command("play", [animationName, loop, direction, isStateMachine]),
    pause: () => command("pause", []),
    stop: () => command("stop", []),
    reset: () => command("reset", []),
    fireState: (stateMachineName, inputName) => command("fireState", [stateMachineName, inputName]),
    setInputState: (stateMachineName, inputName, value) => {
      if (typeof value === "boolean") command("setBooleanState", [stateMachineName, inputName, value]);
      else if (typeof value === "number") command("setNumberState", [stateMachineName, inputName, value]);
    },
    fireStateAtPath: (inputName, path) => command("fireStateAtPath", [inputName, path]),
    setInputStateAtPath: (inputName, value, path) => {
      if (typeof value === "boolean") command("setBooleanStateAtPath", [inputName, value, path]);
      else if (typeof value === "number") command("setNumberStateAtPath", [inputName, value, path]);
    },
    getBooleanState: (inputName) => guarded(inputName, () => module().getBooleanState(host.tag, inputName)),
    getNumberState: (inputName) => guarded(inputName, () => module().getNumberState(host.tag, inputName)),
    getBooleanStateAtPath: (inputName, path) => guarded(`${inputName} at path ${path}`, () => module().getBooleanStateAtPath(host.tag, inputName, path)),
    getNumberStateAtPath: (inputName, path) => guarded(`${inputName} at path ${path}`, () => module().getNumberStateAtPath(host.tag, inputName, path)),
    touchBegan: (x, y) => { if (!Number.isNaN(x) && !Number.isNaN(y)) command("touchBegan", [x, y]); },
    touchEnded: (x, y) => { if (!Number.isNaN(x) && !Number.isNaN(y)) command("touchEnded", [x, y]); },
    setTextRunValue: (textRunName, value) => { if (textRunName) command("setTextRunValue", [textRunName, value]); },
    setTextRunValueAtPath: (textRunName, value, path) => { if (textRunName) command("setTextRunValueAtPath", [textRunName, value, path]); },
    setBoolean: (path, value) => command("setBooleanPropertyValue", [path, value]),
    setString: (path, value) => command("setStringPropertyValue", [path, value]),
    setNumber: (path, value) => command("setNumberPropertyValue", [path, value]),
    setColor: (path, color) => {
      const { r, g, b, a } = typeof color === "string" ? parseRiveColor(color) : color;
      command("setColorPropertyValue", [path, r, g, b, a]);
    },
    setEnum: (path, value) => command("setEnumPropertyValue", [path, value]),
    trigger: (path) => command("fireTriggerProperty", [path]),
  };
}
