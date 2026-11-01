import { parseNavigation } from "./hmr-state.ts";

/**
 * Whether a navigation state a host kept for a process that died is worth restoring (SPEC.md, "Navigation state across
 * recreation and process death"). Android hands the state over as `initialProps.navigation` and the system decides how long it
 * lives and whether the user removed the task; iOS keeps the state in a file of its own (`modules/svelte-navigation-ios`), so the host
 * gives JavaScript the record with what only it knows (whether the system offered its own state) and the policy is here, in one place
 * that the unit tests reach: the native side only stores and returns.
 */

/** How long a state written when the app went to the background is restored on iOS. Android has no timer: the system holds the state while the task is in Recents. */
export const navigationRestoreWindowMs = 24 * 60 * 60 * 1000;

/** A record written by a clock that is this far ahead of the one reading it comes from a phone whose clock was set back: it cannot be aged. */
export const navigationClockSkewMs = 60_000;

/** A state handed over this many times without a start that finished (`restored`) is dropped, so a restore that crashes cannot loop: UIKit's own rule for its restoration. */
export const navigationAttemptsAllowed = 2;

/**
 * What the iOS host returns from `SvelteNavigation.restore()`: the JSON the router wrote, the time (ms since the epoch) the app went to the background
 * with it, how many times it has been handed over (this one included) and whether UIKit offered its own restoration state at this launch, which it
 * does for a process the system ended and not for one the user swiped away.
 */
export type NavigationRecord = { json: string; savedAt: number; attempts?: number; systemKept?: boolean };

export type Dropped = "none" | "malformed" | "user" | "attempts" | "expired" | "future" | "unreadable";

export type RestoreVerdict =
  | { json: string }
  /** `none`: the host had nothing (cold start, a state that was used, a crash in the foreground). The others are records that were not used, and why. */
  | { dropped: Dropped };

/** What the host writes down (`last.json`) about a record that was not used. */
export const droppedReasons: Record<Exclude<Dropped, "none">, string> = {
  malformed: "the host's record is not a JSON text and a time",
  user: "the system kept no state of its own (the user left the app)",
  attempts: `handed over ${navigationAttemptsAllowed} times without a start that finished`,
  expired: "older than the restore window",
  future: "written by a clock that is ahead of this one",
  unreadable: "the JSON is not a navigation state",
};

/** Judges the host's record: the JSON the router can restore from, or the reason it is not used. `now` is `Date.now()`. */
export function freshNavigation(record: unknown, now: number, windowMs: number = navigationRestoreWindowMs): RestoreVerdict {
  if (record === null || record === undefined) return { dropped: "none" };
  if (typeof record !== "object") return { dropped: "malformed" };
  const { json, savedAt, attempts, systemKept } = record as { json?: unknown; savedAt?: unknown; attempts?: unknown; systemKept?: unknown };
  if (typeof json !== "string" || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return { dropped: "malformed" };
  // The user ended the process, or the system never saved: Android drops the state of a task the user removed, so does this.
  if (systemKept === false) return { dropped: "user" };
  if (typeof attempts === "number" && attempts > navigationAttemptsAllowed) return { dropped: "attempts" };
  const age = now - savedAt;
  if (age < -navigationClockSkewMs) return { dropped: "future" };
  if (age > windowMs) return { dropped: "expired" };
  // The router restores only what `parseNavigation` accepts; saying so here keeps a record that is no state from reaching it as one.
  return parseNavigation(json) === undefined ? { dropped: "unreadable" } : { json };
}
