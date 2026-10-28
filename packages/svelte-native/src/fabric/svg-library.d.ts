// Types of `svg-library.js`, as far as the port uses them. `Record<string, unknown>` stands for a props object; the last argument of `extractProps` and
// `extractResponder` for the instance whose Touchable handlers the library's code reads (the host's Pressability stands in for them).
type Props = Record<string, unknown>;
export function extractProps(props: Props, ref: Props): Props;
export function extract(instance: Props, props: Props): Props;
export function withoutXY(instance: Props, props: Props): Props;
export function propsAndStyles(props: Props): Props;
export function extractResponder(o: Props, props: Props, ref: Props): void;
export function extractTransform(props: unknown): number[] | null;
export function extractTransformSvgView(props: Props): unknown;
export function extractViewBox(props: { viewBox?: string | (string | number)[]; preserveAspectRatio?: string }): { minX: number; minY: number; vbWidth: number; vbHeight: number; align: string; meetOrSlice: number } | null;
export const alignEnum: Record<string, string>;
export const meetOrSliceTypes: Record<string, number>;
export function extractOpacity(opacity: string | number | void): number;
export function extractBrush(color: unknown): { type: number; payload?: unknown; brushRef?: string } | null;
export function extractLengthList(lengthList?: readonly (string | number)[] | string | number): readonly (string | number)[];
export function extractPolyPoints(points: string | readonly (string | number)[]): string;
export const units: { objectBoundingBox: number; userSpaceOnUse: number };
export const maskType: { readonly luminance: 0; readonly alpha: 1 };
export function pickNotNil(object: Props): Props;
export const idPattern: RegExp;
