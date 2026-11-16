/**
 * esbuild stubs for the modules of react-native-svg that `src/fabric/svg-library.js` re-exports, for the bundles that import the main entry (which exports the SVG
 * components) and mount none of them: each name exists, so the bundle links, and none of them does any work.
 */
const none = "export default () => ({}); ";
export const svgLibraryStubs: Record<string, string> = {
  "react-native-svg/src/lib/extract/extractProps": `${none}export const extract = () => ({}); export const propsAndStyles = () => ({}); export const withoutXY = () => ({});`,
  "react-native-svg/src/lib/extract/extractResponder": none,
  "react-native-svg/src/lib/extract/extractTransform": `${none}export const extractTransformSvgView = () => null;`,
  "react-native-svg/src/lib/extract/extractViewBox": `${none}export const alignEnum = {}; export const meetOrSliceTypes = {};`,
  "react-native-svg/src/lib/extract/extractOpacity": none,
  "react-native-svg/src/lib/extract/extractBrush": none,
  "react-native-svg/src/lib/extract/extractLengthList": none,
  "react-native-svg/src/lib/extract/extractPolyPoints": none,
  "react-native-svg/src/lib/units": "export default {};",
  "react-native-svg/src/lib/maskType": "export const maskType = {};",
  "react-native-svg/src/lib/util": "export const idPattern = /./; export const pickNotNil = (object) => object;",
};
