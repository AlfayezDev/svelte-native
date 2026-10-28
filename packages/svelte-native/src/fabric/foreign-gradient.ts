/**
 * The props of `expo-linear-gradient`'s `LinearGradient` (`LinearGradient.tsx`, `NativeLinearGradient.android.tsx`) without
 * React: points as `[x, y]`, locations cut to the number of colours, and, on Android, the corner radii of the style as the
 * eight numbers the native view rounds its path with. The colours stay as given: the view's config converts them to the
 * integers the native view takes (`colorLists`, see `fabric/view-configs.ts`).
 */
export type GradientPoint = { x: number; y: number } | readonly [number, number];
export type GradientProps = {
  colors: readonly unknown[];
  locations?: readonly number[] | null;
  start?: GradientPoint | null;
  end?: GradientPoint | null;
  dither?: boolean;
};

function normalizePoint(point?: GradientPoint | null): [number, number] | undefined {
  if (!point) return undefined;
  if (Array.isArray(point) && point.length !== 2) {
    console.warn("start and end props for LinearGradient must be of the format [x,y] or {x, y}");
    return undefined;
  }
  const pair = point as readonly [number, number] | { x: number; y: number };
  return Array.isArray(pair) ? [pair[0], pair[1]] : [(pair as { x: number; y: number }).x, (pair as { x: number; y: number }).y];
}

/** The native gradient view's props for the component's. `dither` is Android's. */
export function gradientProps({ colors, locations, start, end, dither }: GradientProps, platform: "android" | "ios"): Record<string, unknown> {
  let resolvedLocations: readonly number[] | null | undefined = locations;
  if (locations && colors.length !== locations.length) {
    console.warn("LinearGradient colors and locations props should be arrays of the same length");
    resolvedLocations = locations.slice(0, colors.length);
  }
  return {
    colors,
    locations: resolvedLocations,
    startPoint: normalizePoint(start),
    endPoint: normalizePoint(end),
    dither: platform === "android" ? dither : undefined,
  };
}

/**
 * Android's native gradient is a plain view drawn behind the children, so the corner radii of the container's style go to it as
 * `borderRadii` (top left, top right, bottom right, bottom left, each twice, in that order: `Path.addRoundRect`).
 */
export function borderRadii(style: Record<string, unknown>): number[] {
  const radius = (style.borderRadius as number | undefined) ?? 0;
  const corner = (name: string) => (style[name] as number | undefined) ?? radius;
  const topLeft = corner("borderTopLeftRadius");
  const topRight = corner("borderTopRightRadius");
  const bottomRight = corner("borderBottomRightRadius");
  const bottomLeft = corner("borderBottomLeftRadius");
  return [topLeft, topLeft, topRight, topRight, bottomRight, bottomRight, bottomLeft, bottomLeft];
}
