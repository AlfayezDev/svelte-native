import { requireOptionalNativeModule } from "expo-modules-core";
import { nativeLabEnabled } from "#lib/native/state.svelte.ts";

/**
 * What `native-qa updates` plants in the bundles it publishes with `eas update`. The harness sets `EXPO_PUBLIC_QA_UPDATE_MARKER` (a label
 * the app reports back, so a run can tell which published bundle executes) and, for the update that must fail, `EXPO_PUBLIC_QA_UPDATE_FAULT=boot`.
 * Metro inlines both while it bundles; a normal build has neither, and only the QA app (`nativeLabEnabled`) reads them.
 */
export const updateMarker: string | null = nativeLabEnabled ? (process.env.EXPO_PUBLIC_QA_UPDATE_MARKER || null) : null;

// A bundle that cannot boot: the throw happens while the bundle loads, before the first commit, so the updates store never sees the launch succeed.
if (nativeLabEnabled && process.env.EXPO_PUBLIC_QA_UPDATE_FAULT === "boot") throw new Error(`QA update fault: bundle ${updateMarker ?? "unmarked"} throws while it loads`);

type UpdatesModule = {
  isEnabled: boolean;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  createdAt: number;
  runtimeVersion: string | null;
  checkOnLaunch: string;
  requestHeaders: Record<string, string>;
};

/** Which bundle runs and how the build is set up to update, as the `SvelteUpdates` module reports it. */
export function updateReport() {
  const native = requireOptionalNativeModule<UpdatesModule>("SvelteUpdates");
  return {
    enabled: native?.isEnabled === true,
    updateId: native?.updateId ?? null,
    embedded: native?.isEmbeddedLaunch ?? true,
    createdAt: native?.createdAt ?? null,
    runtimeVersion: native?.runtimeVersion ?? null,
    channel: native?.requestHeaders["expo-channel-name"] ?? null,
    checkOnLaunch: native?.checkOnLaunch ?? null,
    marker: updateMarker,
  };
}

/** One line for the harness, a single string so logcat keeps it whole. */
export function logUpdateReport(): void {
  console.log(`[Svelte QA updates] ${JSON.stringify(updateReport())}`);
}
