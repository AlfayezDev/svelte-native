<script lang="ts" module>
  import type { SharedValue } from "@example/svelte-native/animation";
  import type { LottieHandle, PdfHandle, RiveHandle, VideoHandle } from "@example/svelte-native/foreign";
  import type { SvgHandle, SvgRootHandle } from "@example/svelte-native/svg";
  /** A host handle (`ref` of a view): its tag names the native view, `measureInWindow` gives the layout the engine measured. */
  export type Host = { readonly tag: number; measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };
  export type LibraryKind = "image" | "blur" | "svelteblur" | "gradient" | "video" | "datetime" | "lottie" | "pdf" | "capture" | "rive" | "conic" | "shadow" | "text" | "svg";
  export const libraryKinds: readonly LibraryKind[] = ["image", "blur", "svelteblur", "gradient", "video", "datetime", "lottie", "pdf", "capture", "rive", "conic", "shadow", "text", "svg"];
  /** What a set hands to whoever drives it: the video's, the animation's, the PDF's and Rive's functions, the Android date dialog, the capture, the shared value the text shows and the SVG's handles and progress. */
  export type LibraryHandles = {
    video: (VideoHandle & { host: unknown }) | null;
    lottie: (LottieHandle & { host: unknown }) | null;
    pdf: (PdfHandle & { host: unknown }) | null;
    rive: (RiveHandle & { host: unknown }) | null;
    /** The `ViewShot` of the capture section: its own `capture()`, which draws it once it is laid out and tells `onCapture`. */
    viewShot: { capture(): Promise<string> } | null;
    /** The image of the capture section's view, as the URI `captureRef` answers. */
    capture(): Promise<string>;
    /** The number the animated text shows on the UI thread; null until the text section is mounted. */
    count: SharedValue<number> | null;
    /** The first static icon's `Path` and the gradient card's `Svg`: `getTotalLength`, `getBBox`, `toDataURL`, ...; null until the SVG section is mounted. */
    svg: { path: SvgHandle | null; root: SvgRootHandle | null; heart: SvgRootHandle | null; ringSvg: SvgRootHandle | null };
    /** The progress (0 to 1) the animated ring and dot of the SVG section follow on the UI thread; null until the section is mounted. */
    ring: SharedValue<number> | null;
    pickDate(): Promise<Date | null>;
    /** The host handle of each section's view (the container for the libraries whose native view sits behind children), by kind, while it is mounted. */
    hosts: Partial<Record<LibraryKind, Host>>;
    /** The host handle of each section's box (the view a capture of the section draws), by kind. */
    boxes: Partial<Record<LibraryKind, Host>>;
    /** Views of a section the checks reach besides its main one (the shadow section's card in an unflattened wrapper, the built-in blur's label chip), by name. */
    extras: Record<string, Host>;
    /** The text the animated text shows now, as the shared value holds it (JavaScript's own view of the number). */
    shown: () => number | null;
  };
  const titles: Record<LibraryKind, string> = {
    image: "expo-image", blur: "expo-blur", svelteblur: "BlurView (built in)", gradient: "expo-linear-gradient", video: "react-native-video", datetime: "datetimepicker", lottie: "lottie-react-native",
    pdf: "react-native-pdf", capture: "react-native-view-shot", rive: "rive-react-native", conic: "expo-conic-gradient", shadow: "react-native-fast-shadow", text: "react-native-animateable-text",
    svg: "react-native-svg",
  };
</script>
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Image, Pressable, Text, View } from "@example/svelte-native";
  import { createSharedValue, ReduceMotion, withRepeat, withTiming } from "@example/svelte-native/animation";
  import {
    AnimateableText, BlurTargetView, BlurView, ConicGradient, DateTimePicker, ExpoBlurView, ExpoImage, LinearGradient, LottieView, Pdf, Rive, ShadowedView, Video, ViewShot,
    captureRef, openDatePicker, shadowStyle,
  } from "@example/svelte-native/foreign";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Rect, Stop, Svg, SvgXml, Text as SvgText } from "@example/svelte-native/svg";
  import labImage from "../../../../assets/native/lab/lab-image.png";
  import { theme } from "../state.svelte.ts";
  import { labImageBlue, labImageRed, labVideoFile, libraryHandles, libraryLab, record } from "./foreign.svelte.ts";
  import { labLottie } from "./lab-lottie.ts";
  import { labPdf } from "./lab-pdf.ts";
  import { labSvgIcons } from "./lab-svg.ts";

  /**
   * One box per library (expo-image, expo-blur, the library's own `BlurView`, expo-linear-gradient, react-native-video, datetimepicker, lottie-react-native,
   * react-native-pdf, react-native-view-shot, rive-react-native, expo-conic-gradient, react-native-fast-shadow,
   * react-native-animateable-text, react-native-svg), each a fixed `height`, the way the foreign-views lab (SPEC.md, "Foreign views") mounts the older
   * three: inline, in a list row and in a sheet. Every event is recorded under `source` (`record`), and the video's, the animation's,
   * the PDF's and Rive's functions, the capture, the date dialog and the SVG's handles are in `libraryHandles` under the same name while the set is mounted.
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
  let viewShot: LibraryHandles["viewShot"] = null;
  let captured: string | null = $state(null);
  let captureHost: { tag: number } | null = null;
  let blurTarget: { tag: number } | null = $state(null);
  let picked = $state(new Date(Date.UTC(2026, 9, 28, 12, 0, 0)));
  const hosts: LibraryHandles["hosts"] = {};
  const boxes: LibraryHandles["boxes"] = {};
  const extras: LibraryHandles["extras"] = {};
  const keepExtra = (name: string) => {
    let mine: Host | null = null;
    return (handle: unknown) => {
      if (handle) { mine = handle as Host; extras[name] = mine; }
      else if (extras[name] === mine) delete extras[name];
    };
  };
  /** `ref` callback that keeps a section's host handle in `hosts` (or `boxes`) while the view is mounted. */
  const keep = (into: LibraryHandles["hosts"], kind: LibraryKind) => {
    let mine: Host | null = null;
    // Each element has its own callback: when an {#if} swaps one for another the host tells the old one about its end after the new one began, and that must not delete the new one's handle.
    return (handle: unknown) => {
      if (handle) { mine = handle as Host; into[kind] = mine; }
      else if (into[kind] === mine) delete into[kind];
    };
  };

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
  // The SVG section's ring: a shared value that runs 0 to 1 and back on the UI thread; the ring's dash offset and the dot's radius follow it without JavaScript
  // (`animatedProps`: the native props `strokeDashoffset` and `r`).
  // svelte-ignore state_referenced_locally
  const progress = kinds.includes("svg") ? createSharedValue(0) : null;
  const circumference = 2 * Math.PI * 14;
  const ringProps = () => {
    "worklet";
    return { strokeDashoffset: circumference * (1 - (progress ? progress.value : 0)) };
  };
  const dotProps = () => {
    "worklet";
    return { r: 3 + 3 * (progress ? progress.value : 0) };
  };
  const svgHandles: LibraryHandles["svg"] = { path: null, root: null, heart: null, ringSvg: null };
  onMount(() => {
    if (count) count.value = withRepeat(withTiming(100, { duration: 5000, reduceMotion: ReduceMotion.Never }), -1);
    if (progress) progress.value = withRepeat(withTiming(1, { duration: 1800, reduceMotion: ReduceMotion.Never }), -1, true);
  });
  libraryHandles.set(own, { get video() { return video; }, get lottie() { return lottie; }, get pdf() { return pdf; }, get rive() { return rive; }, get viewShot() { return viewShot; }, get count() { return count; }, get svg() { return svgHandles; }, get ring() { return progress; }, hosts, boxes, extras, shown: () => (count ? Math.round(count.value) : null), capture, pickDate });
  onDestroy(() => { libraryHandles.delete(own); });

  const stripes = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6"];
  /** The stripes behind the built-in blur: the first one's colour is a lab prop (the blur must show a change of what is behind it). */
  const blurStripes = $derived([libraryLab.svelteBlurStripe, ...stripes.slice(1)]);
  const box = $derived({ height, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: theme.border } as const);
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
</script>

<View style={{ gap: 12 }}>
  {#each kinds as kind (kind)}
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.muted, fontSize: 12 }}>{titles[kind]}</Text>
      <View style={box} collapsable={false} ref={keep(boxes, kind)}>
        {#if kind === "image"}
          <ExpoImage source={libraryLab.image === "red" ? labImageRed : libraryLab.image === "blue" ? labImageBlue : labImage} placeholder={libraryLab.image === "default" ? "blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj/32/32" : undefined}
            contentFit="cover" transition={libraryLab.image === "default" ? 150 : 0} cachePolicy="memory-disk" alt="Lab image" style={{ flex: 1 }} ref={keep(hosts, kind)}
            onLoadStart={() => report("image-load-start")} onLoad={(event) => report("image-load", event.source.url)} onDisplay={() => report("image-display")} onError={(event) => report("image-error", event.error)} />
        {:else if kind === "blur"}
          <BlurTargetView ref={(handle) => { blurTarget = handle as { tag: number } | null; }} style={{ ...fill, flexDirection: "row" }}>
            {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
          </BlurTargetView>
          <ExpoBlurView {blurTarget} intensity={libraryLab.blurIntensity} tint="light" ref={keep(hosts, kind)} blurMethod="dimezisBlurView" style={{ position: "absolute", left: 24, right: 24, top: 14, bottom: 14, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#191b1e", fontSize: 16, fontWeight: "600" }}>Blur</Text>
          </ExpoBlurView>
        {:else if kind === "svelteblur"}
          <!-- The stripes, and a near-black band across them from 30 % to 42 % of the height (the picture the blur shows must put it where it is: `bandPoints` in foreign-pixels.ts), are drawn before the blur
               (earlier siblings), which is what the blur shows. The label sits on a solid chip so that a capture reads a colour of the child, not a glyph. -->
          <View style={{ ...fill, flexDirection: "row" }}>
            {#each blurStripes as color, index (index)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
          </View>
          <View style={{ position: "absolute", left: 0, right: 0, top: "30%", height: "12%", backgroundColor: "#101214" }} />
          <BlurView intensity={libraryLab.svelteBlurIntensity} tint={libraryLab.svelteBlurTint} ref={keep(hosts, kind)} style={{ position: "absolute", left: 24, right: 24, top: 14, bottom: 14, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            <View collapsable={false} ref={keepExtra("chip")} style={{ backgroundColor: "#191b1e", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "600" }}>Blur</Text>
            </View>
          </BlurView>
        {:else if kind === "gradient"}
          <LinearGradient colors={libraryLab.gradientColors} locations={libraryLab.gradientColors.length === 3 ? [0, 0.5, 1] : undefined} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} ref={keep(hosts, kind)} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "600" }}>Gradient</Text>
          </LinearGradient>
        {:else if kind === "video"}
          <Video source={{ uri: labVideoFile(), type: "mp4" }} repeat muted resizeMode="cover" paused={libraryLab.videoPaused} style={{ flex: 1 }} ref={(handle) => { video = handle; keep(hosts, kind)(handle?.host); }}
            onLoadStart={() => report("video-load-start")}
            onSeek={(data) => report("video-seek", (data as { currentTime?: number }).currentTime)}
            onPlaybackStateChanged={(data) => report("video-state", (data as { isPlaying?: boolean }).isPlaying)}
            onVolumeChange={(data: unknown) => report("video-volume", (data as { volume?: number }).volume)}
            onLoad={(data) => report("video-load", (data as { duration?: number }).duration)}
            onReadyForDisplay={() => report("video-ready")}
            onProgress={() => report("video-progress")}
            onEnd={() => report("video-end")}
            onError={(data) => report("video-error", data)} />
        {:else if kind === "datetime"}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface }}>
            {#if Platform.OS === "ios"}
              <DateTimePicker value={libraryLab.dateValue === null ? picked : new Date(libraryLab.dateValue)} mode={libraryLab.dateMode} display="compact" ref={keep(hosts, kind)} onValueChange={(_, date) => { picked = date; report("date-picked", date.toISOString()); }} onDismiss={() => report("date-dismissed")} />
            {:else}
              <Pressable accessibilityRole="button" accessibilityLabel="Pick a date" onPress={pickDate} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.foreground, fontSize: 15 }}>{picked.toISOString().slice(0, 10)}</Text>
              </Pressable>
            {/if}
          </View>
        {:else if kind === "lottie"}
          <LottieView source={labLottie} autoPlay={libraryLab.lottieAutoPlay} loop={libraryLab.lottieLoop} progress={libraryLab.lottieProgress} style={{ flex: 1 }} ref={(handle) => { lottie = handle; keep(hosts, kind)(handle?.host); }}
            onAnimationLoaded={() => report("lottie-loaded")}
            onAnimationFinish={(cancelled) => report("lottie-finish", cancelled)}
            onAnimationFailure={(error) => report("lottie-failure", error)} />
        {:else if kind === "pdf"}
          <Pdf source={{ uri: labPdf }} page={libraryLab.pdfPage} enablePaging style={{ flex: 1 }} ref={(handle) => { pdf = handle; keep(hosts, kind)(handle?.host); }}
            onLoadComplete={(pages) => report("pdf-load", pages)}
            onPageChanged={(page, pages) => report("pdf-page", `${page}/${pages}`)}
            onError={(error) => report("pdf-error", error.message)}
            onPressLink={(url) => report("pdf-link", url)}>
            {#snippet loading()}<Text style={{ color: theme.muted, fontSize: 12 }}>Opening the PDF</Text>{/snippet}
          </Pdf>
        {:else if kind === "capture"}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 8 }}>
            <ViewShot options={{ format: "png", result: "tmpfile" }} onCapture={(uri) => report("viewshot-capture", uri.slice(-40))} onCaptureFailure={(error) => report("viewshot-failure", String(error))} ref={(handle) => { viewShot = handle; captureHost = handle ? handle.host : null; keep(hosts, kind)(captureHost); }} style={{ width: 80, height: 60, flexDirection: "row", borderRadius: 16, overflow: "hidden" }}>
              {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
              <View style={{ position: "absolute", left: 30, top: 14, width: 20, height: 20, backgroundColor: "#ffffff", elevation: libraryLab.captureElevation, ...(Platform.OS === "ios" ? { shadowColor: "#000000", shadowOpacity: libraryLab.captureElevation > 0 ? 0.6 : 0, shadowRadius: libraryLab.captureElevation / 2, shadowOffset: { width: 0, height: libraryLab.captureElevation / 2 } } : {}) }} />
            </ViewShot>
            <Pressable accessibilityRole="button" accessibilityLabel="Capture the stripes" onPress={() => { capture().catch(() => undefined); }} style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: theme.foreground, fontSize: 14 }}>Capture</Text>
            </Pressable>
            {#if captured}<Image source={{ uri: captured }} accessibilityLabel="Captured stripes" style={{ width: 80, height: 60, borderRadius: 8 }} />{:else}<View style={{ width: 80, height: 60 }} />{/if}
          </View>
        {:else if kind === "rive"}
          <Rive url="https://cdn.rive.app/animations/vehicles.riv" fit={libraryLab.riveFit} style={{ flex: 1 }} ref={(handle) => { rive = handle; keep(hosts, kind)(handle?.host); }}
            onPlay={(name, machine) => report("rive-play", `${name}:${machine}`)}
            onPause={(name, machine) => report("rive-pause", `${name}:${machine}`)}
            onStop={(name, machine) => report("rive-stop", `${name}:${machine}`)}
            onError={(error) => report("rive-error", `${error.type}: ${error.message}`)} />
        {:else if kind === "conic"}
          <ConicGradient colors={libraryLab.conicHard ? ["#e5484d", "#e5484d", "#0091ff", "#0091ff"] : ["#ff7a18", "#af002d", "#319197", "#ff7a18"]} locations={libraryLab.conicHard ? [0, 0.5, 0.5, 1] : [0, 0.33, 0.66, 1]} center={[0.5, 0.5]} angle={libraryLab.conicAngle} ref={keep(hosts, kind)} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "600" }}>Conic</Text>
          </ConicGradient>
        {:else if kind === "shadow"}
          <!-- Two cards in the rounded `overflow: hidden` box: one is a direct child of it (the layout-only views between are flattened away), the other sits in an unflattened wrapper
               (`collapsable={false}`, a `testID`, an `overflow: hidden` of its own with room for the shadow): the shadow must reach its edge in both. -->
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-around" }}>
            <ShadowedView ref={keep(hosts, kind)} style={{ borderRadius: 14, backgroundColor: theme.background, paddingHorizontal: 18, paddingVertical: 10, ...shadowStyle({ color: "#000000", opacity: libraryLab.shadowOpacity, radius: 12, offset: [0, 5] }) }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Shadowed button" onPress={() => report("shadow-press")}>
                <Text style={{ color: theme.foreground, fontSize: 15 }}>Shadowed</Text>
              </Pressable>
            </ShadowedView>
            <View collapsable={false} testID="shadow-wrapper" ref={keepExtra("wrapper")} style={{ overflow: "hidden", padding: 18 }}>
              <ShadowedView ref={keepExtra("wrapped")} style={{ borderRadius: 14, backgroundColor: theme.background, paddingHorizontal: 18, paddingVertical: 10, ...shadowStyle({ color: "#000000", opacity: libraryLab.shadowOpacity, radius: 12, offset: [0, 5] }) }}>
                <Text style={{ color: theme.foreground, fontSize: 15 }}>Wrapped</Text>
              </ShadowedView>
            </View>
          </View>
        {:else if kind === "svg"}
          <View style={{ flex: 1, padding: 6, justifyContent: "space-around" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around" }}>
              <Svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={theme.foreground} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" accessibilityLabel="Check icon">
                <Path d="M20 6 9 17l-5-5" ref={(handle) => { svgHandles.path = handle; }} />
              </Svg>
              <Svg width={34} height={34} viewBox="0 0 24 24" accessibilityLabel="Heart icon" ref={(handle) => { svgHandles.heart = handle; }}>
                <Path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" fill={libraryLab.svgHeart} />
              </Svg>
              <Svg width={58} height={34} pointerEvents="box-only" onPress={() => report("svg-press")} ref={(handle) => { svgHandles.root = handle; }} accessibilityLabel="Gradient card">
                <Defs><SvgLinearGradient id={`${own}-card`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#ff7a18" /><Stop offset="1" stopColor="#319197" /></SvgLinearGradient></Defs>
                <Rect width="100%" height="100%" rx={8} fill={`url(#${own}-card)`} />
                <SvgText x="29" y="22" fill="#ffffff" fontSize={13} fontWeight="bold" textAnchor="middle">SVG</SvgText>
              </Svg>
              <Svg width={34} height={34} viewBox="0 0 36 36" accessibilityLabel="Progress ring" ref={(handle) => { svgHandles.ringSvg = handle; }}>
                <Circle cx={18} cy={18} r={14} fill="none" stroke={theme.border} strokeWidth={4} />
                <Circle cx={18} cy={18} r={14} fill="none" stroke="#0091ff" strokeWidth={4} strokeLinecap="round" strokeDasharray={[circumference]} strokeDashoffset={circumference} transform="rotate(-90 18 18)" animatedProps={ringProps} />
                <Circle cx={18} cy={18} r={3} fill="#0091ff" animatedProps={dotProps} />
              </Svg>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around" }}>
              {#each Object.entries(labSvgIcons) as [name, xml] (name)}<SvgXml {xml} width={36} height={36} />{/each}
            </View>
          </View>
        {:else}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            {#if libraryLab.textStatic === null}
              <AnimateableText text="count 0" animatedProps={countText} accessibilityLabel="Animated count" ref={keep(hosts, kind)} style={{ color: theme.foreground, fontSize: 28, fontWeight: "600" }} />
            {:else}
              <AnimateableText text={libraryLab.textStatic} accessibilityLabel="Static text" ref={keep(hosts, kind)} style={{ color: theme.foreground, fontSize: 28, fontWeight: "600" }} />
            {/if}
          </View>
        {/if}
      </View>
    </View>
  {/each}
</View>
