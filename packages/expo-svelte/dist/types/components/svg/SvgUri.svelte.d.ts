import type { Snippet } from "svelte";
import type { SvgProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<SvgProps, "children"> & {
    uri: string | null;
    onLoad?: () => void;
    onError?: (error: Error) => void;
    fallback?: Snippet;
};
declare const SvgUri: import("svelte").Component<$$ComponentProps, {}, "">;
type SvgUri = ReturnType<typeof SvgUri>;
export default SvgUri;
