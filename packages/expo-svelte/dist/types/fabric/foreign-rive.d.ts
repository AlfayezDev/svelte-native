/**
 * `rive-react-native` 9.7 without React (`Rive.tsx`, `utils.ts`, `helpers.ts`). The native view is the legacy view manager
 * `RiveReactNativeView`; the library sends its commands with `UIManager.dispatchViewManagerCommand(tag, name, args)`, which
 * Fabric's interop turns into the manager's `receiveCommand` (Android) or the `RCT_EXTERN_METHOD`s (iOS), and the host's
 * `dispatchCommand(name, args)` is the same call. Nothing here imports the library.
 */
import type { Commandable } from "./foreign.js";
export type RiveFit = "cover" | "contain" | "fill" | "fitWidth" | "fitHeight" | "none" | "scaleDown" | "layout";
export type RiveAlignment = "topLeft" | "topCenter" | "topRight" | "centerLeft" | "center" | "centerRight" | "bottomLeft" | "bottomCenter" | "bottomRight";
export type RiveLoopMode = "oneShot" | "loop" | "pingPong" | "auto";
export type RiveDirection = "backwards" | "auto" | "forwards";
export type RiveRGBA = {
    r: number;
    g: number;
    b: number;
    a: number;
};
export type RiveDataBinding = {
    type: "autobind";
    value: boolean;
} | {
    type: "index";
    value: number;
} | {
    type: "name";
    value: string;
} | {
    type: "empty";
};
/** `AutoBind(false)`, the library's default: no data binding. */
export declare const noAutoBind: RiveDataBinding;
/** The `source` prop: a `require`d `.riv` asset or a `{ uri }`. */
export type RiveSource = number | {
    uri: string;
};
export type RiveResource = {
    resourceName?: string;
    url?: string;
};
/**
 * The `useMemo` of `RiveContainer`: `resourceName` (a file in the app's assets or the iOS bundle) wins over `url`, which wins over
 * `source`; an asset is a `url` when it is an `http(s)` address (the dev server), the stripped bundle name on iOS (`file://…/App.app/name.riv`),
 * a `url` for any other file (a downloaded update), and a `resourceName` on Android.
 */
export declare function riveResource(props: {
    resourceName?: string;
    url?: string;
    source?: RiveSource;
}, resolveAsset: (asset: number) => {
    uri?: string;
} | null | undefined): RiveResource;
/** A file a `.riv` refers to (an image, a font, an audio clip), in the form the native view takes. */
export type RiveAssetSource = number | {
    uri: string;
} | {
    fileName: string;
    path?: string;
};
export type RiveFileSource = {
    sourceUrl?: string;
    sourceAsset?: string;
    sourceAssetId?: string;
    path?: string;
};
/** `parsePossibleSources`: a `require`d asset is `sourceAssetId`, `{ uri }` is `sourceUrl`, `{ fileName, path? }` is a packaged `sourceAsset`. */
export declare function riveAssetSource(source: RiveAssetSource, resolveAsset: (asset: number) => {
    uri?: string;
} | null | undefined): RiveFileSource;
/** `referencedAssets` with each source converted (`transformFilesHandledMapping`). */
export declare function riveReferencedAssets(mapping: Record<string, {
    source: RiveAssetSource | RiveFileSource;
}> | undefined, resolveAsset: (asset: number) => {
    uri?: string;
} | null | undefined): Record<string, unknown> | undefined;
export declare const riveErrorTypes: readonly ["FileNotFound", "UnsupportedRuntimeVersion", "IncorrectRiveFileUrl", "IncorrectAnimationName", "MalformedFile", "IncorrectArtboardName", "IncorrectStateMachineName", "IncorrectStateMachineInput", "TextRunNotFoundError", "DataBindingError", "UnusedReferencedAssetError"];
export type RiveError = {
    type: (typeof riveErrorTypes)[number];
    message: string;
};
/** `convertErrorFromNativeToRN`: null for a type the library does not know. */
export declare function riveError(native: {
    type: string;
    message: string;
}): RiveError | null;
/** `parseColor`: `#rrggbb` or `#rrggbbaa` as channels; anything else warns and is opaque black. */
export declare function parseRiveColor(color: string): RiveRGBA;
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
export declare function riveHandle(host: Commandable, module?: () => RiveModule): RiveHandle;
