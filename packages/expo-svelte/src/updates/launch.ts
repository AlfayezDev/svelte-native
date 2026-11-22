/**
 * What the Fabric host does for OTA updates, kept small because the host loads it on every start:
 *  - at load, when the app runs a downloaded update, image sources resolve to the update's files (`assets.ts`);
 *  - `onFirstCommit` confirms the launch to the native store (`markLaunched`: the store forgets its launch marker, so the next start
 *    does not count this one as unconfirmed) once the host has been healthy for a window, and starts the background check the
 *    build asked for. The check's code (protocol client, parser) loads only then.
 * The host calls `onFirstCommit()` right after `mark("first commit")` in `startSurface`.
 *
 * Why not at the first commit: Svelte runs `onMount` and effects in a microtask after it, so a bundle whose layout throws there has
 * already "committed", and confirming at once would make the bad update the one the next start launches again, for good. The window
 * is the first commit, the first idle callback, and `HEALTHY_WINDOW_MS` since the first commit, with no fatal error seen by the
 * global handler in between. It is the time in which the first screen's own effects, timers and first requests run and fail; short
 * enough that a user who leaves the app within seconds leaves the launch unconfirmed, which the store forgives once (a second
 * unconfirmed launch in a row, or a fatal the native host recorded, fails the update).
 */
import { mark } from "../boot-marks.ts";
import { createAssetTransformer } from "./assets.ts";
import { loadNative } from "./device.ts";

const native = loadNative();
const active = native?.isEnabled === true ? native : null;

/* eslint-disable @typescript-eslint/no-require-imports -- loaded on first use, as the rest of the host's lazy dependencies */
if (active && !active.isEmbeddedLaunch) {
  const resolveAssetSource = (require("react-native/Libraries/Image/resolveAssetSource") as {
    default: { pickScale(scales: number[], deviceScale: number): number; setCustomSourceTransformer(transformer: (resolver: never) => unknown): void };
  }).default;
  const pixelRatio = (require("react-native/Libraries/Utilities/PixelRatio") as { default: { get(): number } }).default;
  resolveAssetSource.setCustomSourceTransformer(createAssetTransformer({
    localAssets: active.localAssets,
    platform: active.platform,
    pickScale: (scales) => resolveAssetSource.pickScale(scales, pixelRatio.get()),
  }) as (resolver: never) => unknown);
}

mark("updates");

const later = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void) => unknown }).requestIdleCallback;
  if (idle) idle(task);
  else setTimeout(task, 0);
};

/** How long after the first commit a launch must stay healthy before it is confirmed. */
export const HEALTHY_WINDOW_MS = 3000;

function confirmLaunch(launched: typeof active & object): void {
  const started = Date.now();
  later(() => {
    setTimeout(() => {
      // `init.ts` sets this in the global error handler: a fatal after the first commit means the launch failed, whatever the host does next.
      if ((globalThis as { __svelteFatalSeen?: boolean }).__svelteFatalSeen) return;
      launched.markLaunched().catch((error: unknown) => console.warn("[Svelte updates] could not record the launch", error));
    }, Math.max(0, HEALTHY_WINDOW_MS - (Date.now() - started)));
  });
}

export function onFirstCommit(): void {
  if (!active) return;
  confirmLaunch(active);
  if (active.checkOnLaunch !== "ALWAYS") return;
  later(() => { void (require("./index.ts") as typeof import("./index.ts")).checkOnLaunch(); });
}
/* eslint-enable @typescript-eslint/no-require-imports */
