<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { LatLng } from "../fabric/foreign.ts";
  import type { ViewProps } from "react-native";

  type Event<Native = Record<string, unknown>> = { nativeEvent: Native };
  /** A marker of a `MapView` (react-native-maps, `RNMapsMarker`); its children are the marker's custom view. */
  let { children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle; its `dispatchCommand` takes `showCallout`, `hideCallout`, `redraw`, `animateToCoordinates`. */
    ref?: (handle: unknown) => void;
    coordinate: LatLng;
    title?: string;
    description?: string;
    identifier?: string;
    pinColor?: string;
    draggable?: boolean;
    onPress?: (event: Event) => void;
    onSelect?: (event: Event) => void;
    onDeselect?: (event: Event) => void;
    [prop: string]: unknown;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-foreign component="RNMapsMarker" nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-foreign>
