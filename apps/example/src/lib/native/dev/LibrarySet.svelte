<script lang="ts" module>
  import type { SharedValue } from "@rasheed/svelte-native/animation";
  import type { LottieHandle, PdfHandle, RiveHandle, VideoHandle } from "@rasheed/svelte-native/foreign";
  export type LibraryKind = "image" | "blur" | "gradient" | "video" | "datetime" | "lottie" | "pdf" | "capture" | "rive" | "conic" | "shadow" | "text";
  export const libraryKinds: readonly LibraryKind[] = ["image", "blur", "gradient", "video", "datetime", "lottie", "pdf", "capture", "rive", "conic", "shadow", "text"];
  /** What a set hands to whoever drives it: the video's, the animation's, the PDF's and Rive's functions, the Android date dialog, the capture and the shared value the text shows. */
  export type LibraryHandles = {
    video: (VideoHandle & { host: unknown }) | null;
    lottie: (LottieHandle & { host: unknown }) | null;
    pdf: (PdfHandle & { host: unknown }) | null;
    rive: (RiveHandle & { host: unknown }) | null;
    /** The image of the capture section's view, as the URI `captureRef` answers. */
    capture(): Promise<string>;
    /** The number the animated text shows on the UI thread; null until the text section is mounted. */
    count: SharedValue<number> | null;
    pickDate(): Promise<Date | null>;
  };
  const titles: Record<LibraryKind, string> = {
    image: "expo-image", blur: "expo-blur", gradient: "expo-linear-gradient", video: "react-native-video", datetime: "datetimepicker", lottie: "lottie-react-native",
    pdf: "react-native-pdf", capture: "react-native-view-shot", rive: "rive-react-native", conic: "expo-conic-gradient", shadow: "react-native-fast-shadow", text: "react-native-animateable-text",
  };
</script>
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Image, Pressable, Text, View } from "@rasheed/svelte-native";
  import { createSharedValue, ReduceMotion, withRepeat, withTiming } from "@rasheed/svelte-native/animation";
  import {
    AnimateableText, BlurTargetView, BlurView, ConicGradient, DateTimePicker, ExpoImage, LinearGradient, LottieView, Pdf, Rive, ShadowedView, Video, ViewShot,
    captureRef, openDatePicker, shadowStyle,
  } from "@rasheed/svelte-native/foreign";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import labImage from "../../../../assets/native/lab/lab-image.png";
  import { theme } from "../state.svelte.ts";
  import { labVideo, libraryHandles, record } from "./foreign.svelte.ts";
  import { labLottie } from "./lab-lottie.ts";
  import { labPdf } from "./lab-pdf.ts";

  /**
   * One box per library (expo-image, expo-blur, expo-linear-gradient, react-native-video, datetimepicker, lottie-react-native,
   * react-native-pdf, react-native-view-shot, rive-react-native, expo-conic-gradient, react-native-fast-shadow,
   * react-native-animateable-text), each a fixed `height`, the way the foreign-views lab (SPEC.md, "Foreign views") mounts the older
   * three: inline, in a list row and in a sheet. Every event is recorded under `source` (`record`), and the video's, the animation's,
   * the PDF's and Rive's functions, the capture and the date dialog are in `libraryHandles` under the same name while the set is mounted.
   * Rive loads its file from Rive's CDN: it needs the network.
   */
  let { source, kinds = libraryKinds, height = 96 }: { source: string; kinds?: readonly LibraryKind[]; height?: number } = $props();
  const report = (event: string, detail?: unknown) => record(source, event, detail);
  // svelte-ignore state_referenced_locally
  const own = source;

  let video: LibraryHandles["video"] = null;
  let lottie: LibraryHandles["lottie"] = null;
  let pdf: LibraryHandles["pdf"] = null;
  let rive: LibraryHandles["rive"] = null;
  let captured: string | null = $state(null);
  let captureHost: { tag: number } | null = null;
  let blurTarget: { tag: number } | null = $state(null);
  let picked = $state(new Date(Date.UTC(2026, 9, 28, 12, 0, 0)));
  let progressReported = false;

  async function pickDate(): Promise<Date | null> {
    const date = await openDatePicker({ value: picked, mode: "date" });
    if (date) { picked = date; report("date-picked", date.toISOString()); }
    return date;
  }
  /** Draws the capture section's box (`captureRef`) and shows the result next to it. */
  async function capture(): Promise<string> {
    if (!captureHost) throw new Error("the capture section is not mounted");
    try {
      const uri = await captureRef(captureHost, { format: "png", result: "tmpfile" });
      captured = uri;
      report("capture-ok", uri.slice(0, 48));
      return uri;
    } catch (error) {
      report("capture-error", String(error));
      throw error;
    }
  }
  // The text section's number: a shared value that runs 0 to 100 on the UI thread, which the animated text shows without JavaScript.
  // svelte-ignore state_referenced_locally
  const count = kinds.includes("text") ? createSharedValue(0) : null;
  const countText = () => {
    "worklet";
    return { text: `count ${Math.round(count ? count.value : 0)}` };
  };
  onMount(() => {
    if (count) count.value = withRepeat(withTiming(100, { duration: 5000, reduceMotion: ReduceMotion.Never }), -1);
  });
  libraryHandles.set(own, { get video() { return video; }, get lottie() { return lottie; }, get pdf() { return pdf; }, get rive() { return rive; }, get count() { return count; }, capture, pickDate });
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
        {:else if kind === "lottie"}
          <LottieView source={labLottie} autoPlay loop style={{ flex: 1 }} ref={(handle) => { lottie = handle; }}
            onAnimationLoaded={() => report("lottie-loaded")}
            onAnimationFinish={(cancelled) => report("lottie-finish", cancelled)}
            onAnimationFailure={(error) => report("lottie-failure", error)} />
        {:else if kind === "pdf"}
          <Pdf source={{ uri: labPdf }} enablePaging style={{ flex: 1 }} ref={(handle) => { pdf = handle; }}
            onLoadComplete={(pages) => report("pdf-load", pages)}
            onPageChanged={(page, pages) => report("pdf-page", `${page}/${pages}`)}
            onError={(error) => report("pdf-error", error.message)}
            onPressLink={(url) => report("pdf-link", url)}>
            {#snippet loading()}<Text style={{ color: theme.muted, fontSize: 12 }}>Opening the PDF</Text>{/snippet}
          </Pdf>
        {:else if kind === "capture"}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 8 }}>
            <ViewShot options={{ format: "png", result: "tmpfile" }} ref={(handle) => { captureHost = handle ? handle.host : null; }} style={{ width: 80, height: 60, flexDirection: "row", borderRadius: 8 }}>
              {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
            </ViewShot>
            <Pressable accessibilityRole="button" accessibilityLabel="Capture the stripes" onPress={() => { capture().catch(() => undefined); }} style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: theme.foreground, fontSize: 14 }}>Capture</Text>
            </Pressable>
            {#if captured}<Image source={{ uri: captured }} accessibilityLabel="Captured stripes" style={{ width: 80, height: 60, borderRadius: 8 }} />{:else}<View style={{ width: 80, height: 60 }} />{/if}
          </View>
        {:else if kind === "rive"}
          <Rive url="https://cdn.rive.app/animations/vehicles.riv" fit="contain" style={{ flex: 1 }} ref={(handle) => { rive = handle; }}
            onPlay={(name, machine) => report("rive-play", `${name}:${machine}`)}
            onError={(error) => report("rive-error", `${error.type}: ${error.message}`)} />
        {:else if kind === "conic"}
          <ConicGradient colors={["#ff7a18", "#af002d", "#319197", "#ff7a18"]} locations={[0, 0.33, 0.66, 1]} center={[0.5, 0.5]} angle={0} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "600" }}>Conic</Text>
          </ConicGradient>
        {:else if kind === "shadow"}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ShadowedView style={{ borderRadius: 14, backgroundColor: theme.background, paddingHorizontal: 18, paddingVertical: 10, ...shadowStyle({ color: "#000000", opacity: 0.45, radius: 12, offset: [0, 5] }) }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Shadowed button" onPress={() => report("shadow-press")}>
                <Text style={{ color: theme.foreground, fontSize: 15 }}>Shadowed</Text>
              </Pressable>
            </ShadowedView>
          </View>
        {:else}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <AnimateableText text="count 0" animatedProps={countText} accessibilityLabel="Animated count" style={{ color: theme.foreground, fontSize: 28, fontWeight: "600" }} />
          </View>
        {/if}
      </View>
    </View>
  {/each}
</View>
