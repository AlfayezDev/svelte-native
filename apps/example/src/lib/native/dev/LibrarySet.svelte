<script lang="ts" module>
  import type { LottieHandle, VideoHandle } from "@rasheed/svelte-native/foreign";
  export type LibraryKind = "image" | "blur" | "gradient" | "video" | "datetime" | "lottie";
  export const libraryKinds: readonly LibraryKind[] = ["image", "blur", "gradient", "video", "datetime", "lottie"];
  /** What a set hands to whoever drives it: the video's and the animation's functions, and the Android date dialog. */
  export type LibraryHandles = {
    video: (VideoHandle & { host: unknown }) | null;
    lottie: (LottieHandle & { host: unknown }) | null;
    pickDate(): Promise<Date | null>;
  };
  const titles: Record<LibraryKind, string> = {
    image: "expo-image", blur: "expo-blur", gradient: "expo-linear-gradient", video: "react-native-video", datetime: "datetimepicker", lottie: "lottie-react-native",
  };
</script>
<script lang="ts">
  import { onDestroy } from "svelte";
  import { Pressable, Text, View } from "@rasheed/svelte-native";
  import { BlurTargetView, BlurView, DateTimePicker, ExpoImage, LinearGradient, LottieView, Video, openDatePicker } from "@rasheed/svelte-native/foreign";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import labImage from "../../../../assets/native/lab/lab-image.png";
  import { theme } from "../state.svelte.ts";
  import { labVideo, libraryHandles, record } from "./foreign.svelte.ts";
  import { labLottie } from "./lab-lottie.ts";

  /**
   * One box per library (expo-image, expo-blur, expo-linear-gradient, react-native-video, datetimepicker, lottie-react-native),
   * each a fixed `height`, the way the foreign-views lab (SPEC.md, "Foreign views") mounts the older three: inline, in a list row
   * and in a sheet. Every event is recorded under `source` (`record`), and the video's, the animation's and the date dialog's
   * functions are in `libraryHandles` under the same name while the set is mounted.
   */
  let { source, kinds = libraryKinds, height = 96 }: { source: string; kinds?: readonly LibraryKind[]; height?: number } = $props();
  const report = (event: string, detail?: unknown) => record(source, event, detail);
  // svelte-ignore state_referenced_locally
  const own = source;

  let video: LibraryHandles["video"] = null;
  let lottie: LibraryHandles["lottie"] = null;
  let blurTarget: { tag: number } | null = $state(null);
  let picked = $state(new Date(Date.UTC(2026, 9, 28, 12, 0, 0)));
  let progressReported = false;

  async function pickDate(): Promise<Date | null> {
    const date = await openDatePicker({ value: picked, mode: "date" });
    if (date) { picked = date; report("date-picked", date.toISOString()); }
    return date;
  }
  libraryHandles.set(own, { get video() { return video; }, get lottie() { return lottie; }, pickDate });
  onDestroy(() => { libraryHandles.delete(own); });

  const stripes = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6"];
  const box = $derived({ height, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: theme.border } as const);
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
</script>

<View style={{ gap: 12 }}>
  {#each kinds as kind (kind)}
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.muted, fontSize: 12 }}>{titles[kind]}</Text>
      <View style={box}>
        {#if kind === "image"}
          <ExpoImage source={labImage} placeholder="blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj/32/32" contentFit="cover" transition={150} cachePolicy="memory-disk" alt="Lab image" style={{ flex: 1 }}
            onLoad={(event) => report("image-load", event.source.url)} onError={(event) => report("image-error", event.error)} />
        {:else if kind === "blur"}
          <BlurTargetView ref={(handle) => { blurTarget = handle as { tag: number } | null; }} style={{ ...fill, flexDirection: "row" }}>
            {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
          </BlurTargetView>
          <BlurView {blurTarget} intensity={70} tint="light" blurMethod="dimezisBlurView" style={{ position: "absolute", left: 24, right: 24, top: 14, bottom: 14, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#191b1e", fontSize: 16, fontWeight: "600" }}>Blur</Text>
          </BlurView>
        {:else if kind === "gradient"}
          <LinearGradient colors={["#ff7a18", "#af002d", "#319197"]} locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "600" }}>Gradient</Text>
          </LinearGradient>
        {:else if kind === "video"}
          <Video source={{ uri: labVideo, type: "mp4" }} repeat muted resizeMode="cover" style={{ flex: 1 }} ref={(handle) => { video = handle; }}
            onLoad={(data) => report("video-load", (data as { duration?: number }).duration)}
            onReadyForDisplay={() => report("video-ready")}
            onProgress={() => { if (!progressReported) { progressReported = true; report("video-progress"); } }}
            onEnd={() => report("video-end")}
            onError={(data) => report("video-error", data)} />
        {:else if kind === "datetime"}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface }}>
            {#if Platform.OS === "ios"}
              <DateTimePicker value={picked} mode="date" display="compact" onValueChange={(_, date) => { picked = date; report("date-picked", date.toISOString()); }} />
            {:else}
              <Pressable accessibilityRole="button" accessibilityLabel="Pick a date" onPress={pickDate} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.foreground, fontSize: 15 }}>{picked.toISOString().slice(0, 10)}</Text>
              </Pressable>
            {/if}
          </View>
        {:else}
          <LottieView source={labLottie} autoPlay loop style={{ flex: 1 }} ref={(handle) => { lottie = handle; }}
            onAnimationLoaded={() => report("lottie-loaded")}
            onAnimationFinish={(cancelled) => report("lottie-finish", cancelled)}
            onAnimationFailure={(error) => report("lottie-failure", error)} />
        {/if}
      </View>
    </View>
  {/each}
</View>
