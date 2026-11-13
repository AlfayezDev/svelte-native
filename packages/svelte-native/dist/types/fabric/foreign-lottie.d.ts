/**
 * The source resolution, speed and commands of `lottie-react-native` 7 (`LottieView/index.tsx`, `LottieView/utils.ts`)
 * without React. The native view is the codegen component `LottieAnimationView`; its commands (`play`, `reset`, `pause`,
 * `resume`) are the library's `codegenNativeCommands`, dispatched by name. Nothing here imports `lottie-react-native`.
 */
import type { Commandable } from "./foreign.js";
/** A Lottie animation as a JavaScript object (what `require("./animation.json")` gives), the shape the library types. */
export type AnimationObject = {
    v: string;
    fr: number;
    ip: number;
    op: number;
    w: number;
    h: number;
    assets?: unknown[];
    layers: unknown[];
    [key: string]: unknown;
};
/** The source of an animation: a name in the app's assets (Android's `assets` folder, iOS's bundle), a URL, a `require`d `.lottie` or `.json` asset, or the animation object itself. */
export type LottieSource = string | number | AnimationObject | {
    uri: string;
};
export type LottieSources = {
    sourceName?: string;
    sourceJson?: string;
    sourceURL?: string;
    sourceDotLottieURI?: string;
};
/** `parsePossibleSources`: which of the four native source props the source goes in. */
export declare function lottieSources(source: LottieSource, resolveAsset: (asset: number) => {
    uri: string;
} | null | undefined): LottieSources | undefined;
/** The speed that makes the animation last `duration` ms; only an animation given as an object knows its own length (`op / fr` seconds). */
export declare function lottieSpeed(speed: number | undefined, duration: number | undefined, source: LottieSource, sources: LottieSources | undefined): number | undefined;
/** The functions of the library's ref, as commands of the native view. `play` without frames plays the whole animation. */
export type LottieHandle = {
    play(startFrame?: number, endFrame?: number): void;
    reset(): void;
    pause(): void;
    resume(): void;
};
export declare function lottieHandle(host: Commandable): LottieHandle;
