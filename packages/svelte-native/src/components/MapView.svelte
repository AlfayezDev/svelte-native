<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { mapHandle, type Commandable, type MapHandle, type LatLng, type Region } from "../fabric/foreign.ts";
  import type { ViewProps } from "react-native";

  type Event<Native = Record<string, unknown>> = { nativeEvent: Native };
  /**
   * The native map (react-native-maps, `RNMapsMapView`) as a Svelte component. The props are the native view's own
   * (`NativeComponentMapView`), the children are `Marker`s (or any other component of the library, by `ForeignView`).
   * The map draws tiles only with a Google Maps API key in the manifest (`GOOGLE_MAPS_API_KEY` in `app.config.ts`).
   *
   * The children mount once the map reports `onMapReady`, as react-native-maps' own component does: the native map adds a
   * marker to the layers it creates when its Google map is ready, and a marker that arrives earlier makes it throw.
   */
  let { children, ref, onMapReady, onPanDrag, ...attributes }: Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the commands (`animateToRegion`, `fitToCoordinates`, ...) or null on unmount. */
    ref?: (handle: (MapHandle & { host: unknown }) | null) => void;
    region?: Region;
    initialRegion?: Region;
    onMapReady?: (event: Event) => void;
    /** A finger moves on the map (react-native-maps' `onPanDrag`: the native view sends it only when asked to, which a handler does). */
    onPanDrag?: (event: Event) => void;
    onPress?: (event: Event<{ coordinate: LatLng; position: { x: number; y: number } }>) => void;
    onRegionChange?: (event: Event) => void;
    onRegionChangeComplete?: (event: Event) => void;
    onMarkerPress?: (event: Event) => void;
    [prop: string]: unknown;
  } = $props();
  const resolveProps = createNativeProps();
  let ready = $state(false);
  const mapReady = (event: Event) => { ready = true; onMapReady?.(event); };
  const hostRef = (handle: unknown) => {
    const host = handle as Commandable | null;
    ref?.(host ? { ...mapHandle(host), host } : null);
  };
</script>
<native-foreign component="RNMapsMapView" nativeProps={resolveProps({ ...attributes, onMapReady: mapReady, onPanDrag, handlePanDrag: onPanDrag !== undefined, ref: hostRef })}>{#if ready}{@render children?.()}{/if}</native-foreign>
