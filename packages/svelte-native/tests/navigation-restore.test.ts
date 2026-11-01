import { describe, expect, test } from "bun:test";
import { droppedReasons, freshNavigation, navigationAttemptsAllowed, navigationClockSkewMs, navigationRestoreWindowMs } from "../src/navigation-restore.ts";

const state = JSON.stringify({ stack: { entries: [{ route: "r1", href: "/acme", presentation: "push" }, { href: "/account", presentation: "modal" }] }, launch: "rasheed://acme" });
const now = Date.UTC(2026, 10, 1, 12, 0, 0);
const minute = 60_000;

describe("freshNavigation: whether the state an iOS host kept for a dead process is restored", () => {
  test("a state written when the app went to the background, read soon after, is restored as it was", () => {
    expect(freshNavigation({ json: state, savedAt: now - 5 * minute }, now)).toEqual({ json: state });
    expect(freshNavigation({ json: state, savedAt: now }, now)).toEqual({ json: state });
  });

  test("the window is a day: one that old is still used, one a millisecond older is not", () => {
    expect(navigationRestoreWindowMs).toBe(24 * 60 * minute);
    expect(freshNavigation({ json: state, savedAt: now - navigationRestoreWindowMs }, now)).toEqual({ json: state });
    expect(freshNavigation({ json: state, savedAt: now - navigationRestoreWindowMs - 1 }, now)).toEqual({ dropped: "expired" });
    expect(freshNavigation({ json: state, savedAt: now - 3 * navigationRestoreWindowMs }, now)).toEqual({ dropped: "expired" });
  });

  test("the window can be chosen by the caller", () => {
    expect(freshNavigation({ json: state, savedAt: now - 11 * minute }, now, 10 * minute)).toEqual({ dropped: "expired" });
    expect(freshNavigation({ json: state, savedAt: now - 9 * minute }, now, 10 * minute)).toEqual({ json: state });
  });

  test("a clock that was set back cannot age a record: more than a minute in the future is dropped, a little is skew", () => {
    expect(freshNavigation({ json: state, savedAt: now + navigationClockSkewMs }, now)).toEqual({ json: state });
    expect(freshNavigation({ json: state, savedAt: now + navigationClockSkewMs + 1 }, now)).toEqual({ dropped: "future" });
  });

  test("the system's say: a process the user ended is not restored, one it ended is; a host that does not say is believed", () => {
    expect(freshNavigation({ json: state, savedAt: now, systemKept: true }, now)).toEqual({ json: state });
    expect(freshNavigation({ json: state, savedAt: now, systemKept: false }, now)).toEqual({ dropped: "user" });
    expect(freshNavigation({ json: state, savedAt: now }, now)).toEqual({ json: state });
    // The user's say outranks the age, as it does for a task removed from Recents.
    expect(freshNavigation({ json: state, savedAt: now - 2 * navigationRestoreWindowMs, systemKept: false }, now)).toEqual({ dropped: "user" });
  });

  test("a restore that dies on the way is tried twice and then dropped, so it cannot loop", () => {
    expect(navigationAttemptsAllowed).toBe(2);
    for (const attempts of [0, 1, 2]) expect(freshNavigation({ json: state, savedAt: now, attempts, systemKept: true }, now)).toEqual({ json: state });
    expect(freshNavigation({ json: state, savedAt: now, attempts: 3, systemKept: true }, now)).toEqual({ dropped: "attempts" });
  });

  test("every reason a record is dropped for is one the host can write down", () => {
    for (const reason of ["malformed", "user", "updated", "attempts", "expired", "future", "unreadable"] as const) expect(droppedReasons[reason].length).toBeGreaterThan(10);
    expect(Object.keys(droppedReasons).sort()).toEqual(["attempts", "expired", "future", "malformed", "unreadable", "updated", "user"]);
  });

  describe("the build that saved the state is the build that restores it", () => {
    const saved = { json: state, savedAt: now, systemKept: true };

    test("the same build and the same OTA update restore, embedded or not", () => {
      expect(freshNavigation({ ...saved, build: "41", runningBuild: "41", update: null }, now)).toEqual({ json: state });
      expect(freshNavigation({ ...saved, build: "41", runningBuild: "41", update: "ab12" }, now, undefined, "ab12")).toEqual({ json: state });
    });

    test("another build (the store installed a new version) drops the state as updated", () => {
      expect(freshNavigation({ ...saved, build: "41", runningBuild: "42", update: null }, now)).toEqual({ dropped: "updated" });
      // a record written before the host stored the build cannot be told from another build's: the build is the host's to vouch for
      expect(freshNavigation({ ...saved, runningBuild: "42" }, now)).toEqual({ dropped: "updated" });
    });

    test("another OTA update (the app was updated over the air since) drops it, to or from the embedded bundle too", () => {
      expect(freshNavigation({ ...saved, build: "41", runningBuild: "41", update: "ab12" }, now, undefined, "cd34")).toEqual({ dropped: "updated" });
      expect(freshNavigation({ ...saved, build: "41", runningBuild: "41", update: "ab12" }, now, undefined, null)).toEqual({ dropped: "updated" });
      expect(freshNavigation({ ...saved, build: "41", runningBuild: "41", update: null }, now, undefined, "cd34")).toEqual({ dropped: "updated" });
    });

    test("the user's say comes first, and a host that reports no build identity is not asked for one", () => {
      expect(freshNavigation({ ...saved, systemKept: false, build: "41", runningBuild: "42" }, now)).toEqual({ dropped: "user" });
      expect(freshNavigation({ ...saved }, now)).toEqual({ json: state });
    });
  });

  test("the host having nothing is not a fault: a cold start, the user leaving, a state that was used", () => {
    expect(freshNavigation(null, now)).toEqual({ dropped: "none" });
    expect(freshNavigation(undefined, now)).toEqual({ dropped: "none" });
  });

  test("anything that is not a record of a JSON text and a time is malformed", () => {
    for (const record of ["text", 7, true, [], {}, { json: state }, { savedAt: now }, { json: 5, savedAt: now }, { json: state, savedAt: "now" }, { json: state, savedAt: Number.NaN }, { json: state, savedAt: Number.POSITIVE_INFINITY }])
      expect(freshNavigation(record, now)).toEqual({ dropped: "malformed" });
  });

  test("a JSON text the router cannot read is dropped before it reaches the router", () => {
    for (const json of ["", "not json", "{}", "{\"stack\":{}}", "{\"stack\":{\"entries\":7}}", "[]", "null"])
      expect(freshNavigation({ json, savedAt: now }, now)).toEqual({ dropped: "unreadable" });
  });
});
