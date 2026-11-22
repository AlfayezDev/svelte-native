// The React-free modules of react-native-svg's `src/lib` that `foreign-svg.ts` and `foreign-svg-extract.ts` use (SPEC.md, "react-native-svg"). Metro resolves
// the library's own `react-native` import to the lite shim (`LITE_ORIGINS` in `metro.ts`), so these deep paths load without React.
// Kept as plain JavaScript beside a hand-written `.d.ts` so the type checker never compiles the library's TypeScript source (it is written for React
// and does not pass this package's compiler options).
export { default as extractProps, extract, propsAndStyles, withoutXY } from "react-native-svg/src/lib/extract/extractProps";
export { default as extractResponder } from "react-native-svg/src/lib/extract/extractResponder";
export { default as extractTransform, extractTransformSvgView } from "react-native-svg/src/lib/extract/extractTransform";
export { default as extractViewBox, alignEnum, meetOrSliceTypes } from "react-native-svg/src/lib/extract/extractViewBox";
export { default as extractOpacity } from "react-native-svg/src/lib/extract/extractOpacity";
export { default as extractBrush } from "react-native-svg/src/lib/extract/extractBrush";
export { default as extractLengthList } from "react-native-svg/src/lib/extract/extractLengthList";
export { default as extractPolyPoints } from "react-native-svg/src/lib/extract/extractPolyPoints";
export { default as units } from "react-native-svg/src/lib/units";
export { maskType } from "react-native-svg/src/lib/maskType";
export { idPattern, pickNotNil } from "react-native-svg/src/lib/util";
