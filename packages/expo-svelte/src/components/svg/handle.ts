import { svgHandle, svgRootHandle, type SvgHandle, type SvgRootHandle } from "../../fabric/foreign-svg.ts";
import { forwardRef } from "../forward-ref.ts";

/** The `ref` of the react-native-svg components: the host handle of the node with the library's methods on it (`SvgHandle`). */
export type SvgRef<Handle = SvgHandle> = (handle: Handle | null) => void;

type Host = Parameters<typeof svgHandle>[0];

/**
 * The host's `ref` callback for a component: hands `ref` the element's handle, or null when the node goes away. `matrix`: its `setNativeProps` also takes a
 * transform. Make it in a `$derived` (`forwardRef`).
 */
export function handleRef(ref: SvgRef | undefined, options: { matrix?: boolean } = {}): (host: unknown) => void {
  return forwardRef<Host, SvgHandle>(ref, (host) => svgHandle(host, options));
}

export function rootRef(ref: SvgRef<SvgRootHandle> | undefined): (host: unknown) => void {
  return forwardRef<Host, SvgRootHandle>(ref, svgRootHandle);
}

/** What every element takes next to the library's own props. */
export type SvgExtras = {
  /** A worklet returning native props (`{ r: 12 }`, `{ d: "M0 0L10 10" }`): Reanimated writes them on the UI thread (SPEC.md, "react-native-svg"). */
  animatedProps?: (() => Record<string, unknown>) | ReadonlyArray<() => Record<string, unknown>>;
  /** Receives the element's handle (`getBBox`, `getTotalLength`, `getPointAtLength`, `isPointInFill`, ...) or null when it goes away. */
  ref?: SvgRef;
};
