import { type Snippet } from "svelte";
import { type ClassProps } from "../classes.js";
import { type PdfHandle, type PdfSource } from "../fabric/foreign-pdf.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    source: PdfSource;
    page?: number;
    scale?: number;
    minScale?: number;
    maxScale?: number;
    horizontal?: boolean;
    enablePaging?: boolean;
    fitPolicy?: 0 | 1 | 2;
    spacing?: number;
    password?: string;
    enableRTL?: boolean;
    enableAnnotationRendering?: boolean;
    enableAntialiasing?: boolean;
    enableDoubleTapZoom?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
    scrollEnabled?: boolean;
    singlePage?: boolean;
    trustAllCerts?: boolean;
    onLoadComplete?: (pages: number, path: string, size: {
        width: number;
        height: number;
    }, tableContents: unknown) => void;
    onPageChanged?: (page: number, pages: number) => void;
    onError?: (error: Error) => void;
    onPressLink?: (url: string) => void;
    onPageSingleTap?: (page: number, x: number, y: number) => void;
    onScaleChanged?: (scale: number) => void;
    /** Shown while the document is downloaded or copied. */
    loading?: Snippet;
    /** Receives `setPage(page)` (`host` is the view's handle), or null on unmount. */
    ref?: (handle: (PdfHandle & {
        host: unknown;
    }) | null) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const Pdf: import("svelte").Component<$$ComponentProps, {}, "">;
type Pdf = ReturnType<typeof Pdf>;
export default Pdf;
