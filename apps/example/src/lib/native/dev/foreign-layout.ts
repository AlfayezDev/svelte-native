/**
 * The layout check of the native-view libraries (`foreign-libraries-checks.ts`, SPEC.md, "Device verification of the libraries"): the native view of the library
 * has the size the engine measured for it. No React Native import, so the harness's tests load it.
 *
 * The engine measures a handle (the section's host: the library's component, or the container the wrapper puts around the library's view). The library's native view
 * is one of two views: the handle's own (React Native's `View` for `ShadowedView` on iOS, which has no native code of its own), or the view of the pinned class below
 * the inspected view (a library whose view sits inside a container: Android's `FastShadowView`, `ConicGradientView` and iOS's SwiftUI `HostingView`). The section's
 * box is neither. It is the lab's frame around the section, a bordered `overflow: hidden` view that is wider than the content by the border on each side, so its size
 * never stands in for the library's: when the pinned view is not in its tree, a box that is not the measured handle has nothing to be compared with, and the check says so.
 */

/** What the platform's `inspect` answers (`Native` in `foreign-libraries-checks.ts`) that the layout check reads. */
export type Inspected = { width: number; height: number; density: number; class: string; views: readonly string[] };
/** The layout the engine measured, in density-independent points (`rectOf`). */
export type Measured = { width: number; height: number };
export type LayoutVerdict = { passed: boolean; detail: string };

/** The pixel size at the end of a `views` line: `  ClassName 714x188 clip=none`. */
const sizeOfLine = /(\d+)x(\d+)\s*(?:clip=\w+)?\s*$/;

/** The first of the inspector's [views] lines that names the class [inside] (the simple name, which a Swift generic spells with its arguments: `HostingView<A, B>`), with its size in pixels. */
export function viewInside(views: readonly string[], inside: string): { width: number; height: number } | null {
  const line = views.find((entry) => entry.trim().startsWith(`${inside} `));
  const size = line ? sizeOfLine.exec(line) : null;
  return size ? { width: Number(size[1]), height: Number(size[2]) } : null;
}

/**
 * The check. [info] is what the platform built for the inspected handle, [inside] the class of the pinned view below it (undefined: the library's view is the handle's own),
 * [own] that the inspected handle is the one that was measured (its own view is then the library's even when the pinned view is not found); otherwise it is a box around the
 * measured one and only the pinned view can be compared. The sizes agree within [tolerance] points.
 */
export function compareLayout(info: Inspected, inside: string | undefined, own: boolean, measured: Measured | null, tolerance = 1): LayoutVerdict {
  const wanted = measured ? `${measured.width.toFixed(1)}x${measured.height.toFixed(1)}` : "none";
  const view = (inside === undefined ? null : viewInside(info.views, inside)) ?? (own ? info : null);
  if (!view) return { passed: false, detail: `no native view to size: ${info.class} is a box around the measured view${inside === undefined ? "" : `, and ${inside} is not below it`}; measured ${wanted}` };
  const width = view.width / info.density;
  const height = view.height / info.density;
  const passed = !!measured && Math.abs(width - measured.width) <= tolerance && Math.abs(height - measured.height) <= tolerance;
  return { passed, detail: `native ${width.toFixed(1)}x${height.toFixed(1)} dp, measured ${wanted}` };
}
