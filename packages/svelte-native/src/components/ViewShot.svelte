<script lang="ts">
  import { forwardRef } from "./forward-ref.ts";
  import { onMount, untrack, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { captureRef, releaseCapture, type CaptureOptions } from "../fabric/foreign-capture.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The container of `react-native-view-shot` (`ViewShot`) as a Svelte component: a `View` (with `collapsable={false}`, so Fabric keeps
   * a native view for it) whose `ref` handle has `capture()`, which draws it with `captureRef` once the view has been laid out and
   * answers where the image is (`options.result`: a file by default). `captureMode="mount"` captures once at mount,
   * `"continuous"` after every frame (experimental, for a `tmpfile` result: the previous file is released); `onCapture(uri)` and
   * `onCaptureFailure(error)` hear every capture. Not ported: `captureMode="update"` (it follows React's re-renders, which Svelte
   * has no counterpart of: call `capture()`). On Android the engine draws its own views itself (see `fabric/foreign-capture.ts`).
   */
  let { options, captureMode, onCapture, onCaptureFailure, onLayout, style, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    options?: CaptureOptions;
    captureMode?: "mount" | "continuous";
    onCapture?: (uri: string) => void;
    onCaptureFailure?: (error: Error) => void;
    children?: Snippet;
    /** Receives `capture()` and the host handle (`host`), or null on unmount. */
    ref?: (handle: { capture(): Promise<string>; host: { tag: number } } | null) => void;
  } = $props();

  let host: { tag: number } | null = null;
  let last: string | null = null;
  let laid: () => void = () => {};
  const firstLayout = new Promise<void>((resolve) => { laid = resolve; });
  const never = new Promise<never>(() => {});

  /** Waits for the first layout, draws the view and tells the callbacks; a capture that outlives the view never settles. */
  function capture(): Promise<string> {
    return firstLayout
      .then(() => (host ? captureRef(host, untrack(() => options)) : never))
      .then(
        (uri) => {
          if (!host) return uri;
          if (last) setTimeout(releaseCapture, 500, last);
          last = uri;
          untrack(() => onCapture)?.(uri);
          return uri;
        },
        (error: unknown) => {
          if (!host) throw error;
          untrack(() => onCaptureFailure)?.(error as Error);
          throw error;
        },
      );
  }

  const hostRef = $derived(forwardRef(ref, (given: { tag: number }) => ({ capture, host: given }), (given) => { host = given; }));
  const layout = (event: unknown) => { laid(); (onLayout as ((event: unknown) => void) | undefined)?.(event); };

  onMount(() => {
    if (captureMode === "mount") capture().catch(() => undefined);
    let frame = 0;
    let previous: string | null = "-";
    if (captureMode === "continuous") {
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (previous === last) return;
        previous = last;
        capture().catch(() => undefined);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(frame);
  });
</script>
<View {...attributes} collapsable={false} onLayout={layout} {style} ref={hostRef}>{@render children?.()}</View>
