<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { Text, View } from "@rasheed/svelte-native";
  import { createSharedValue, runOnUIAsync, type SharedValue } from "@rasheed/svelte-native/animation";
  import { theme } from "../state.svelte.ts";
  import Button from "../components/Button.svelte";
  import StressTile from "./StressTile.svelte";

  let running = $state(false);
  let ids = $state<number[]>([]);
  let created = $state(0);
  let destroyed = $state(0);
  let rounds = $state(0);
  let report = $state("Ready: 48 animated views, including 16 persistent views. Replace 32 keyed views every 250 ms for 60 seconds.");
  let frameReport = $state("Performance has not been measured. Goal: at least 99% of UI frame intervals within 17 ms, with no gap over 50 ms.");
  let framePassed = $state<boolean>();
  const handles = new SvelteMap<number, SharedValue<number>>();
  const completions = createSharedValue(0);
  const sampling = createSharedValue(false);
  const frameRequest = createSharedValue(0);
  const frames = createSharedValue({ started: 0, firstFrame: 0, lastFrame: 0, last: 0, count: 0, max: 0, overBudget: 0, histogram: Array.from({ length: 201 }, () => 0) });
  function recordInterval(timestamp: number, isFrame: boolean) {
    "worklet";
    frames.modify((value) => {
      "worklet";
      const delta = timestamp - value.last;
      if (delta > 0) {
        value.count++;
        value.max = Math.max(value.max, delta);
        if (delta > 17) value.overBudget++;
        value.histogram[Math.min(200, Math.ceil(delta))]++;
      }
      if (isFrame) {
        if (!value.firstFrame) value.firstFrame = timestamp;
        value.lastFrame = timestamp;
      }
      value.last = timestamp;
      return value;
    });
  }
  function frame() {
    "worklet";
    if (!sampling.value) return;
    recordInterval(Date.now(), true);
    frameRequest.value = requestAnimationFrame(frame);
  }
  function startFrames(started: number) {
    "worklet";
    cancelAnimationFrame(frameRequest.value);
    frames.value = { started, firstFrame: 0, lastFrame: 0, last: started, count: 0, max: 0, overBudget: 0, histogram: Array.from({ length: 201 }, () => 0) };
    sampling.value = true;
    frameRequest.value = requestAnimationFrame(frame);
  }
  function stopFrames() {
    "worklet";
    const wasSampling = sampling.value;
    sampling.value = false;
    cancelAnimationFrame(frameRequest.value);
    if (wasSampling) recordInterval(Date.now(), false);
    return frames.value;
  }
  let controller: AbortController | undefined;
  let live = true;
  onDestroy(() => {
    live = false; controller?.abort();
    sampling.value = false;
    void runOnUIAsync(stopFrames).catch((error: unknown) => console.error("[Svelte frame monitor]", error));
  });
  function mounted(id: number, value: SharedValue<number>) { handles.set(id, value); created++; }
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
  async function run() {
    if (running) return;
    running = true;
    const abort = new AbortController();
    controller = abort;
    created = 0; destroyed = 0; rounds = 0; completions.value = 0;
    framePassed = undefined;
    frameReport = "Measuring UI frame intervals…";
    let nextId = 48;
    let changesAfterDestroy = 0;
    let retired: SharedValue<number>[] = [];
    let frozen: number[] = [];
    ids = Array.from({ length: 48 }, (_, index) => index);
    await tick();
    const start = Date.now();
    try {
      await runOnUIAsync(startFrames, start);
      while (Date.now() - start < 60_000 && !abort.signal.aborted) {
        await pause(250, abort.signal);
        if (abort.signal.aborted) break;
        const current = await sample(retired);
        changesAfterDestroy += current.filter((value, index) => Math.abs(value - frozen[index]) > 0.000001).length;
        retired = [...handles].filter(([id]) => id >= 16).map(([, value]) => value);
        ids = [...Array.from({ length: 16 }, (_, index) => index), ...Array.from({ length: 32 }, () => nextId++)];
        await tick();
        frozen = await sample(retired);
        rounds++;
        report = `Running · ${Math.floor((Date.now() - start) / 1000)} / 60 seconds`;
      }
      const remaining = [...handles.values()];
      ids = [];
      await tick();
      const stopped = await sample(remaining);
      const completedBefore = completions.value;
      await pause(300);
      if (!live) return;
      const after = await sample(remaining);
      const timing = await runOnUIAsync(stopFrames);
      let accumulated = 0;
      const p95 = timing.histogram.findIndex((count) => { accumulated += count; return accumulated >= timing.count * 0.95; });
      const overBudget = timing.count ? timing.overBudget / timing.count : 1;
      if (!abort.signal.aborted) {
        const coverage = timing.lastFrame - timing.firstFrame;
        const complete = timing.last - timing.started >= 60_000 && coverage >= 59_900;
        framePassed = complete && timing.count > 0 && overBudget <= 0.01 && timing.max <= 50;
        frameReport = `Performance ${framePassed ? "passed" : "FAILED"} · ${(coverage / 1000).toFixed(1)} s sampled · ${timing.count} UI intervals · p95 ${p95 >= 200 ? "≥200" : p95} ms · worst gap ${timing.max.toFixed(1)} ms · ${(overBudget * 100).toFixed(1)}% over 17 ms${complete ? "" : " · incomplete coverage"}`;
      } else frameReport = "Stopped before completion; no performance verdict.";
      changesAfterDestroy += after.filter((value, index) => Math.abs(value - stopped[index]) > 0.000001).length;
      const passed = changesAfterDestroy === 0 && created === destroyed && completedBefore > 0 && completions.value === completedBefore;
      report = `${abort.signal.aborted ? "Stopped" : passed ? "Cleanup passed" : "Cleanup FAILED"} · ${Date.now() - start} ms · ${created} mounted / ${destroyed} destroyed · ${rounds} replacements · ${completedBefore} completed timing segments · ${changesAfterDestroy} values changed after destruction`;
      console.info("[Svelte animation stress]", report, frameReport);
    } catch (error) {
      ids = [];
      if (live) {
        report = `FAIL · ${error instanceof Error ? error.message : String(error)}`;
        framePassed = false;
        frameReport = "Performance FAILED · the frame monitor did not complete.";
      }
      console.error("[Svelte animation stress]", error);
    } finally {
      sampling.value = false;
      try { await runOnUIAsync(stopFrames); }
      catch (error) { console.error("[Svelte frame monitor cleanup]", error); }
      if (live) running = false;
      if (controller === abort) controller = undefined;
    }
  }
</script>

<Text style={{ color: theme.foreground, fontSize: 15 }}>{report}</Text>
<Text style={{ color: framePassed === false ? theme.danger : theme.muted, fontSize: 15 }}>{frameReport}</Text>
<Text style={{ color: theme.muted, fontSize: 14 }}>Mounted {created} · destroyed {destroyed} · rounds {rounds}</Text>
<Text style={{ color: theme.muted, fontSize: 14 }}>This explicit stress test ignores reduced motion. It only changes local test state.</Text>
<Button label={running ? "Running stress…" : "Run Svelte animation stress · 60 seconds"} onPress={run} disabled={running} />
{#if running}<Button label="Stop stress" variant="secondary" onPress={() => controller?.abort()} />{/if}
<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 14 }}>
  {#each ids as id (id)}<StressTile {id} {completions} {mounted} {removed} />{/each}
</View>
