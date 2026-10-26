import { runOnUIAsync } from "@rasheed/svelte-native/animation";

/** UI-runtime frame intervals, bucketed by whole milliseconds up to 200 ms. */
export type FrameStats = {
  started: number; stopped: number; firstFrame: number; lastFrame: number;
  count: number; max: number; histogram: number[];
};
export type FrameSummary = {
  periodMs: number; durationMs: number; coverageMs: number; count: number;
  p50: number; p95: number; p99: number; max: number; droppedPct: number; smooth: boolean;
};
type Store = FrameStats & { active: boolean; last: number; request: number };

function store(): Store {
  "worklet";
  const scope = globalThis as unknown as { __svelteFrameMonitor?: Store };
  if (!scope.__svelteFrameMonitor) {
    scope.__svelteFrameMonitor = { active: false, last: 0, request: 0, started: 0, stopped: 0, firstFrame: 0, lastFrame: 0, count: 0, max: 0, histogram: [] };
  }
  return scope.__svelteFrameMonitor;
}
function record(timestamp: number, isFrame: boolean) {
  "worklet";
  const state = store();
  const delta = timestamp - state.last;
  if (delta > 0) {
    state.count++;
    if (delta > state.max) state.max = delta;
    state.histogram[Math.min(200, Math.ceil(delta))]++;
  }
  if (isFrame) {
    if (!state.firstFrame) state.firstFrame = timestamp;
    state.lastFrame = timestamp;
  }
  state.last = timestamp;
}
function frame() {
  "worklet";
  const state = store();
  if (!state.active) return;
  record(Date.now(), true);
  state.request = requestAnimationFrame(frame);
}
function start(started: number) {
  "worklet";
  const state = store();
  cancelAnimationFrame(state.request);
  state.active = true;
  state.started = started;
  state.stopped = 0;
  state.last = started;
  state.firstFrame = 0;
  state.lastFrame = 0;
  state.count = 0;
  state.max = 0;
  state.histogram = new Array(201).fill(0);
  state.request = requestAnimationFrame(frame);
}
function stop(): FrameStats {
  "worklet";
  const state = store();
  const wasActive = state.active;
  state.active = false;
  cancelAnimationFrame(state.request);
  if (wasActive) record(Date.now(), false);
  state.stopped = Date.now();
  return { started: state.started, stopped: state.stopped, firstFrame: state.firstFrame, lastFrame: state.lastFrame, count: state.count, max: state.max, histogram: state.histogram.slice() };
}

/** Samples every UI-runtime frame from now until `stopFrameMonitor`. The accumulator lives on the UI runtime; nothing crosses threads per frame. */
export const startFrameMonitor = (): Promise<void> => runOnUIAsync(start, Date.now());
export const stopFrameMonitor = (): Promise<FrameStats> => runOnUIAsync(stop);

function quantile(histogram: number[], count: number, q: number): number {
  let accumulated = 0;
  for (let bucket = 0; bucket < histogram.length; bucket++) {
    accumulated += histogram[bucket] ?? 0;
    if (accumulated >= count * q) return bucket;
  }
  return histogram.length - 1;
}

/** The display's frame period from an idle sample, snapped to 120, 90 or 60 Hz when within a millisecond. */
export function estimatePeriod(stats: FrameStats): number {
  const median = quantile(stats.histogram, stats.count, 0.5);
  return [1000 / 120, 1000 / 90, 1000 / 60].find((period) => Math.abs(period - median) <= 1) ?? median;
}

/** Smooth: at most 1% of intervals longer than 1.5 frame periods (a dropped frame) and no gap over 4 periods. */
export function summarizeFrames(stats: FrameStats, periodMs: number): FrameSummary {
  const dropped = stats.histogram.reduce((sum, value, bucket) => (bucket > 1.5 * periodMs ? sum + value : sum), 0);
  const droppedPct = stats.count ? (100 * dropped) / stats.count : 100;
  return {
    periodMs,
    durationMs: stats.stopped - stats.started,
    coverageMs: stats.lastFrame - stats.firstFrame,
    count: stats.count,
    p50: quantile(stats.histogram, stats.count, 0.5),
    p95: quantile(stats.histogram, stats.count, 0.95),
    p99: quantile(stats.histogram, stats.count, 0.99),
    max: stats.max,
    droppedPct,
    smooth: stats.count > 0 && droppedPct <= 1 && stats.max <= 4 * periodMs,
  };
}
