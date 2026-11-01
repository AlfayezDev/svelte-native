import { describe, expect, test } from "bun:test";
import { freshNavigation, navigationClockSkewMs, navigationRestoreWindowMs } from "../src/navigation-restore.ts";

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
