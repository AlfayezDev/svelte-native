<script lang="ts" module>
  import type { Component } from "svelte";
  import { warnUnimplementedFilter } from "../../fabric/foreign-svg.ts";
  import Circle from "./Circle.svelte";
  import ClipPath from "./ClipPath.svelte";
  import Defs from "./Defs.svelte";
  import Ellipse from "./Ellipse.svelte";
  import FeBlend from "./FeBlend.svelte";
  import FeColorMatrix from "./FeColorMatrix.svelte";
  import FeComposite from "./FeComposite.svelte";
  import FeDropShadow from "./FeDropShadow.svelte";
  import FeFlood from "./FeFlood.svelte";
  import FeGaussianBlur from "./FeGaussianBlur.svelte";
  import FeMerge from "./FeMerge.svelte";
  import FeMergeNode from "./FeMergeNode.svelte";
  import FeOffset from "./FeOffset.svelte";
  import Filter from "./Filter.svelte";
  import ForeignObject from "./ForeignObject.svelte";
  import G from "./G.svelte";
  import Image from "./Image.svelte";
  import Line from "./Line.svelte";
  import LinearGradient from "./LinearGradient.svelte";
  import Marker from "./Marker.svelte";
  import Mask from "./Mask.svelte";
  import Path from "./Path.svelte";
  import Pattern from "./Pattern.svelte";
  import Polygon from "./Polygon.svelte";
  import Polyline from "./Polyline.svelte";
  import RadialGradient from "./RadialGradient.svelte";
  import Rect from "./Rect.svelte";
  import Stop from "./Stop.svelte";
  import Svg from "./Svg.svelte";
  import Symbol from "./Symbol.svelte";
  import Text from "./Text.svelte";
  import TextPath from "./TextPath.svelte";
  import TSpan from "./TSpan.svelte";
  import Use from "./Use.svelte";

  /** `xmlTags.ts`: the element names the parser knows and the component of each. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const tags: Record<string, Component<any>> = {
    circle: Circle, clipPath: ClipPath, defs: Defs, ellipse: Ellipse, filter: Filter, feBlend: FeBlend, feColorMatrix: FeColorMatrix, feComposite: FeComposite,
    feDropShadow: FeDropShadow, feFlood: FeFlood, feGaussianBlur: FeGaussianBlur, feMerge: FeMerge, feMergeNode: FeMergeNode, feOffset: FeOffset,
    foreignObject: ForeignObject, g: G, image: Image, line: Line, linearGradient: LinearGradient, marker: Marker, mask: Mask, path: Path, pattern: Pattern,
    polygon: Polygon, polyline: Polyline, radialGradient: RadialGradient, rect: Rect, stop: Stop, svg: Svg, symbol: Symbol, text: Text, textPath: TextPath,
    tspan: TSpan, use: Use,
  };
  /** The filter elements the library parses and does not draw on a native platform (it warns once and renders nothing). */
  const unimplemented = new Set([
    "feComponentTransfer", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feImage", "feMorphology", "fePointLight",
    "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
  ]);
</script>
<script lang="ts">
  import Self from "./SvgNode.svelte";
  import type { SvgNode as ParsedNode } from "../../fabric/foreign-svg-xml.ts";

  /** One element of a parsed document and, below it, its children: elements of the library or text. A tag the library does not know draws nothing, with its children. */
  interface Props { node: ParsedNode }
  let { node }: Props = $props();
  const Tag = $derived(tags[node.tag]);
  $effect.pre(() => { if (!Tag && unimplemented.has(node.tag)) warnUnimplementedFilter(); });
  const attributes: Record<string, unknown> = $derived.by(() => { const rest: Record<string, unknown> = { ...node.props }; delete rest.class; return rest; });
</script>
{#if Tag}<Tag {...attributes} {...(node.tag === "tspan" || node.tag === "textPath" ? { childrenAsArray: true } : {})}>{#each node.children as child, index (index)}{#if typeof child === "string"}{child}{:else}<Self node={child} />{/if}{/each}</Tag>{/if}
