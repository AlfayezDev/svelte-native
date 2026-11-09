<script lang="ts">
  import { onMount, tick } from "svelte";
  import Dimensions from "react-native/Libraries/Utilities/Dimensions";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { requireOptionalNativeModule } from "expo-modules-core";
  import { File, Paths } from "expo-file-system";
  import StressTile from "./StressTile.svelte";
  import { estimatePeriod, startFrameMonitor, stopFrameMonitor, summarizeFrames } from "./frames.ts";
  import { AnimatedView, createSharedValue } from "@example/svelte-native/animation";
  import { FadeIn, FadeOut } from "react-native-reanimated";
  import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "@example/svelte-native/core";
  import LeanText from "./lean/LeanText.svelte";
  import LeanView from "./lean/LeanView.svelte";
  type FabricStats = { engineInstalled?: boolean; lastFlushMs: number; lastCreated: number; payloadMs: number; createMs: number; appendMs: number; completeMs: number };
  type Fabric = { stats: () => FabricStats; microbench: () => Record<string, number> | null };
  const fabric = () => (globalThis as { __svelteFabric?: Fabric }).__svelteFabric;
  const fabricStats = () => fabric()?.stats() ?? { lastFlushMs: 0, lastCreated: 0, payloadMs: 0, createMs: 0, appendMs: 0, completeMs: 0 };
  (globalThis as { __svelteFabricProfile?: boolean }).__svelteFabricProfile = true;

  // Boot split: React Native's startup timing (runtime init vs bundle entry) plus when this module was evaluated and mounted.
  const entryEvaluatedAt = performance.now();
  const startupTiming = () => {
    const timing = (globalThis.performance as unknown as { rnStartupTiming?: Record<string, number> }).rnStartupTiming;
    return timing ? Object.fromEntries(Object.entries(timing).filter(([, value]) => typeof value === "number").map(([key, value]) => [key, Math.round(value)])) : null;
  };
  let mountedAt = 0;
  // The React-free entry renders this component straight into Fabric and measures a 300-row mount three times.
  let rows = $state<number[]>([]);
  let rawRows = $state<number[]>([]);
  let leanRows = $state<number[]>([]);
  const rowStyle = { padding: 10, borderRadius: 8, backgroundColor: "#ffffff" };
  const rowTextStyle = { fontSize: 14, color: "#191b1e" };
  const engineOn = fabricStats().engineInstalled === true;
  let report = $state("Mounting 300 rows…");
  let taps = $state(0);
  // Engine views (phase 2): text input, switch, spinner, image and modal driven through the same host.
  let typed = $state("");
  let toggled = $state(false);
  let modalOpen = $state(false);
  let imageState = $state("loading");
  let roundsDone = $state(false); // the spinner animates only after the timed rounds, so its redraws do not skew them
  // Phase 3: 48 animated tiles (worklet style, then CSS keyframes) measured with the UI-runtime frame monitor, after the mount rounds.
  let tiles = $state<number[]>([]);
  let probeTag = 0; // the touch probe's Fabric tag, for the engine's animated-props microbenchmark
  // Layout-animation probe: a box toggled every 2 s with entering/exiting fades once the rounds are done.
  let fadeBox = $state(false);
  let fadeToggles = $state(0);
  $effect(() => {
    if (!roundsDone) return;
    const timer = setInterval(() => { fadeBox = !fadeBox; fadeToggles++; console.info("[Svelte fade]", fadeBox ? "show" : "hide", fadeToggles); }, 2000);
    return () => clearInterval(timer);
  });
  let tileVariant = $state<"default" | "css">("default");
  const completions = createSharedValue(0);
  const tileMounted = () => {};
  const tileRemoved = () => {};
  async function animationRound(variant: "default" | "css") {
    tileVariant = variant;
    tiles = Array.from({ length: 48 }, (_, index) => index);
    await tick();
    await pause(600);
    await startFrameMonitor();
    await pause(6000);
    const stats = await stopFrameMonitor();
    const period = estimatePeriod(stats);
    const frames = summarizeFrames(stats, period);
    tiles = [];
    await tick();
    await pause(300);
    return { variant, periodMs: Math.round(period * 100) / 100, count: frames.count, p50: frames.p50, p95: frames.p95, p99: frames.p99, max: Math.round(frames.max), droppedPct: Math.round(frames.droppedPct * 10) / 10 };
  }
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8DwnwEPYMInOXwUAAASWwIOH0pJXQAAAABJRU5ErkJggg==";
  let laidOut: (() => void) | undefined;
  const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  onMount(() => { mountedAt = performance.now(); void run(); });
  async function run() {
    const results: Record<string, number>[] = [];
    await pause(600);
    const microCold = fabric()?.microbench();
    const microWarm = fabric()?.microbench();
    for (let round = 0; round < 9; round++) {
      const raw = round >= 3 && round < 6;
      const lean = round >= 6;
      await pause(800);
      const layout = new Promise<void>((resolve) => { laidOut = resolve; });
      const start = performance.now();
      if (raw) rawRows = Array.from({ length: 300 }, (_, index) => index);
      else if (lean) leanRows = Array.from({ length: 300 }, (_, index) => index);
      else rows = Array.from({ length: 300 }, (_, index) => index);
      await tick();
      const svelteMs = performance.now() - start;
      const afterFlush = fabricStats();
      await Promise.race([layout, pause(8000)]);
      const mountMs = performance.now() - start;
      results.push({ round, raw: raw ? 1 : 0, lean: lean ? 1 : 0, mountMs: Math.round(mountMs), svelteMs: Math.round(svelteMs), fabricFlushMs: Math.round(afterFlush.lastFlushMs), payloadMs: Math.round(afterFlush.payloadMs), createMs: Math.round(afterFlush.createMs), appendMs: Math.round(afterFlush.appendMs), completeMs: Math.round(afterFlush.completeMs), created: afterFlush.lastCreated });
      report = `engine: ${engineOn ? "on" : "off"}\n` + results.map((r) => `#${r.round}${r.raw ? " raw" : r.lean ? " lean" : ""}: mount→layout ${r.mountMs} ms (Svelte ${r.svelteMs} ms incl. Fabric flush ${r.fabricFlushMs} ms = payload ${r.payloadMs} + create ${r.createMs} + append ${r.appendMs} + complete ${r.completeMs}; ${r.created} nodes)`).join("\n");
      const unmountStart = performance.now();
      if (raw) rawRows = []; else if (lean) leanRows = []; else rows = [];
      await tick();
      results[results.length - 1].unmountMs = Math.round(performance.now() - unmountStart);
    }
    const microEnd = fabric()?.microbench();
    const animation: Record<string, number | string>[] = [];
    for (const variant of ["default", "css"] as const) {
      try { animation.push(await animationRound(variant)); } catch (error) { animation.push({ variant, error: String(error) }); }
    }
    report += `\nanimation: ${animation.map((a) => `${a.variant} p50 ${a.p50} p95 ${a.p95} max ${a.max} ms, ${a.droppedPct}% dropped`).join(" · ")}`;
    const engineModule = requireOptionalNativeModule<{ benchAnimated?: (tag: number, iterations: number) => number }>("SvelteEngine");
    const animatedUs = probeTag && engineModule?.benchAnimated ? engineModule.benchAnimated(probeTag, 2000) : -1;
    report += ` · animated prop write ${animatedUs.toFixed(2)} µs`;
    // Platform floor: the same 300 rows as plain Android widgets, built on the UI thread by the lab-only ViewBench module.
    const viewBench = requireOptionalNativeModule<{ run: (count: number, appCompat: boolean, widthPx: number) => Promise<Record<string, number>> }>("ViewBench");
    const widthPx = Math.round((Dimensions.get("window").width - 64) * (Dimensions.get("window").scale ?? 1));
    const bench: Record<string, number>[] = [];
    if (viewBench) for (const appCompat of [false, true, false, true, false, true]) bench.push(await viewBench.run(300, appCompat, widthPx));
    const payload = JSON.stringify({ engine: engineOn, platform: Platform.OS, osVersion: String(Platform.Version), results, micro: { cold: microCold, warm: microWarm, end: microEnd }, viewBench: bench, boot: { ...startupTiming(), entryEvaluatedAt: Math.round(entryEvaluatedAt), mountedAt: Math.round(mountedAt) }, animation, animatedUs });
    console.info("[Svelte fabric spike]", payload);
    // iOS release builds drop console output; the lab reads this file through devicectl.
    try { new File(Paths.document, "fabric-spike.json").write(payload); } catch { console.warn("[Svelte fabric spike] could not write Documents/fabric-spike.json"); }
    rows = Array.from({ length: 300 }, (_, index) => index);
    roundsDone = true;
  }
</script>

<View style={{ flex: 1, paddingTop: 64, paddingHorizontal: 24, gap: 12, backgroundColor: "#f6f6f7" }}>
  <Text style={{ fontSize: 22, fontWeight: "600", color: "#191b1e" }}>Svelte Native · Fabric direct</Text>
  <Text style={{ fontSize: 14, color: "#646970" }}>No React in this surface: Svelte nodes commit straight to the shadow tree.</Text>
  <Text style={{ fontSize: 13, color: "#191b1e" }}>{report}</Text>
  <View style={{ padding: 12, borderRadius: 10, backgroundColor: "#e4e6ea" }} onTouchEnd={() => { taps++; }} ref={(handle: unknown) => { probeTag = (handle as { tag?: number } | null)?.tag ?? 0; }}><Text style={{ fontSize: 13, color: "#191b1e" }}>Touch here · events received: {taps}</Text></View>
  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
    <TextInput style={{ flex: 1, height: 40, borderWidth: 1, borderColor: "#d6d8dd", borderRadius: 8, paddingHorizontal: 10, color: "#191b1e" }} placeholder="Type here" placeholderTextColor="#9a9ea6" bind:value={typed} testID="spike-input" />
    <Switch bind:value={toggled} testID="spike-switch" />
    <ActivityIndicator animating={roundsDone} color="#191b1e" />
    <Image source={{ uri: tinyPng }} style={{ width: 24, height: 24, borderRadius: 4 }} onLoad={() => { imageState = "loaded"; }} onError={() => { imageState = "error"; }} />
  </View>
  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
    <Text style={{ flex: 1, fontSize: 13, color: "#191b1e" }} testID="spike-status">typed: {typed || "(empty)"} · switch: {toggled ? "on" : "off"} · image: {imageState}</Text>
    <Pressable style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#191b1e" }} onPress={() => { modalOpen = true; }} testID="spike-open-modal"><Text style={{ fontSize: 13, color: "#ffffff" }}>Open modal</Text></Pressable>
  </View>
  <Modal visible={modalOpen} transparent={true} animationType="fade" onRequestClose={() => { modalOpen = false; }}>
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)" }}>
      <View style={{ padding: 20, borderRadius: 12, backgroundColor: "#ffffff", gap: 12 }}>
        <Text style={{ fontSize: 16, color: "#191b1e" }} testID="spike-modal-text">Modal on the engine</Text>
        <Pressable style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#e4e6ea" }} onPress={() => { modalOpen = false; }} testID="spike-close-modal"><Text style={{ fontSize: 13, color: "#191b1e" }}>Close</Text></Pressable>
      </View>
    </View>
  </Modal>
  <View style={{ flexDirection: "row", gap: 8, alignItems: "center", minHeight: 44 }}>
    <Text style={{ fontSize: 13, color: "#191b1e" }} testID="spike-fade-count">fade toggles: {fadeToggles}</Text>
    {#if fadeBox}<AnimatedView entering={FadeIn.duration(600)} exiting={FadeOut.duration(600)} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#ff6347" }} accessibilityLabel="fade box" />{/if}
  </View>
  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
    {#each tiles as id (id)}<StressTile {id} animated={true} variant={tileVariant} {completions} mounted={tileMounted} removed={tileRemoved} />{/each}
  </View>
  <ScrollView style={{ height: 360, borderRadius: 12, borderWidth: 1, borderColor: "#d6d8dd" }} contentContainerStyle={{ padding: 8, gap: 6 }}>
    {#each rows as row (row)}
      <View style={rowStyle} onLayout={row === 299 ? () => laidOut?.() : undefined}>
        <Text style={rowTextStyle}>Row {row + 1}</Text>
      </View>
    {/each}
    {#each leanRows as row (row)}
      <LeanView style={rowStyle} onLayout={row === 299 ? () => laidOut?.() : undefined}>
        <LeanText style={rowTextStyle}>Lean row {row + 1}</LeanText>
      </LeanView>
    {/each}
    {#each rawRows as row (row)}
      <native-view nativeProps={row === 299 ? { style: rowStyle, onLayout: () => laidOut?.() } : { style: rowStyle }}>
        <native-text nativeProps={{ style: rowTextStyle }}>Raw row {row + 1}</native-text>
      </native-view>
    {/each}
  </ScrollView>
</View>
