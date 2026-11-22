/**
 * The props of `expo-linear-gradient`'s `LinearGradient` (`LinearGradient.tsx`, `NativeLinearGradient.android.tsx`) without
 * React: points as `[x, y]`, locations cut to the number of colours, and, on Android, the corner radii of the style as the
 * eight numbers the native view rounds its path with. The colours stay as given: the view's config converts them to the
 * integers the native view takes (`colorLists`, see `fabric/view-configs.ts`).
 */
export type GradientPoint = {
    x: number;
    y: number;
} | readonly [number, number];
export type GradientProps = {
    colors: readonly unknown[];
    locations?: readonly number[] | null;
    start?: GradientPoint | null;
    end?: GradientPoint | null;
    dither?: boolean;
};
/** The native gradient view's props for the component's. `dither` is Android's. */
export declare function gradientProps({ colors, locations, start, end, dither }: GradientProps, platform: "android" | "ios"): Record<string, unknown>;
/**
 * Android's native gradient is a plain view drawn behind the children, so the corner radii of the container's style go to it as
 * `borderRadii` (top left, top right, bottom right, bottom left, each twice, in that order: `Path.addRoundRect`).
 */
export declare function borderRadii(style: Record<string, unknown>): number[];
