/**
 * What the Fabric host does for OTA updates, kept small because the host loads it on every start:
 *  - at load, when the app runs a downloaded update, image sources resolve to the update's files (`assets.ts`);
 *  - `onFirstCommit` tells the native store the launch worked, so the next start does not treat it as a failed launch, and
 *    starts the background check the build asked for. The check's code (protocol client, parser) loads only then.
 * The host calls `onFirstCommit()` right after `mark("first commit")` in `startSurface`.
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

export function onFirstCommit(): void {
  if (!active) return;
  active.markLaunched().catch((error: unknown) => console.warn("[Svelte updates] could not record the launch", error));
  if (active.checkOnLaunch !== "ALWAYS") return;
  later(() => { void (require("./index.ts") as typeof import("./index.ts")).checkOnLaunch(); });
}
/* eslint-enable @typescript-eslint/no-require-imports */
