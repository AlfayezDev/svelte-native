<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { fetchText } from "../../fabric/foreign-svg-xml.ts";
  import SvgXml from "./SvgXml.svelte";
  import type { SvgProps } from "#vendor/react-native-svg";

  /**
   * `react-native-svg`'s `SvgUri`: fetches the document at `uri` (a network or file URI, or an SVG data URI) and draws it as `SvgXml` does. `onLoad` when it
   * arrived, `onError` (default `console.error`) when it did not, and `fallback` shows then. A new `uri` fetches again.
   */
  let { uri, onLoad, onError = (error: Error) => console.error(error), fallback, ...props }: Omit<SvgProps, "children"> & {
    uri: string | null;
    onLoad?: () => void;
    onError?: (error: Error) => void;
    fallback?: Snippet;
  } = $props();
  let xml = $state<string | null>(null);
  let failed = $state(false);
  $effect(() => {
    const current = uri;
    let cancelled = false;
    if (!current) {
      xml = null;
      return;
    }
    fetchText(current).then((data) => {
      if (cancelled) return;
      xml = data;
      failed = false;
      onLoad?.();
    }, (error: Error) => {
      if (cancelled) return;
      onError(error);
      failed = true;
    });
    return () => { cancelled = true; };
  });
</script>
{#if failed}{@render fallback?.()}{:else}<SvgXml {xml} {...props} {fallback} />{/if}
