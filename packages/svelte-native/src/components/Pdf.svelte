<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform, resolveAssetSource } from "../fabric/deps-rn.ts";
  import type { Commandable } from "../fabric/foreign.ts";
  import { openPdf, parsePdfMessage, pdfHandle, type PdfFile, type PdfHandle, type PdfSource } from "../fabric/foreign-pdf.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The native PDF view of `react-native-pdf` 7 (`RNPDFPdfView`: Android's AndroidPdfViewer, iOS's PDFKit) as a Svelte component,
   * with that package's props: `source` (a `require`d asset, `{ uri, headers, method, body, cache, cacheFileName, expiration }`
   * for an `http(s)` URL, a `bundle-assets://` file, a `data:application/pdf;base64,` URI or a file path, loaded through
   * `react-native-blob-util` as the library does), `page` (from 1), `scale`, `minScale`, `maxScale`, `horizontal`, `enablePaging`,
   * `fitPolicy` (0 width, 1 height, 2 both), `spacing`, `password`, `enableRTL`, `enableAnnotationRendering`,
   * `enableAntialiasing`, `scrollEnabled`, `singlePage`, `trustAllCerts`; and the callbacks `onLoadComplete(pages, path, size,
   * tableContents)`, `onPageChanged(page, pages)`, `onError(error)`, `onPressLink(url)`, `onPageSingleTap(page, x, y)` and
   * `onScaleChanged(scale)`. `ref` receives `setPage(page)`. `loading` is shown until the file is local.
   * Not ported: the download progress (`onLoadProgress`, `renderActivityIndicator`), `usePDFKit={false}` (the JavaScript page
   * renderers of iOS), the Windows view.
   */
  let {
    source, page = 1, scale = 1, minScale = 1, maxScale = 3, horizontal = false, enablePaging = false, fitPolicy = 2, spacing = 10, password = "",
    enableRTL = false, enableAnnotationRendering = true, enableAntialiasing = true, showsHorizontalScrollIndicator = true,
    showsVerticalScrollIndicator = true, scrollEnabled = true, singlePage = false, trustAllCerts = true,
    onLoadComplete, onPageChanged, onError, onPressLink, onPageSingleTap, onScaleChanged, loading, style, ref, ...attributes
  }: Omit<ViewProps, "children"> & {
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
    onLoadComplete?: (pages: number, path: string, size: { width: number; height: number }, tableContents: unknown) => void;
    onPageChanged?: (page: number, pages: number) => void;
    onError?: (error: Error) => void;
    onPressLink?: (url: string) => void;
    onPageSingleTap?: (page: number, x: number, y: number) => void;
    onScaleChanged?: (scale: number) => void;
    /** Shown while the document is downloaded or copied. */
    loading?: Snippet;
    /** Receives `setPage(page)` (`host` is the view's handle), or null on unmount. */
    ref?: (handle: (PdfHandle & { host: unknown }) | null) => void;
    [prop: string]: unknown;
  } = $props();
  const resolveProps = createNativeProps();
  const android = Platform.OS === "android";
  const asset = (number: number) => resolveAssetSource(number as never) as { uri?: string } | null;
  // The library reloads when the resolved URI changes, not when another field of the source does.
  const uri = $derived(((typeof source === "number" ? asset(source) : source) ?? {}).uri);
  let path: string | null = $state(null);

  $effect(() => {
    void uri;
    const current = untrack(() => source);
    path = null;
    let live = true;
    let opened: PdfFile;
    try {
      opened = openPdf(current, { resolveAsset: asset, trustAllCerts: untrack(() => trustAllCerts) });
    } catch (error) {
      // react-native-blob-util is not linked: the library's component fails the same way, through `onError`.
      untrack(() => onError)?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    opened.path.then(
      (local) => { if (live) path = local; },
      (error: unknown) => { if (live) untrack(() => onError)?.(error instanceof Error ? error : new Error(String(error))); },
    );
    return () => { live = false; opened.cancel(); };
  });

  const onChange = (event: { nativeEvent: { message?: string | null } }) => {
    const message = parsePdfMessage(event.nativeEvent.message);
    if (!message) return;
    if (message.type === "loadComplete") onLoadComplete?.(message.pages, path ?? "", message.size, message.tableContents);
    else if (message.type === "pageChanged") onPageChanged?.(message.page, message.pages);
    else if (message.type === "error") onError?.(message.error);
    else if (message.type === "pageSingleTap") onPageSingleTap?.(message.page, message.x, message.y);
    else if (message.type === "scaleChanged") onScaleChanged?.(message.scale);
    else onPressLink?.(message.url);
  };
  const hostRef = (handle: unknown) => {
    const host = handle as Commandable | null;
    ref?.(host ? { ...pdfHandle(host), host } : null);
  };
  const nativeStyle = $derived([android ? { flex: 1, backgroundColor: "#EEE" } : { backgroundColor: "#EEE", overflow: "hidden" }, style]);
</script>
<View style={[style, { overflow: "hidden" }]}>
  {#if path === null}
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>{@render loading?.()}</View>
  {:else}
    <native-foreign component="RNPDFPdfView" nativeProps={resolveProps({
      ...attributes, page, scale, minScale, maxScale, horizontal, enablePaging, fitPolicy, spacing, password, enableRTL, enableAnnotationRendering,
      enableAntialiasing, showsHorizontalScrollIndicator, showsVerticalScrollIndicator, scrollEnabled, singlePage,
      path, style: nativeStyle, onChange, ref: hostRef,
    })}></native-foreign>
  {/if}
</View>
