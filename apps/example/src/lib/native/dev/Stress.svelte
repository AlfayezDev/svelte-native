<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { ScrollView as NativeScrollView, TextInput as NativeTextInput } from "react-native";
  import type {} from "@rasheed/svelte-native/elements";
  import { List, Modal, ScrollView, Tabs, Text, TextInput, View, useRouter, type TabHandle, type TabItem } from "@rasheed/svelte-native";
  import { createSharedValue, runOnUIAsync, type SharedValue } from "@rasheed/svelte-native/animation";
  import { requireOptionalNativeModule } from "expo-modules-core";
  import Dimensions from "react-native/Libraries/Utilities/Dimensions";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { nativeSmokeEnabled, theme } from "../state.svelte.ts";
  import Button from "../components/Button.svelte";
  import StressTile from "./StressTile.svelte";
  import { screenLab } from "./model.svelte.ts";
  import { runForeignViews } from "./foreign-lab.ts";
  import { runForeignLeftovers, runForeignLibraries } from "./foreign-libraries-lab.ts";
  import { libraryKinds, type LibraryKind } from "./LibrarySet.svelte";
  import { smokeScenarioOutcome } from "./smoke-rules.ts";
  import { estimatePeriod, startFrameMonitor, stopFrameMonitor, summarizeFrames, type FrameStats, type FrameSummary } from "./frames.ts";
  import { detailOf, lab as gestureLab, outcomeOf, scenarios as gestureSpecs, type Drive, type ScenarioSpec, type Snapshot } from "./gestures-lab.ts";

  type Verdict = "pass" | "fail" | "info";
  type Result = { name: string; verdict: Verdict; summary: string; frames?: FrameSummary; detail?: Record<string, unknown> };
  type Scenario = { name: string; label: string; run: (signal: AbortSignal) => Promise<Omit<Result, "name">> };
  type Churn = { created: number; destroyed: number; rounds: number; changesAfterDestroy: number; completed: number; lateCompletions: number };

  /** `autorun`: "quick" or comma-separated scenario names started on mount; `onResult` receives every recorded result and `done` after the last. */
  let { autorun = "", onResult }: { autorun?: string; onResult?: (results: Result[], done: boolean) => void } = $props();
  const router = useRouter();
  let running = $state<string | null>(null);
  let results = $state<Result[]>([]);
  let status = $state("Ready. Each scenario samples UI-runtime frame intervals; verdicts use the display's measured frame period.");
  let period = $state(1000 / 60);
  let view = $state<"none" | "tiles" | "list" | "virtual-list" | "input" | "modal" | "tabs">("none");
  let tiles = $state<number[]>([]);
  let animatedTiles = $state(true);
  let tileVariant = $state<"default" | "square" | "translate" | "css">("default");
  let calibrated = false;
  let warmed = false;
  let rows = $state<number[]>([]);
  let listClipped = $state(false);
  let listRaw = $state(false);
  let typed = $state("");
  let modalVisible = $state(false);
  let tabSelected = $state("one");
  const tabItems: TabItem[] = [
    { key: "one", title: "One", icon: tabGlyph, badge: 2 },
    { key: "two", title: "Two", icon: tabGlyph },
    { key: "three", title: "Three", icon: tabGlyph, badge: true },
  ];
  let rowsLaidOut: (() => void) | undefined;
  let modalShown: (() => void) | undefined;
  let scroller: NativeScrollView | null = null;
  let virtualList: { scrollToIndex: (index: number, animated?: boolean) => void } | undefined = $state();
  let input: NativeTextInput | null = null;
  let created = 0;
  let destroyed = 0;
  const handles = new SvelteMap<number, SharedValue<number>>();
  const completions = createSharedValue(0);
  let controller: AbortController | undefined;
  let live = true;
  onDestroy(() => {
    live = false;
    controller?.abort();
    void stopFrameMonitor().catch((error: unknown) => console.error("[Svelte frame monitor]", error));
  });

  function mounted(id: number, value: SharedValue<number> | null) { if (value) handles.set(id, value); created++; }
  function removed(id: number) { handles.delete(id); destroyed++; }
  function pause(milliseconds: number, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, milliseconds);
      signal?.addEventListener("abort", finish, { once: true });
      if (signal?.aborted) finish();
    });
  }
  function sample(values: SharedValue<number>[]) {
    // Queue the snapshot after Reanimated's asynchronous cancellation jobs.
    return runOnUIAsync(() => { "worklet"; return values.map((value) => value.value); });
  }
  async function settle() { await tick(); await Promise.resolve(); await tick(); }
  function heapBytes(): number {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
    const stats = hermes?.getInstrumentedStats?.();
    return stats?.js_allocatedBytes ?? stats?.js_heapSize ?? -1;
  }
  const megabytes = (bytes: number) => (bytes < 0 ? "n/a" : `${(bytes / 1048576).toFixed(1)} MB`);

  /** The engine's live counts (`SvelteEngine.stats()`, read on the main thread, null while that is busy for 500 ms). */
  const engineModule = requireOptionalNativeModule<{ stats?: () => Record<string, number> | null; collectJava?: () => boolean }>("SvelteEngine");
  async function engineStats(): Promise<Record<string, number> | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stats = engineModule?.stats?.() ?? null;
      if (stats) return stats;
      await pause(150);
    }
    return null;
  }
  function hermesHeap(): Record<string, number> | null {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
    const stats = hermes?.getInstrumentedStats?.();
    if (!stats) return null;
    return { allocated: stats.js_allocatedBytes ?? -1, heapSize: stats.js_heapSize ?? -1, malloc: stats.js_mallocSizeEstimate ?? -1, va: stats.js_vaSize ?? -1, gcs: stats.js_numGCs ?? -1 };
  }
  /**
   * Hermes counts old-generation garbage as allocated until a full collection, and native memory held by dead JS
   * wrappers (shadow nodes) is freed with them, so a sample is only comparable after one. This Hermes build exposes
   * `gc()`; without it the sample says it was not collected and qa/soak does not derive a growth from it. The Java
   * heap goes next (dead views, layouts and render nodes hold native memory until collected), then this runtime once
   * more for what the Java collection released; `soakSample` collects the worklet runtime.
   */
  async function collectGarbage(): Promise<string | null> {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== "function") return null;
    gc();
    engineModule?.collectJava?.();
    await pause(300);
    gc();
    return "gc";
  }
  /** One `[Svelte soak]` line for qa/soak: the phase (`start`, `sample`, `baseline`, `final`), milliseconds since the soak began, the Hermes heap and the engine counts. */
  async function soakSample(phase: string, since: number, cycle: number, collected: string | null = null) {
    const uiBefore = await uiHeap(false);
    const ui = collected !== null ? await uiHeap(true) : uiBefore;
    console.info("[Svelte soak]", JSON.stringify({ phase, cycle, t: Date.now() - since, collected, heap: hermesHeap(), engine: await engineStats(), ui, uiBefore }));
  }
  /** The worklet (UI) runtime is a second Hermes heap with its own garbage; `collect` runs a full collection there first, like `collectGarbage` does for this runtime. */
  function uiHeap(collect: boolean): Promise<Record<string, number> | null> {
    return runOnUIAsync(() => {
      "worklet";
      const scope = globalThis as { gc?: () => void; HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } };
      let collected = 0;
      if (collect && typeof scope.gc === "function") { scope.gc(); collected = 1; }
      const stats = scope.HermesInternal?.getInstrumentedStats?.();
      if (!stats) return { collected, allocated: -1, heapSize: -1, malloc: -1, va: -1, gcs: -1 };
      return { collected, allocated: stats.js_allocatedBytes ?? -1, heapSize: stats.js_heapSize ?? -1, malloc: stats.js_mallocSizeEstimate ?? -1, va: stats.js_vaSize ?? -1, gcs: stats.js_numGCs ?? -1 };
    });
  }
  /** `run=foreign-libraries,only:image.blur`: the libraries `foreign-libraries` checks (the thirteen when absent). */
  let foreignOnly: LibraryKind[] | undefined;
  /** Who injects the input of the `gestures-*` scenarios: `run=...,drive:adb` (the harness, from the lines of the handshake), `drive:qa` (the app's own injector, Android's QA variant), `drive:xctest`; none: a person. */
  let gestureDrive: Drive = "none";
  /**
   * A `gestures-*` scenario (SPEC.md, "Gestures", "On a device, in the lab"): opens the lab page of each round of the scenario, starts it with
   * the frame monitor armed (the page logs `[Svelte gesture] ready` and whoever drives injects), waits for the round to end or for its budget
   * (20 s, more for a scenario with many steps), judges the counters with the scenario's own checks, and closes the page. The frames of the
   * window count in the verdict only where the scenario says so (the box and the pinch drive an animation on the UI thread); the others record them.
   */
  async function gestureScenario(spec: ScenarioSpec, signal: AbortSignal): Promise<Omit<Result, "name">> {
    const depth = router.entries.length;
    const snapshots: Snapshot[] = [];
    const steps: Snapshot[][] = [];
    let timedOut: string | null = null;
    let frames: FrameSummary | undefined;
    try {
      for (let round = 0; round < spec.rounds.length && !signal.aborted; round++) {
        const query = `?mode=${spec.mode}${spec.busy ? "&js=busy" : ""}&drive=${gestureDrive}&managed=1&round=${round}`;
        router.goto(`/__dev/gestures${query}`, spec.presentation ? { presentation: spec.presentation } : undefined);
        // The push (or the sheet's rise) has to be over: the page measures the views where they are, and the harness aims at them.
        await pause(1000, signal);
        const session = await gestureLab.wait(spec.name, round, 8000);
        const budget = Math.max(20_000, 6_000 * (spec.rounds[round]?.steps.length ?? 0) + 4_000);
        const limit = new AbortController();
        signal.addEventListener("abort", () => { limit.abort(); }, { once: true });
        void pause(budget, limit.signal).then(() => { session.abort(signal.aborted ? "stopped" : `${budget / 1000} s`); });
        const measured = await measure(async () => { await session.start(); return session.finished; });
        limit.abort();
        frames = measured.frames;
        snapshots.push(measured.value);
        steps.push(session.steps);
        if (session.timedOut) timedOut = session.timedOut;
        if (router.entries.length > depth) { router.back(); await pause(800, signal); }
      }
    } finally {
      // A round that threw leaves its page on the stack: take it off, so the next scenario does not start under it.
      for (let attempt = 0; attempt < 3 && router.entries.length > depth; attempt++) { router.back(); await pause(800); }
    }
    const checks = spec.evaluate(snapshots, steps, { platform: Platform.OS, drive: gestureDrive, density: Dimensions.get("window").scale });
    // Every round's page was pushed and has to be gone: a screen left on the stack would sit under the next scenario.
    checks.push({ name: "stack back where it began", ok: router.entries.length === depth, value: String(router.entries.length - depth) });
    const outcome = outcomeOf(spec, checks, frames ?? null, timedOut);
    const observed = frames ? { frames: { periodMs: Number(frames.periodMs.toFixed(2)), p50: frames.p50, p95: frames.p95, max: Math.round(frames.max), droppedPct: Number(frames.droppedPct.toFixed(1)) } } : {};
    return { verdict: outcome.verdict, summary: outcome.summary, ...(spec.judgesFrames && frames ? { frames } : {}), detail: detailOf(spec, outcome, snapshots, gestureDrive, { observed }) };
  }

  let soakSeconds = 600;
  /** The parts of one soak cycle. `run=soak-mix-<seconds>s` runs the default ones, `.static.churn` and the like only those named (to bisect a growth); `static` is plain view churn, off by default. */
  const soakPartNames: readonly string[] = ["churn", "static", "nav", "modal", "sheet", "header", "list", "tabs"];
  let soakParts = new Set(soakPartNames.filter((part) => part !== "static"));
  async function measure<Value>(work: () => Promise<Value>): Promise<{ stats: FrameStats; frames: FrameSummary; value: Value }> {
    await startFrameMonitor();
    try {
      const value = await work();
      const stats = await stopFrameMonitor();
      return { stats, frames: summarizeFrames(stats, period), value };
    } catch (error) {
      await stopFrameMonitor().catch(() => undefined);
      throw error;
    }
  }
  const verdict = (frames: FrameSummary, condition = true): Verdict => (frames.smooth && condition ? "pass" : "fail");
  const describe = (frames: FrameSummary) =>
    `p50 ${frames.p50} · p95 ${frames.p95} · p99 ${frames.p99} · max ${frames.max.toFixed(0)} ms · ${frames.droppedPct.toFixed(1)}% dropped · ${frames.count} intervals in ${(frames.coverageMs / 1000).toFixed(1)} s`;

  /** `verify` samples retired shared values every round for the cleanup verdict; perf-only runs skip it. */
  async function churn(signal: AbortSignal, animated: boolean, durationMs: number, verify = true): Promise<Churn> {
    created = 0; destroyed = 0; completions.value = 0;
    let nextId = 48;
    let rounds = 0;
    let changesAfterDestroy = 0;
    let retired: SharedValue<number>[] = [];
    let frozen: number[] = [];
    animatedTiles = animated;
    view = "tiles";
    tiles = Array.from({ length: 48 }, (_, index) => index);
    await tick();
    const start = Date.now();
    while (Date.now() - start < durationMs && !signal.aborted) {
      await pause(250, signal);
      if (signal.aborted) break;
      if (verify) {
        const current = await sample(retired);
        changesAfterDestroy += current.filter((value, index) => Math.abs(value - frozen[index]) > 0.000001).length;
        retired = [...handles].filter(([id]) => id >= 16).map(([, value]) => value);
      }
      tiles = [...Array.from({ length: 16 }, (_, index) => index), ...Array.from({ length: 32 }, () => nextId++)];
      await tick();
      if (verify) frozen = await sample(retired);
      rounds++;
      status = `${running} · ${Math.floor((Date.now() - start) / 1000)} / ${Math.round(durationMs / 1000)} s · ${created} mounted / ${destroyed} destroyed`;
    }
    const remaining = [...handles.values()];
    tiles = [];
    await tick();
    const stopped = await sample(remaining);
    const completed = completions.value;
    await pause(300);
    const after = await sample(remaining);
    changesAfterDestroy += after.filter((value, index) => Math.abs(value - stopped[index]) > 0.000001).length;
    return { created, destroyed, rounds, changesAfterDestroy, completed, lateCompletions: completions.value - completed };
  }
  function cleanupPassed(report: Churn) {
    return report.changesAfterDestroy === 0 && report.created === report.destroyed && report.completed > 0 && report.lateCompletions === 0;
  }
  async function animatedChurn(signal: AbortSignal, durationMs: number, verify = true): Promise<Omit<Result, "name">> {
    const { frames, value } = await measure(() => churn(signal, true, durationMs, verify));
    const cleanup = cleanupPassed(value);
    return {
      verdict: cleanup ? verdict(frames) : "fail",
      summary: `${describe(frames)} · ${verify ? `cleanup ${cleanup ? "ok" : "FAILED"} · ` : ""}${value.rounds} rounds · ${value.created} mounted / ${value.destroyed} destroyed${verify ? ` · ${value.changesAfterDestroy} values changed after destruction` : ""}`,
      frames,
      detail: { ...value },
    };
  }
  function waitFor(signal: AbortSignal, register: (resolve: () => void) => void, timeoutMs: number, what: string) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} did not happen within ${timeoutMs} ms`)), timeoutMs);
      const done = () => { clearTimeout(timer); resolve(); };
      register(done);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  /**
   * `onLayout` is emitted when Fabric commits, usually before the engine has applied the mount on the UI thread, so a window opened
   * right after `laidOut` would hold that apply and the first draw of the new rows as one frame interval (70 ms for 300 rows on the A16:
   * 43 ms of view creation, then a 29 ms frame recording them) instead of the scrolling it is meant to measure. Six frames are enough
   * for the rows to be on screen and the renderer to have caught up.
   */
  async function mountFrames(signal: AbortSignal) {
    for (let frame = 0; frame < 6 && !signal.aborted; frame++) await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }

  /** `profile` turns on the host's per-flush timings (`__svelteFabricProfile`) and returns every flush of the mount in `detail.flushes`. */
  async function virtualList300(signal: AbortSignal, profile: boolean): Promise<Omit<Result, "name">> {
    const scope = globalThis as { __svelteFabricProfile?: boolean; __svelteFlushLog?: unknown[] };
    view = "virtual-list"; rows = []; await settle();
    // The first window holds rows 0-9; the last of them reports the layout.
    const laidOut = waitFor(signal, (resolve) => { rowsLaidOut = resolve; }, 8000, "Row layout");
    scope.__svelteFlushLog = [];
    scope.__svelteFabricProfile = profile;
    const mountStart = performance.now();
    let svelteMs: number;
    try {
      rows = Array.from({ length: 300 }, (_, index) => index);
      await tick();
      svelteMs = performance.now() - mountStart;
      await laidOut;
    } finally {
      scope.__svelteFabricProfile = false;
    }
    const mountMs = performance.now() - mountStart;
    await mountFrames(signal);
    const flushes = profile ? (scope.__svelteFlushLog ?? []).map((flush) => ({ ...(flush as Record<string, number>), at: (flush as { at: number }).at - mountStart })) : undefined;
    const { frames } = await measure(async () => {
      for (let leg = 0; leg < 3 && !signal.aborted; leg++) {
        virtualList?.scrollToIndex(299, true);
        await pause(800, signal);
        virtualList?.scrollToIndex(0, true);
        await pause(800, signal);
      }
    });
    const unmountStart = performance.now();
    rows = []; await settle();
    const unmountMs = performance.now() - unmountStart;
    view = "none"; await settle();
    return { verdict: verdict(frames), summary: `${describe(frames)} · mount to layout ${mountMs.toFixed(0)} ms (Svelte flush ${svelteMs.toFixed(0)} ms) · unmount ${unmountMs.toFixed(0)} ms`, frames, detail: { mountMs, svelteMs, unmountMs, clipped: false, raw: false, virtual: true, flushes } };
  }

  const scenarios: Scenario[] = [
    { name: "warm-up", label: "Warm-up · 3 s of animated tiles, unmeasured (shader compilation, JIT)", async run(signal) {
      animatedTiles = true; tileVariant = "default"; view = "tiles"; tiles = Array.from({ length: 48 }, (_, index) => index); await settle();
      await pause(3000, signal);
      tiles = []; view = "none"; await settle();
      warmed = true;
      return { verdict: "info", summary: "48 animated tiles ran for 3 s before measurement so the first measured scenario does not pay shader compilation and JIT." };
    } },
    { name: "idle", label: "Idle calibration · 2 s", async run(signal) {
      view = "none"; await settle();
      const { stats } = await measure(() => pause(2000, signal));
      period = estimatePeriod(stats);
      calibrated = true;
      const frames = summarizeFrames(stats, period);
      return { verdict: verdict(frames), summary: `frame period ${period.toFixed(2)} ms (${Math.round(1000 / period)} Hz) · ${describe(frames)}`, frames };
    } },
    ...([["animation-48", "default", "48 animated tiles · 8 s"], ["animation-48-square", "square", "48 animated tiles without rounded corners · 8 s"], ["animation-48-translate", "translate", "48 tiles animating only translateY · 8 s"], ["animation-48-css", "css", "48 tiles as Reanimated CSS keyframe animations · 8 s"]] as const).map(([name, variant, label]): Scenario => ({ name, label, async run(signal) {
      animatedTiles = true; tileVariant = variant; view = "tiles"; tiles = Array.from({ length: 48 }, (_, index) => index); await settle();
      const { frames } = await measure(() => pause(8000, signal));
      tiles = []; tileVariant = "default"; await settle();
      return { verdict: verdict(frames), summary: describe(frames), frames, detail: { variant } };
    } })),
    { name: "churn-static", label: "Replace 32 static views every 250 ms · 8 s", async run(signal) {
      const { frames, value } = await measure(() => churn(signal, false, 8000, false));
      return { verdict: verdict(frames), summary: `${describe(frames)} · ${value.rounds} rounds · ${value.created} mounted / ${value.destroyed} destroyed`, frames, detail: { ...value } };
    } },
    { name: "churn-animated", label: "Replace 32 animated views every 250 ms · 8 s", run: (signal) => animatedChurn(signal, 8000, false) },
    ...([["list-300", false, false], ["list-300-clipped", true, false], ["list-300-raw", false, true]] as const).map(([name, clipped, raw]): Scenario => ({ name, label: `Mount, scroll and unmount 300 rows${clipped ? " with removeClippedSubviews" : raw ? " as raw host tags (no primitive components)" : ""}`, async run(signal) {
      listClipped = clipped; listRaw = raw; view = "list"; rows = []; await settle();
      const laidOut = waitFor(signal, (resolve) => { rowsLaidOut = resolve; }, 8000, "Row layout");
      const mountStart = performance.now();
      rows = Array.from({ length: 300 }, (_, index) => index);
      await tick();
      const svelteMs = performance.now() - mountStart;
      await laidOut;
      const mountMs = performance.now() - mountStart;
      await mountFrames(signal);
      const { frames } = await measure(async () => {
        for (let leg = 0; leg < 3 && !signal.aborted; leg++) {
          scroller?.scrollToEnd({ animated: true });
          await pause(800, signal);
          scroller?.scrollTo({ y: 0, animated: true });
          await pause(800, signal);
        }
      });
      const unmountStart = performance.now();
      rows = []; await settle();
      const unmountMs = performance.now() - unmountStart;
      view = "none"; await settle();
      return { verdict: verdict(frames), summary: `${describe(frames)} · mount to layout ${mountMs.toFixed(0)} ms (Svelte flush ${svelteMs.toFixed(0)} ms) · unmount ${unmountMs.toFixed(0)} ms`, frames, detail: { mountMs, svelteMs, unmountMs, clipped, raw } };
    } })),
    { name: "list-300-virtual", label: "Mount, scroll and unmount 300 rows in the windowed List", run: (signal) => virtualList300(signal, false) },
    { name: "list-mount-loop", label: "Mount the windowed List 40 times (for a CPU profile of the mount: `simpleperf record -t <JS thread>` while it runs)", async run(signal) {
      view = "virtual-list"; rows = []; await settle();
      const times: number[] = [];
      for (let round = 0; round < 40 && !signal.aborted; round++) {
        const laidOut = waitFor(signal, (resolve) => { rowsLaidOut = resolve; }, 8000, "Row layout");
        const start = performance.now();
        rows = Array.from({ length: 300 }, (_, index) => index);
        await tick();
        await laidOut;
        times.push(performance.now() - start);
        await pause(120, signal);
        rows = []; await settle();
        await pause(120, signal);
      }
      view = "none"; await settle();
      const sorted = [...times].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      return { verdict: "info", summary: `${times.length} mounts to layout: median ${median.toFixed(1)} ms, min ${(sorted[0] ?? 0).toFixed(1)}, max ${(sorted.at(-1) ?? 0).toFixed(1)} · first ${times.slice(0, 3).map((t) => t.toFixed(1)).join(", ")}`, detail: { times } };
    } },
    { name: "list-mount-hermes", label: "Mount the windowed List 200 times under Hermes' sampling profiler (trace in the app's external files directory: `adb pull /sdcard/Android/data/<package>/files/hermes.cpuprofile`)", async run(signal) {
      const profiler = requireOptionalNativeModule<{ profileJs?: (start: boolean) => string | null }>("SvelteEngine");
      view = "virtual-list"; rows = []; await settle();
      const times: number[] = [];
      profiler?.profileJs?.(true);
      for (let round = 0; round < 200 && !signal.aborted; round++) {
        const laidOut = waitFor(signal, (resolve) => { rowsLaidOut = resolve; }, 8000, "Row layout");
        const start = performance.now();
        rows = Array.from({ length: 300 }, (_, index) => index);
        await tick();
        await laidOut;
        times.push(performance.now() - start);
        await pause(60, signal);
        rows = []; await settle();
        await pause(60, signal);
      }
      const path = profiler?.profileJs?.(false) ?? null;
      view = "none"; await settle();
      const sorted = [...times].sort((a, b) => a - b);
      return { verdict: "info", summary: `${times.length} mounts to layout under the profiler: median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1)} ms · trace ${path ?? "not written"}` };
    } },
    { name: "list-300-virtual-profile", label: "The windowed List again, with the host timing every flush (`detail.flushes`)", run: (signal) => virtualList300(signal, true) },
    { name: "input-120", label: "Push 120 characters through bind:value", async run(signal) {
      view = "input"; typed = ""; await settle();
      const { frames } = await measure(async () => {
        for (let index = 0; index < 120 && !signal.aborted; index++) {
          typed += String.fromCharCode(97 + (index % 26));
          await pause(40, signal);
        }
        await settle();
      });
      const length = typed.length;
      view = "none"; await settle();
      return { verdict: verdict(frames, length === 120), summary: `${describe(frames)} · value length ${length} / 120`, frames };
    } },
    { name: "input-typing", label: "Type on the keyboard for 20 s (external)", async run(signal) {
      view = "input"; typed = ""; await settle();
      input?.focus();
      const start = Date.now();
      const { frames } = await measure(async () => { while (Date.now() - start < 20000 && !signal.aborted && typed.length < 120) await pause(100, signal); });
      const length = typed.length;
      input?.blur();
      view = "none"; await settle();
      return { verdict: length ? verdict(frames) : "info", summary: `${describe(frames)} · ${length} characters received from the keyboard`, frames };
    } },
    { name: "modal-8", label: "Open and close a modal 8 times", async run(signal) {
      view = "modal"; await settle();
      let shows = 0;
      const { frames } = await measure(async () => {
        for (let cycle = 0; cycle < 8 && !signal.aborted; cycle++) {
          const shown = waitFor(signal, (resolve) => { modalShown = () => { shows++; resolve(); }; }, 3000, "Modal show");
          modalVisible = true;
          await shown;
          await pause(300, signal);
          modalVisible = false;
          await pause(450, signal);
        }
      });
      view = "none"; await settle();
      return { verdict: verdict(frames, shows === 8), summary: `${describe(frames)} · ${shows} / 8 shows`, frames };
    } },
    { name: "navigation-8", label: "Push and pop a screen without a native header 8 times, over another one", async run(signal) {
      const depth = router.entries.length;
      // The lab page's own screen has a native header: a pop that reveals it shows the navigation bar again, which is header-8's cost.
      // The screens pushed and popped here lie over a bare one, so the scenario measures the stack alone.
      router.goto("/__dev/screen?header=none");
      await pause(900, signal);
      const { frames } = await measure(async () => {
        for (let cycle = 0; cycle < 8 && !signal.aborted; cycle++) {
          router.goto("/__dev/screen?header=none");
          await pause(800, signal);
          router.back();
          await pause(800, signal);
        }
      });
      router.back();
      await pause(600, signal);
      return { verdict: verdict(frames, router.entries.length === depth), summary: `${describe(frames)} · stack depth ${router.entries.length} (expected ${depth})`, frames };
    } },
    { name: "header-8", label: "Push 8 screens with native headers and go back through them", async run(signal) {
      const depth = router.entries.length;
      // One unmeasured round first: the screen's module loads on its first navigation.
      router.goto("/__dev/screens?mode=header&depth=0");
      await pause(900, signal);
      router.back();
      await pause(600, signal);
      screenLab.appears = 0; screenLab.disappears = 0;
      const { frames } = await measure(async () => {
        for (let level = 1; level <= 8 && !signal.aborted; level++) {
          router.goto(`/__dev/screens?mode=header&depth=${level}`);
          await pause(700, signal);
        }
        for (let level = 8; level >= 1 && !signal.aborted; level--) {
          router.back();
          await pause(600, signal);
        }
      });
      return { verdict: verdict(frames, router.entries.length === depth), summary: `${describe(frames)} · stack depth ${router.entries.length} (expected ${depth}) · ${screenLab.appears} appear / ${screenLab.disappears} disappear events`, frames, detail: { appears: screenLab.appears, disappears: screenLab.disappears } };
    } },
    { name: "sheet-8", label: "Open and close a two-detent sheet 8 times (drag it by hand or with adb to count detent changes)", async run(signal) {
      const depth = router.entries.length;
      router.goto("/__dev/screens?mode=sheet", { presentation: "sheet" });
      await pause(900, signal);
      router.back();
      await pause(600, signal);
      screenLab.appears = 0; screenLab.disappears = 0; screenLab.detents = 0;
      const { frames } = await measure(async () => {
        for (let cycle = 0; cycle < 8 && !signal.aborted; cycle++) {
          router.goto("/__dev/screens?mode=sheet", { presentation: "sheet" });
          await pause(900, signal);
          router.back();
          await pause(600, signal);
        }
      });
      return { verdict: verdict(frames, router.entries.length === depth), summary: `${describe(frames)} · stack depth ${router.entries.length} (expected ${depth}) · ${screenLab.detents} detent changes`, frames, detail: { detents: screenLab.detents } };
    } },
    { name: "tabs-8", label: "Switch between three tabs 8 times", async run(signal) {
      tabSelected = "one"; view = "tabs"; await settle();
      await pause(700, signal);
      const order = ["two", "three", "one", "three", "two", "one", "three", "two"];
      const { frames } = await measure(async () => {
        for (const key of order) {
          if (signal.aborted) break;
          tabSelected = key;
          await pause(500, signal);
        }
      });
      const ended = tabSelected;
      view = "none"; await settle();
      return { verdict: verdict(frames, ended === "two"), summary: `${describe(frames)} · ended on ${ended}`, frames };
    } },
    { name: "foreign-views", label: "Foreign views (WebView, map, video) inline, in a list row and in a sheet, with 20 mount and unmount cycles each (`run=foreign-views`)", async run(signal) {
      const { frames, value } = await measure(() => runForeignViews(router, signal));
      return { verdict: value.passed ? "pass" : "fail", summary: `${value.summary} · ${describe(frames)}`, frames, detail: value.detail };
    } },
    { name: "foreign-libraries", label: "Native-view libraries (thirteen) inline, in a list row and in a sheet: mounts, prop updates, events, commands, pixels of a capture (`run=foreign-libraries`, `only:<library>.<library>` after it narrows it)", async run(signal) {
      const value = await runForeignLibraries(router, signal, foreignOnly);
      return { verdict: value.passed ? "pass" : "fail", summary: value.summary, detail: value.detail };
    } },
    { name: "foreign-leftovers", label: "Capture files of the previous launch are gone (`run=foreign-leftovers`, the launch after `foreign-libraries`)", async run() {
      const value = await runForeignLeftovers();
      return { verdict: value.passed ? "pass" : "fail", summary: value.summary, detail: value.detail };
    } },
    { name: "smoke", label: "Native modules (smoke test) · one core call for each library the production app links, from Svelte Native without React (`run=smoke`, SPEC.md \"Native modules (smoke test)\")", async run(signal) {
      // Required here, not at the top: the libraries load when the scenario runs, and only the smoke app links them.
      if (!nativeSmokeEnabled) return { verdict: "info", summary: "Not linked in this build: the native module smoke test runs in the smoke app (io.rasheed.svelteqa.smoke)." };
      const { runSmoke, smokeModules } = await import("./smoke.ts");
      const results = await runSmoke(undefined, signal);
      const { verdict, summary } = smokeScenarioOutcome(results, smokeModules.length);
      return { verdict, summary, detail: { results: results.map(({ module, status, path }) => ({ module, status, path })) } };
    } },
    { name: "churn-60s", label: "Cleanup stress · 60 s animated churn", run: (signal) => animatedChurn(signal, 60000) },
    { name: "soak-120s", label: "Soak · 120 s animated churn with heap sampling", async run(signal) {
      const before = heapBytes();
      const { frames, value } = await measure(() => churn(signal, true, 120000));
      await pause(1500);
      const after = heapBytes();
      return { verdict: cleanupPassed(value) ? "info" : "fail", summary: `${describe(frames)} · JS heap ${megabytes(before)} → ${megabytes(after)} · ${value.rounds} rounds · cleanup ${cleanupPassed(value) ? "ok" : "FAILED"}`, frames, detail: { ...value, heapBefore: before, heapAfter: after } };
    } },
    { name: "crash-js", label: "Uncaught error from a timer · a release build crashes with a JavaScript stack, for qa/soak/symbolicate.ts (never part of a suite)", async run(signal) {
      setTimeout(() => { throw new Error("qa crash-js: uncaught error from a timer"); }, 50);
      await pause(2000, signal);
      return { verdict: "fail", summary: "The app should have crashed with a JavaScript fatal." };
    } },
    { name: "soak-mix", label: "Soak · animated churn, navigation, modal, sheet, header screens, virtual list and tabs in turn, sampled for qa/soak (`run=soak-mix-<seconds>s`, parts named after dots: `.churn.static.nav.modal.sheet.header.list.tabs`)", async run(signal) {
      const since = Date.now();
      const depth = router.entries.length;
      const warmupCycles = 2;
      const CHECKPOINT_MS = 120_000;
      let lastCheckpoint = Date.now();
      let cycle = 0;
      let cleanupFailures = 0;
      let created = 0; let destroyed = 0; let changesAfterDestroy = 0; let lateCompletions = 0;
      // Idle samples of the two states the heap growth compares: after the warm-up cycles, and after the last unmount.
      const idle = async (phase: "baseline" | "checkpoint" | "final") => {
        view = "none"; tiles = []; rows = []; modalVisible = false; await settle();
        await pause(1500, signal);
        for (let sample = 0; sample < 3 && !signal.aborted; sample++) {
          await soakSample(phase, since, cycle, await collectGarbage());
          await pause(2000, signal);
        }
      };
      await soakSample("start", since, 0);
      const ticker = setInterval(() => { void soakSample("sample", since, cycle); }, 5000);
      try {
        while (!signal.aborted && (cycle < warmupCycles || Date.now() - since < soakSeconds * 1000)) {
          if (soakParts.has("churn")) {
            const report = await churn(signal, true, 6000, true);
            if (!cleanupPassed(report)) cleanupFailures++;
            created += report.created; destroyed += report.destroyed; changesAfterDestroy += report.changesAfterDestroy; lateCompletions += report.lateCompletions;
          }
          if (soakParts.has("static")) await churn(signal, false, 6000, false);
          if (soakParts.has("nav")) for (let push = 0; push < 2 && !signal.aborted; push++) { router.goto("/__dev/screen?header=none"); await pause(700, signal); router.back(); await pause(700, signal); }
          if (soakParts.has("modal")) {
            view = "modal"; await settle();
            for (let open = 0; open < 2 && !signal.aborted; open++) { modalVisible = true; await pause(600, signal); modalVisible = false; await pause(500, signal); }
            view = "none"; await settle();
          }
          if (soakParts.has("sheet")) {
            router.goto("/__dev/screens?mode=sheet", { presentation: "sheet" }); await pause(900, signal);
            router.back(); await pause(600, signal);
          }
          if (soakParts.has("header")) {
            router.goto("/__dev/screens?mode=header&depth=1"); await pause(700, signal);
            router.goto("/__dev/screens?mode=header&depth=2"); await pause(700, signal);
            router.back(); await pause(600, signal);
            router.back(); await pause(600, signal);
          }
          if (soakParts.has("list")) {
            view = "virtual-list"; rows = []; await settle();
            rows = Array.from({ length: 300 }, (_, index) => index); await tick(); await pause(400, signal);
            virtualList?.scrollToIndex(299, true); await pause(800, signal);
            virtualList?.scrollToIndex(0, true); await pause(800, signal);
            rows = []; await settle(); view = "none"; await settle();
          }
          if (soakParts.has("tabs")) {
            tabSelected = "one"; view = "tabs"; await settle(); await pause(500, signal);
            for (const key of ["two", "three", "one"]) { tabSelected = key; await pause(500, signal); }
            view = "none"; await settle();
          }
          cycle++;
          status = `${running} · ${Math.floor((Date.now() - since) / 1000)} / ${soakSeconds} s · cycle ${cycle}`;
          if (cycle === warmupCycles) { await idle("baseline"); lastCheckpoint = Date.now(); }
          // An idle window every two minutes in between: the floor of the heap over time says whether a growth keeps rising (a leak) or levels off (allocator and caches).
          else if (cycle > warmupCycles && Date.now() - lastCheckpoint >= CHECKPOINT_MS && Date.now() - since < (soakSeconds - 30) * 1000) { await idle("checkpoint"); lastCheckpoint = Date.now(); }
        }
        await idle("final");
      } finally {
        clearInterval(ticker);
      }
      const clean = cleanupFailures === 0 && created === destroyed && router.entries.length === depth;
      return { verdict: clean ? "info" : "fail", summary: `${cycle} cycles in ${((Date.now() - since) / 1000).toFixed(0)} s · ${created} tiles mounted / ${destroyed} destroyed · ${changesAfterDestroy} values changed after destruction · stack depth ${router.entries.length} (expected ${depth}) · cleanup ${clean ? "ok" : "FAILED"}`, detail: { cycles: cycle, created, destroyed, changesAfterDestroy, lateCompletions, cleanupFailures } };
    } },
    ...gestureSpecs.map((spec): Scenario => ({ name: spec.name, label: `Gestures · ${spec.label} (\`run=${spec.name}\`, with \`drive:adb\`, \`drive:qa\` or \`drive:xctest\` after it in the run list)`, run: (signal) => gestureScenario(spec, signal) })),
  ];
  const quick = scenarios.filter((scenario) => !["warm-up", "input-typing", "foreign-views", "foreign-libraries", "foreign-leftovers", "smoke", "churn-60s", "soak-120s", "soak-mix", "crash-js", "list-300-virtual-profile", "list-mount-loop", "list-mount-hermes"].includes(scenario.name) && !scenario.name.startsWith("gestures-"));
  const ordered = $derived(scenarios.flatMap((scenario) => results.filter((result) => result.name === scenario.name)));

  function record(result: Result) {
    results = [...results.filter((existing) => existing.name !== result.name), result];
    console.info("[Svelte stress]", JSON.stringify({ ...result, periodMs: period }));
    onResult?.($state.snapshot(results), false);
  }
  async function run(selected: Scenario[]) {
    if (running) return;
    const abort = new AbortController();
    controller = abort;
    const warmup = scenarios[0];
    const idle = scenarios[1];
    if (!calibrated && idle && !selected.includes(idle)) selected = [idle, ...selected];
    if (!warmed && warmup && !selected.includes(warmup)) selected = [warmup, ...selected];
    for (const scenario of selected) {
      if (abort.signal.aborted) break;
      running = scenario.name;
      status = `Running ${scenario.label}…`;
      try {
        const result = await scenario.run(abort.signal);
        if (!live) return;
        record(abort.signal.aborted ? { name: scenario.name, verdict: "info", summary: "Stopped before completion." } : { name: scenario.name, ...result });
      } catch (error) {
        if (!live) return;
        record({ name: scenario.name, verdict: "fail", summary: `Error · ${error instanceof Error ? error.message : String(error)}` });
        console.error("[Svelte stress]", scenario.name, error);
      }
      view = "none"; tiles = []; rows = []; modalVisible = false;
    }
    status = abort.signal.aborted ? "Stopped." : "Done.";
    running = null;
    if (controller === abort) controller = undefined;
    console.info("[Svelte stress] complete", JSON.stringify({ periodMs: period, results: results.map((result) => ({ name: result.name, verdict: result.verdict })) }));
    onResult?.($state.snapshot(results), true);
  }
  onMount(() => {
    const requested = untrack(() => autorun);
    if (!requested) return;
    const parts = requested.split(",").map((name) => name.trim()).filter(Boolean);
    const drive = parts.find((name) => name.startsWith("drive:"))?.slice("drive:".length);
    const only = parts.find((name) => name.startsWith("only:"))?.slice("only:".length).split(".").filter((name): name is LibraryKind => (libraryKinds as readonly string[]).includes(name));
    if (only && only.length > 0) foreignOnly = only;
    gestureDrive = drive === "adb" || drive === "qa" || drive === "xctest" ? drive : "none";
    const names = parts.filter((name) => !name.startsWith("drive:") && !name.startsWith("only:")).map((name) => {
      const soak = /^soak-mix-(\d+)s((?:\.[a-z]+)*)$/.exec(name);
      if (!soak) return name;
      soakSeconds = Number(soak[1]);
      const parts = (soak[2] ?? "").split(".").filter(Boolean);
      const unknown = parts.filter((part) => !soakPartNames.includes(part));
      if (unknown.length) throw new Error(`soak-mix: unknown part ${unknown.join(", ")} (parts: ${soakPartNames.join(", ")})`);
      if (parts.length) soakParts = new Set(parts);
      return "soak-mix";
    });
    const selected = names.includes("quick") ? [...quick, ...scenarios.filter((scenario) => names.includes(scenario.name) && !quick.includes(scenario))] : scenarios.filter((scenario) => names.includes(scenario.name));
    const timer = setTimeout(() => { void run(selected); }, 1500);
    return () => clearTimeout(timer);
  });
  const color = (value: Verdict) => (value === "pass" ? "#22a06b" : value === "fail" ? theme.danger : theme.muted);
</script>

<Text style={{ color: theme.foreground, fontSize: 15 }}>{status}</Text>
<Text style={{ color: theme.muted, fontSize: 13 }}>Frame period {period.toFixed(2)} ms · smooth = at most 1% of intervals over {(1.5 * period).toFixed(0)} ms and none over {(4 * period).toFixed(0)} ms. Stress scenarios ignore reduced motion and only change local test state.</Text>
<Button label={running ? `Running ${running}…` : "Run all quick scenarios · about 2 minutes"} onPress={() => run(quick)} disabled={!!running} />
{#if running}<Button label="Stop" variant="secondary" onPress={() => controller?.abort()} />{/if}
<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
  {#each scenarios as scenario (scenario.name)}
    <Button label={scenario.name} variant="secondary" onPress={() => run([scenario])} disabled={!!running} />
  {/each}
</View>
{#each ordered as result (result.name)}
  <View style={{ gap: 4, borderLeftWidth: 3, borderLeftColor: color(result.verdict), paddingLeft: 12 }}>
    <Text style={{ color: theme.foreground, fontSize: 15 }}>{result.verdict.toUpperCase()} · {result.name}</Text>
    <Text style={{ color: theme.muted, fontSize: 13 }}>{result.summary}</Text>
  </View>
{/each}
{#snippet tabGlyph(selected: boolean)}
  <View style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: "#000000", opacity: selected ? 1 : 0.6 }} />
{/snippet}
{#snippet tabPane(tab: TabHandle)}
  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, gap: 6 }}>
    {#each Array.from({ length: 14 }, (_, index) => index) as row (row)}
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.foreground, fontSize: 14 }}>Tab {tab.key} · row {row + 1}</Text>
      </View>
    {/each}
  </ScrollView>
{/snippet}
{#if view === "tiles"}
  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 14 }}>
    {#each tiles as id (id)}<StressTile {id} animated={animatedTiles} variant={tileVariant} {completions} {mounted} {removed} />{/each}
  </View>
{:else if view === "list"}
  <ScrollView ref={(instance) => { scroller = instance; }} nestedScrollEnabled removeClippedSubviews={listClipped} style={{ height: 360, borderRadius: 12, borderWidth: 1, borderColor: theme.border }} contentContainerStyle={{ padding: 8, gap: 6 }}>
    {#each rows as row (row)}
      {#if listRaw}
        <native-view nativeProps={{ style: { padding: 10, borderRadius: 8, backgroundColor: theme.surface }, onLayout: row === rows.length - 1 ? () => rowsLaidOut?.() : undefined }}>
          <native-text nativeProps={{ style: { color: theme.foreground, fontSize: 14 } }}>Row {row + 1}</native-text>
        </native-view>
      {:else}
        <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.surface }} onLayout={row === rows.length - 1 ? () => rowsLaidOut?.() : undefined}>
          <Text style={{ color: theme.foreground, fontSize: 14 }}>Row {row + 1}</Text>
        </View>
      {/if}
    {/each}
  </ScrollView>
{:else if view === "virtual-list"}
  <List bind:this={virtualList} items={rows} rowHeight={46} keyOf={(row) => row} nestedScrollEnabled style={{ height: 360, borderRadius: 12, borderWidth: 1, borderColor: theme.border }} contentContainerStyle={{ padding: 8 }}>
    {#snippet row(row)}
      <View style={{ height: 40, padding: 10, borderRadius: 8, backgroundColor: theme.surface }} onLayout={row === 9 ? () => rowsLaidOut?.() : undefined}>
        <Text style={{ color: theme.foreground, fontSize: 14 }}>Row {row + 1}</Text>
      </View>
    {/snippet}
  </List>
{:else if view === "input"}
  <TextInput ref={(instance) => { input = instance; }} bind:value={typed} accessibilityLabel="Stress input" autoCapitalize="none" autoCorrect={false}
    style={{ minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, backgroundColor: theme.surface, color: theme.foreground, fontSize: 17 }} />
  <Text style={{ color: theme.muted, fontSize: 13 }}>{typed.length} characters</Text>
{:else if view === "tabs"}
  <View style={{ height: 420, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
    <Tabs items={tabItems} selected={tabSelected} onSelect={(key) => { tabSelected = key; }} content={tabPane} tint="#3685ff" />
  </View>
{:else if view === "modal"}
  <Modal visible={modalVisible} transparent animationType="fade" onShow={() => modalShown?.()} onRequestClose={() => { modalVisible = false; }}>
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}>
      <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 20 }}><Text style={{ color: theme.foreground }}>Stress modal</Text></View>
    </View>
  </Modal>
{/if}
