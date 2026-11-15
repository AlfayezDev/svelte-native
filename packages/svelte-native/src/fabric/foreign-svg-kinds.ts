/**
 * The view configs of react-native-svg's Fabric components, registered when this module loads (SPEC.md, "react-native-svg"): the props of each codegen
 * spec (`src/fabric/*NativeComponent.ts`) and the events its emitter sends, on top of a view's own attributes. `tests/foreign/svg/configs.test.ts` compares every
 * table with the config React Native generates from the spec, on both platforms. A module of its own, with no import of the library, so that the test
 * can load it next to React Native's registry.
 */
import { defineViewKind, type Kind } from "./view-configs.ts";

const nodeProps = "name opacity matrix mask markerStart markerMid markerEnd clipPath clipRule responsible display pointerEvents";
const renderableProps = "fill fillOpacity fillRule stroke strokeOpacity strokeWidth strokeLinecap strokeLinejoin strokeDasharray strokeDashoffset strokeMiterlimit vectorEffect propList filter";
const groupProps = "fontSize fontWeight font";
const textProps = "dx dy x y rotate inlineSize textLength baselineShift lengthAdjust alignmentBaseline verticalAlign";
const viewBoxProps = "minX minY vbWidth vbHeight align meetOrSlice";
const shape = `${nodeProps} ${renderableProps}`;
const primitive = "x y width height result";
const layoutEvent = "topSvgLayout";

export const svgKinds: Record<string, Kind> = {
  RNSVGSvgView: { plain: `bbWidth bbHeight ${viewBoxProps} pointerEvents`, colors: "color" },
  RNSVGSvgViewAndroid: { plain: `bbWidth bbHeight ${viewBoxProps} pointerEvents`, colors: "color" },
  RNSVGGroup: { plain: `${shape} ${groupProps}`, colors: "color", events: layoutEvent },
  RNSVGPath: { plain: `${shape} d`, colors: "color", events: layoutEvent },
  RNSVGRect: { plain: `${shape} x y height width rx ry`, colors: "color", events: layoutEvent },
  RNSVGCircle: { plain: `${shape} cx cy r`, colors: "color", events: layoutEvent },
  RNSVGEllipse: { plain: `${shape} cx cy rx ry`, colors: "color", events: layoutEvent },
  RNSVGLine: { plain: `${shape} x1 y1 x2 y2`, colors: "color", events: layoutEvent },
  RNSVGText: { plain: `${shape} ${groupProps} ${textProps}`, colors: "color", events: layoutEvent },
  RNSVGTSpan: { plain: `${shape} ${groupProps} ${textProps} content`, colors: "color", events: layoutEvent },
  RNSVGTextPath: { plain: `${shape} ${groupProps} ${textProps} href side method midLine spacing startOffset`, colors: "color", events: layoutEvent },
  RNSVGUse: { plain: `${shape} href x y height width`, colors: "color", events: layoutEvent },
  RNSVGImage: { plain: `${shape} x y width height align meetOrSlice`, colors: "color", assetSources: "src", events: `${layoutEvent} topLoad` },
  RNSVGDefs: { plain: nodeProps },
  RNSVGClipPath: { plain: `${shape} ${groupProps}`, colors: "color", events: layoutEvent },
  RNSVGLinearGradient: { plain: `${nodeProps} x1 y1 x2 y2 gradient gradientUnits gradientTransform` },
  RNSVGRadialGradient: { plain: `${nodeProps} fx fy cx cy rx ry gradient gradientUnits gradientTransform` },
  RNSVGPattern: { plain: `${shape} ${groupProps} x y height width patternUnits patternContentUnits patternTransform ${viewBoxProps}`, colors: "color" },
  RNSVGMask: { plain: `${shape} ${groupProps} x y height width maskUnits maskContentUnits maskType`, colors: "color", events: layoutEvent },
  RNSVGMarker: { plain: `${shape} ${groupProps} refX refY markerHeight markerWidth markerUnits orient ${viewBoxProps}`, colors: "color" },
  RNSVGSymbol: { plain: `${shape} ${groupProps} ${viewBoxProps}`, colors: "color" },
  RNSVGForeignObject: { plain: `${shape} ${groupProps} x y height width`, colors: "color", events: layoutEvent },
  RNSVGFilter: { plain: "name x y height width filterUnits primitiveUnits" },
  RNSVGFeBlend: { plain: `${primitive} in1 in2 mode` },
  RNSVGFeColorMatrix: { plain: `${primitive} in1 type values` },
  RNSVGFeComposite: { plain: `${primitive} in1 in2 operator1 k1 k2 k3 k4` },
  RNSVGFeFlood: { plain: `${primitive} floodColor floodOpacity` },
  RNSVGFeGaussianBlur: { plain: `${primitive} in1 stdDeviationX stdDeviationY edgeMode` },
  RNSVGFeMerge: { plain: `${primitive} nodes` },
  RNSVGFeOffset: { plain: `${primitive} in1 dx dy` },
};
for (const [name, kind] of Object.entries(svgKinds)) defineViewKind(name, kind);

