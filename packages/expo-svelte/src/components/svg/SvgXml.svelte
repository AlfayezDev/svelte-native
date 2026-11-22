<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { parse } from "../../fabric/foreign-svg-xml.ts";
  import Svg from "./Svg.svelte";
  import SvgNode from "./SvgNode.svelte";
  import type { SvgProps } from "#vendor/react-native-svg";

  /**
   * `react-native-svg`'s `SvgXml`: draws an SVG document given as a string. It is parsed with the library's own parser (`parse`) and drawn with these
   * components; the props are `Svg`'s (`width`, `height`, `color`, `style`, ...) and override the root element's. A document that does not parse
   * calls `onError` (default `console.error`) and shows `fallback`.
   */
  let { xml, onError = (error: Error) => console.error(error), fallback, override, ...props }: Omit<SvgProps, "children"> & {
    xml: string | null;
    onError?: (error: Error) => void;
    fallback?: Snippet;
    /** The props that replace the root element's own; the props of the component itself when not given. */
    override?: Omit<SvgProps, "children">;
  } = $props();
  const parsed = $derived.by(() => {
    try {
      return { root: xml !== null && xml !== undefined ? parse(xml) : null, error: null };
    } catch (error) {
      return { root: null, error: error as Error };
    }
  });
  $effect(() => { if (parsed.error) onError(parsed.error); });
</script>
{#if parsed.error}{@render fallback?.()}{:else if parsed.root}<Svg {...parsed.root.props} {...(override ?? props)}>{#each parsed.root.children as child, index (index)}{#if typeof child === "string"}{child}{:else}<SvgNode node={child} />{/if}{/each}</Svg>{/if}
