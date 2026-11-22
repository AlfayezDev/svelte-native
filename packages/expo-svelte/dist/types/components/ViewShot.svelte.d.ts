import { type Snippet } from "svelte";
import { type CaptureOptions } from "../fabric/foreign-capture.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    options?: CaptureOptions;
    captureMode?: "mount" | "continuous";
    onCapture?: (uri: string) => void;
    onCaptureFailure?: (error: Error) => void;
    children?: Snippet;
    /** Receives `capture()` and the host handle (`host`), or null on unmount. */
    ref?: (handle: {
        capture(): Promise<string>;
        host: {
            tag: number;
        };
    } | null) => void;
};
declare const ViewShot: import("svelte").Component<$$ComponentProps, {}, "">;
type ViewShot = ReturnType<typeof ViewShot>;
export default ViewShot;
