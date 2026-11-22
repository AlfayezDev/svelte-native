type NumberProp = string | number;
type Props = Record<string, unknown>;
/** `extractFont` of `extractText.tsx`: the font props of an element as the one `font` object the native text views take. */
export declare function extractFont(props: Props): Props;
/**
 * `extractText` of `extractText.tsx` without the children: the text props the native text views take. `content` is null here; the
 * host fills it for a `TSpan` whose only child is a string (the library does the same with `String(children)`).
 */
export declare function extractText(props: Props): Props;
/** What a `Stop` hands its gradient: its props, `style` included (the XML parser puts `stop-color` and `offset` there). */
export type StopProps = {
    offset?: NumberProp;
    stopColor?: unknown;
    stopOpacity?: NumberProp;
    style?: Props;
};
/** `extractGradient` of `extractGradient.ts`, with the stops in place of the React children; `null` without an `id`, as there. */
export declare function extractGradient(props: Props, stops: readonly StopProps[]): Props | null;
export declare const extractFilter: (props: Props) => Props;
export declare const extractIn: (props: Props) => Props;
export declare const extractFeBlend: (props: Props) => Props;
export declare const extractFeColorMatrix: (props: Props) => Props;
export declare const extractFeComposite: (props: Props) => Props;
export declare function extractFeFlood(props: Props): Props;
export declare const extractFeGaussianBlur: (props: Props) => Props;
/** `extractFeMerge`: the `in` of each `FeMergeNode`, in order. */
export declare const extractFeMerge: (ins: readonly (string | undefined)[]) => Props;
export {};
