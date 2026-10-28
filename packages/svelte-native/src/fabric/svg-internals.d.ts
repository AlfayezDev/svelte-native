// The React-free modules of react-native-svg's `src/lib` that `foreign-svg.ts` imports by deep path (SPEC.md, "react-native-svg").
// Declared here only as far as the port uses them: the library's own sources are TypeScript for React and are not type-checked with the package.
// `Record<string, unknown>` stands for a props object, the second argument of the extractors for the instance whose Touchable handlers `extractResponder` reads.

declare module "react-native-svg/src/lib/extract/extractProps" {
  export default function extractProps(props: Record<string, unknown>, ref: Record<string, unknown>): Record<string, unknown>;
  export function extract(instance: Record<string, unknown>, props: Record<string, unknown>): Record<string, unknown>;
  export function withoutXY(instance: Record<string, unknown>, props: Record<string, unknown>): Record<string, unknown>;
  export function propsAndStyles(props: Record<string, unknown>): Record<string, unknown>;
}
declare module "react-native-svg/src/lib/extract/extractResponder" {
  export default function extractResponder(o: Record<string, unknown>, props: Record<string, unknown>, ref: Record<string, unknown>): void;
}
declare module "react-native-svg/src/lib/extract/extractTransform" {
  export default function extractTransform(props: unknown): number[] | null;
  export function extractTransformSvgView(props: Record<string, unknown>): unknown;
}
declare module "react-native-svg/src/lib/extract/extractViewBox" {
  export default function extractViewBox(props: { viewBox?: string | (string | number)[]; preserveAspectRatio?: string }): { minX: number; minY: number; vbWidth: number; vbHeight: number; align: string; meetOrSlice: number } | null;
  export const alignEnum: Record<string, string>;
  export const meetOrSliceTypes: Record<string, number>;
}
declare module "react-native-svg/src/lib/extract/extractOpacity" {
  export default function extractOpacity(opacity: string | number | void): number;
}
declare module "react-native-svg/src/lib/extract/extractBrush" {
  export default function extractBrush(color: unknown): { type: number; payload?: unknown; brushRef?: string } | null;
}
declare module "react-native-svg/src/lib/extract/extractLengthList" {
  export default function extractLengthList(lengthList?: readonly (string | number)[] | string | number): readonly (string | number)[];
}
declare module "react-native-svg/src/lib/extract/extractPolyPoints" {
  export default function extractPolyPoints(points: string | readonly (string | number)[]): string;
}
declare module "react-native-svg/src/lib/units" {
  const units: { objectBoundingBox: number; userSpaceOnUse: number };
  export default units;
}
declare module "react-native-svg/src/lib/maskType" {
  export const maskType: { readonly luminance: 0; readonly alpha: 1 };
}
declare module "react-native-svg/src/lib/util" {
  export function pickNotNil(object: Record<string, unknown>): Record<string, unknown>;
  export const idPattern: RegExp;
}
