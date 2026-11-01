import { parseNavigation } from "./hmr-state.ts";

/**
 * Whether a navigation state a host kept for a process that died is still worth restoring (SPEC.md, "Navigation state across
 * recreation and process death"). Android hands the state over as `initialProps.navigation` and the system decides how long it
 * lives; iOS keeps the state in a file of its own (`modules/svelte-navigation-ios`), so the host gives JavaScript the record and
 * the age is judged here, in one place that the unit tests reach: the native side only stores and returns.
 */

/** How long a state written when the app went to the background is restored on iOS. Android has no timer: the system holds the state while the task is in Recents. */
export const navigationRestoreWindowMs = 24 * 60 * 60 * 1000;

/** A record written by a clock that is this far ahead of the one reading it comes from a phone whose clock was set back: it cannot be aged. */
export const navigationClockSkewMs = 60_000;

/** What the iOS host returns from `SvelteNavigation.restore()`: the JSON the router wrote, and the time (ms since the epoch) the app went to the background with it. */
export type NavigationRecord = { json: string; savedAt: number };

export type RestoreVerdict =
  | { json: string }
  /** `none`: the host had nothing (cold start, the user left the app, the state was used). The others are records that were not used, and why. */
  | { dropped: "none" | "malformed" | "expired" | "future" | "unreadable" };

/** Judges the host's record: the JSON the router can restore from, or the reason it is not used. `now` is `Date.now()`. */
export function freshNavigation(record: unknown, now: number, windowMs: number = navigationRestoreWindowMs): RestoreVerdict {
  if (record === null || record === undefined) return { dropped: "none" };
  if (typeof record !== "object") return { dropped: "malformed" };
  const { json, savedAt } = record as { json?: unknown; savedAt?: unknown };
  if (typeof json !== "string" || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return { dropped: "malformed" };
  const age = now - savedAt;
  if (age < -navigationClockSkewMs) return { dropped: "future" };
  if (age > windowMs) return { dropped: "expired" };
  // The router restores only what `parseNavigation` accepts; saying so here keeps a record that is no state from reaching it as one.
  return parseNavigation(json) === undefined ? { dropped: "unreadable" } : { json };
}
