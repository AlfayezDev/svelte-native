import type { Snippet } from "svelte";
import type { SvgProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<SvgProps, "children"> & {
    xml: string | null;
    onError?: (error: Error) => void;
    fallback?: Snippet;
    /** The props that replace the root element's own; the props of the component itself when not given. */
    override?: Omit<SvgProps, "children">;
};
declare const SvgXml: import("svelte").Component<$$ComponentProps, {}, "">;
type SvgXml = ReturnType<typeof SvgXml>;
export default SvgXml;
