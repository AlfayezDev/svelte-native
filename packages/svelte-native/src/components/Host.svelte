<script lang="ts">
  import { setContext, untrack, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { IN_STACK_CONTEXT } from "../fabric/navigation.ts";
  /**
   * A host element whose tag is chosen at runtime; the host throws on a name it does not map.
   * It is a `<svelte:element>`, and while Svelte renders one the children that render with it (the first render of its children) hand their `animate:` to the effect around it
   * (`animation_effect_override`, `internal/client/dom/blocks/svelte-element.js`, which is meant for an `animate:` on the element itself): an `animate:flip` in a keyed each that renders
   * in `children` never measures and never plays, until its items are made again. Whatever the library renders itself is written with the element (the router's and a screen's `native-stack`).
   */
  let { name, attributes = {}, children }: {
    name: string;
    attributes?: object;
    children?: Snippet;
  } & ClassProps = $props();
  // The screens inside a stack are its own: they need no stack of their own (see `Screen`).
  if (untrack(() => name) === "native-stack") setContext(IN_STACK_CONTEXT, true);
  const resolveProps = createNativeProps();
  const nativeProps = $derived(resolveProps(attributes));
</script>

<svelte:element this={name} {nativeProps}>{@render children?.()}</svelte:element>
