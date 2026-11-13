/**
 * react-native-svg on the Svelte host (SPEC.md, "react-native-svg"): the library's elements as Svelte components, mounted through React Native's
 * own mounting. The main entry re-exports all of them (`@alfayez/svelte-native`). The library's React components are not used.
 *
 * Four elements take another name than react-native-svg's, because the main entry (or `/foreign`) has a component of that name: `SvgText` and `SvgImage` (the views `Text`
 * and `Image`), `SvgLinearGradient` and `SvgMarker` (`/foreign`'s expo-linear-gradient and maps `LinearGradient` and `Marker`).
 */
export { default as Svg } from "./components/svg/Svg.svelte";
export { default as G } from "./components/svg/G.svelte";
export { default as Path } from "./components/svg/Path.svelte";
export { default as Rect } from "./components/svg/Rect.svelte";
export { default as Circle } from "./components/svg/Circle.svelte";
export { default as Ellipse } from "./components/svg/Ellipse.svelte";
export { default as Line } from "./components/svg/Line.svelte";
export { default as Polygon } from "./components/svg/Polygon.svelte";
export { default as Polyline } from "./components/svg/Polyline.svelte";
export { default as SvgText } from "./components/svg/Text.svelte";
export { default as TSpan } from "./components/svg/TSpan.svelte";
export { default as TextPath } from "./components/svg/TextPath.svelte";
export { default as Use } from "./components/svg/Use.svelte";
export { default as SvgImage } from "./components/svg/Image.svelte";
export { default as Defs } from "./components/svg/Defs.svelte";
export { default as ClipPath } from "./components/svg/ClipPath.svelte";
export { default as SvgLinearGradient } from "./components/svg/LinearGradient.svelte";
export { default as RadialGradient } from "./components/svg/RadialGradient.svelte";
export { default as Stop } from "./components/svg/Stop.svelte";
export { default as Pattern } from "./components/svg/Pattern.svelte";
export { default as Mask } from "./components/svg/Mask.svelte";
export { default as SvgMarker } from "./components/svg/Marker.svelte";
export { default as Symbol } from "./components/svg/Symbol.svelte";
export { default as ForeignObject } from "./components/svg/ForeignObject.svelte";
export { default as Filter } from "./components/svg/Filter.svelte";
export { default as FeBlend } from "./components/svg/FeBlend.svelte";
export { default as FeColorMatrix } from "./components/svg/FeColorMatrix.svelte";
export { default as FeComposite } from "./components/svg/FeComposite.svelte";
export { default as FeDropShadow } from "./components/svg/FeDropShadow.svelte";
export { default as FeFlood } from "./components/svg/FeFlood.svelte";
export { default as FeGaussianBlur } from "./components/svg/FeGaussianBlur.svelte";
export { default as FeMerge } from "./components/svg/FeMerge.svelte";
export { default as FeMergeNode } from "./components/svg/FeMergeNode.svelte";
export { default as FeOffset } from "./components/svg/FeOffset.svelte";
export { default as SvgXml } from "./components/svg/SvgXml.svelte";
export { default as SvgUri } from "./components/svg/SvgUri.svelte";
export type { SvgHandle, SvgRootHandle, SvgBoundingBoxOptions, SvgMatrix, SvgPoint, SvgRect } from "./fabric/foreign-svg.js";
export type { SvgRef, SvgExtras } from "./components/svg/handle.js";
