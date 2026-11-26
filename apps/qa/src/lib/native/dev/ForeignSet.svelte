<script lang="ts" module>
  import type { MapHandle, WebViewHandle } from "expo-svelte/foreign";
  export type Kind = "web" | "map" | "video";
  export type Rect = { x: number; y: number; width: number; height: number };
  type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };
  /** What a set hands to whoever drives it: the commands of its views, the rectangles to tap, the video player. */
  export type SetHandles = {
    web: (WebViewHandle & { host: unknown }) | null;
    map: (MapHandle & { host: unknown }) | null;
    player: { play(): void; pause(): void; readonly status: string; readonly playing: boolean } | null;
    rect(kind: Kind | "control"): Promise<Rect | null>;
  };
</script>
<script lang="ts">
  import { onDestroy } from "svelte";
  import { Pressable, Text, View } from "expo-svelte";
  import { createVideoPlayer, MapView, Marker, VideoView, WebView } from "expo-svelte/foreign";
  import { theme } from "../state.svelte.ts";
  import { foreignHandles, labPage, labVideo, record } from "./foreign.svelte.ts";

  /**
   * The three foreign views (WebView, MapView with a Marker, VideoView) each in a fixed box, with a plain Pressable next
   * to them as the control the tap checks compare with. Every event is recorded under `source` (`record`), and the set's
   * commands are in `foreignHandles` under the same name while it is mounted.
   */
  let { source, version = "v1", height = 110, kinds = ["web", "map", "video"], markers = true, cards = false }: {
    source: string;
    version?: string;
    height?: number;
    kinds?: readonly Kind[];
    /** Whether the map carries its marker (the leak cycles run it both ways). */
    markers?: boolean;
    /** Each WebView and map sits in a `Pressable` card of its own (`web-card-press`, `map-card-press`): a view that takes touches itself must not press it (SPEC.md, "Foreign views"). */
    cards?: boolean;
  } = $props();
  const report = (event: string, detail?: unknown) => record(source, event, detail);

  let web: SetHandles["web"] = null;
  let map: SetHandles["map"] = null;
  let videoHost: Measurable | null = null;
  let controlHost: Measurable | null = null;
  // The set is mounted for one `source` and one list of kinds; a change of either is a different set.
  // svelte-ignore state_referenced_locally
  const player = kinds.includes("video") ? createVideoPlayer({ uri: labVideo }) : null;
  if (player) { player.loop = true; player.muted = true; player.play(); }
  // svelte-ignore state_referenced_locally
  const own = source;
  onDestroy(() => { foreignHandles.delete(own); player?.release(); });

  const rectOf = (host: Measurable | null) => new Promise<Rect | null>((resolve) => {
    if (!host) { resolve(null); return; }
    host.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
  const handles: SetHandles = {
    get web() { return web; },
    get map() { return map; },
    player: player ? { play: () => player.play(), pause: () => player.pause(), get status() { return player.status; }, get playing() { return player.playing; } } : null,
    rect: (kind) => rectOf(kind === "web" ? (web?.host as Measurable | undefined) ?? null : kind === "map" ? (map?.host as Measurable | undefined) ?? null : kind === "video" ? videoHost : controlHost),
  };
  // The handles are getters: a view's commands appear when the host calls its `ref`, which happens at its first commit.
  foreignHandles.set(own, handles);
</script>

{#snippet webBox()}
  <View style={{ height, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: theme.border }}>
    <WebView source={{ uri: labPage(version) }} ref={(handle) => { web = handle; }}
      onMessage={(event) => report("web-message", event.nativeEvent.data)}
      onLoadStart={() => report("web-load-start")}
      onLoadEnd={() => report("web-load-end")}
      onError={(event) => report("web-error", event.nativeEvent)} />
  </View>
{/snippet}
{#snippet mapBox()}
  <View style={{ height, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: theme.border }}>
    <MapView ref={(handle) => { map = handle; }} style={{ flex: 1 }}
      initialRegion={{ latitude: 24.7136, longitude: 46.6753, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
      onMapReady={() => report("map-ready")}
      onPanDrag={() => report("map-pan-drag")}
      onPress={(event) => report("map-press", event.nativeEvent)}
      onRegionChangeComplete={(event) => report("map-region", event.nativeEvent)}>
      {#if markers}<Marker coordinate={{ latitude: 24.7136, longitude: 46.6753 }} title="Riyadh" pinColor="#d33" onPress={() => report("marker-press")} />{/if}
    </MapView>
  </View>
{/snippet}

<View onTouchStart={() => report("js-touch")} style={{ gap: 12 }}>
  {#if kinds.includes("web")}
    {#if cards}<Pressable accessibilityLabel="Web card" onPress={() => report("web-card-press")}>{@render webBox()}</Pressable>{:else}{@render webBox()}{/if}
  {/if}
  {#if kinds.includes("map")}
    {#if cards}<Pressable accessibilityLabel="Map card" onPress={() => report("map-card-press")}>{@render mapBox()}</Pressable>{:else}{@render mapBox()}{/if}
  {/if}
  {#if kinds.includes("video")}
    <View style={{ height, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: theme.border }}>
      <VideoView {player} surfaceType="textureView" nativeControls={false} contentFit="cover" style={{ flex: 1 }} ref={(handle) => { videoHost = handle as Measurable | null; }}
        onFirstFrameRender={() => report("video-first-frame")} />
    </View>
  {/if}
  <View ref={(handle) => { controlHost = handle as Measurable | null; }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Foreign lab control" onPress={() => report("control-press")} style={{ minHeight: 40, borderRadius: 10, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: theme.foreground, fontSize: 14 }}>Control</Text>
    </Pressable>
  </View>
</View>
