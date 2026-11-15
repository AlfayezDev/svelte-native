// `navigator.geolocation` and `navigator.permissions` (`src/geolocation.ts`) against a stand-in for expo-location's native module that records what it was asked.
import { describe, expect, test } from "bun:test";
import { Geolocation, GeolocationCoordinates, GeolocationPosition, GeolocationPositionError, Permissions, PermissionStatus, permissionState, type NativeLocationModule } from "../../src/geolocation.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Permission = { status: "granted" | "denied" | "undetermined"; granted: boolean; canAskAgain: boolean };
const GRANTED: Permission = { status: "granted", granted: true, canAskAgain: true };
const UNDETERMINED: Permission = { status: "undetermined", granted: false, canAskAgain: true };
const DENIED: Permission = { status: "denied", granted: false, canAskAgain: false };

const fix = (latitude: number, longitude: number, extra: Record<string, unknown> = {}, timestamp = Date.now()) => ({
  coords: { latitude, longitude, altitude: 612, accuracy: 5, altitudeAccuracy: 3, heading: 90, speed: 1.5, ...extra },
  timestamp,
});

function fake(options: { permission?: Permission; answer?: Permission; position?: () => Promise<any>; lastKnown?: any; watch?: (id: number) => Promise<void> } = {}) {
  const calls: string[] = [];
  let permission = options.permission ?? UNDETERMINED;
  const listeners = new Map<number, { event: string; listener: (event: any) => void }>();
  let nextListener = 0;
  const native: NativeLocationModule & { permission: Permission } = {
    get permission() { return permission; },
    set permission(value) { permission = value; },
    getForegroundPermissionsAsync: async () => { calls.push("get"); return permission; },
    requestForegroundPermissionsAsync: async () => { calls.push("request"); permission = options.answer ?? GRANTED; return permission; },
    getCurrentPositionAsync: async (request) => { calls.push(`current ${request.accuracy}`); return (options.position ?? (async () => fix(24.7, 46.7)))(); },
    getLastKnownPositionAsync: async (request) => { calls.push(`last ${request.maxAge}`); return options.lastKnown ?? null; },
    watchPositionImplAsync: async (id, request) => { calls.push(`watch ${id} ${request.accuracy} distance ${request.distanceInterval}`); await options.watch?.(id); },
    removeWatchAsync: async (id) => { calls.push(`remove ${id}`); },
    addListener: (event, listener) => {
      calls.push(`listen ${event}`);
      const key = nextListener++;
      listeners.set(key, { event, listener });
      return { remove: () => { calls.push("unlisten"); listeners.delete(key); } };
    },
  };
  const dispatch = (name: string, payload: any) => { for (const { event, listener } of [...listeners.values()]) if (event === name) listener(payload); };
  const emit = (watchId: number, location: any) => dispatch("Expo.locationChanged", { watchId, location });
  const emitError = (watchId: number, reason: string) => dispatch("Expo.locationError", { watchId, reason });
  let foreground: (() => void) | undefined;
  const geolocation = new Geolocation(native, (listener) => { foreground = listener; });
  return { native, calls, emit, emitError, geolocation, listeners, foreground: () => foreground?.() };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function current(geolocation: Geolocation, options?: any): Promise<{ position?: GeolocationPosition; error?: GeolocationPositionError }> {
  return new Promise((resolve) => geolocation.getCurrentPosition((position) => resolve({ position }), (error) => resolve({ error }), options));
}

describe("getCurrentPosition", () => {
  test("asks for the permission the first time, then calls back with a GeolocationPosition", async () => {
    const { geolocation, calls } = fake();
    const { position } = await current(geolocation);
    expect(position).toBeInstanceOf(GeolocationPosition);
    expect(position?.coords).toBeInstanceOf(GeolocationCoordinates);
    expect(position?.coords.toJSON()).toEqual({ accuracy: 5, latitude: 24.7, longitude: 46.7, altitude: 612, altitudeAccuracy: 3, heading: 90, speed: 1.5 });
    expect(Object.prototype.toString.call(position)).toBe("[object GeolocationPosition]");
    expect(JSON.parse(JSON.stringify(position))).toEqual({ coords: { accuracy: 5, latitude: 24.7, longitude: 46.7, altitude: 612, altitudeAccuracy: 3, heading: 90, speed: 1.5 }, timestamp: position!.timestamp });
    // Balanced by default, the GPS only when asked for.
    expect(calls).toEqual(["get", "request", "current 3"]);
    await current(geolocation, { enableHighAccuracy: true });
    expect(calls.slice(3)).toEqual(["get", "current 4"]);
  });

  test("calls back later, never in the call itself", async () => {
    const { geolocation } = fake({ permission: GRANTED });
    let called = false;
    geolocation.getCurrentPosition(() => { called = true; });
    expect(called).toBe(false);
    await settle();
    expect(called).toBe(true);
  });

  test("what the platform does not know reads as null: iOS's -1, Android's altitude of accuracy 0; a device that does not move has the heading NaN", async () => {
    const ios = fake({ permission: GRANTED, position: async () => fix(1, 2, { heading: -1, speed: -1, altitudeAccuracy: -1 }) });
    expect((await current(ios.geolocation)).position?.coords.toJSON()).toEqual({ accuracy: 5, latitude: 1, longitude: 2, altitude: null, altitudeAccuracy: null, heading: null, speed: null });
    const android = fake({ permission: GRANTED, position: async () => fix(1, 2, { altitude: 0, altitudeAccuracy: 0, heading: 0, speed: 0 }) });
    const still = (await current(android.geolocation)).position!.coords;
    expect([still.altitude, still.altitudeAccuracy, still.speed, Number.isNaN(still.heading)]).toEqual([null, null, 0, true]);
  });

  test("a refused permission is PERMISSION_DENIED, and the system is not asked again once it will not ask", async () => {
    const { geolocation, calls } = fake({ answer: DENIED });
    const { error } = await current(geolocation);
    expect(error).toBeInstanceOf(GeolocationPositionError);
    expect([error?.code, error?.PERMISSION_DENIED, GeolocationPositionError.PERMISSION_DENIED, error?.message]).toEqual([1, 1, 1, "User denied Geolocation"]);
    expect(Object.prototype.toString.call(error)).toBe("[object GeolocationPositionError]");
    await current(geolocation);
    expect(calls).toEqual(["get", "request", "get"]);
  });

  test("the module's refusals: unauthorized is PERMISSION_DENIED, anything else POSITION_UNAVAILABLE", async () => {
    const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
    const unauthorized = fake({ permission: GRANTED, position: async () => { throw coded("ERR_LOCATION_UNAUTHORIZED", "Not authorized to use location services"); } });
    expect((await current(unauthorized.geolocation)).error?.code).toBe(1);
    // iOS's: `DeniedForegroundLocationPermission`.
    const deniedOnIos = fake({ permission: GRANTED, position: async () => { throw coded("ERR_DENIED_FOREGROUND_LOCATION_PERMISSION", "Location permission was denied"); } });
    expect((await current(deniedOnIos.geolocation)).error?.code).toBe(1);
    const off = fake({ permission: GRANTED, position: async () => { throw coded("ERR_CURRENT_LOCATION_IS_UNAVAILABLE", "Current location is unavailable. Make sure that location services are enabled"); } });
    const { error } = await current(off.geolocation);
    expect([error?.code, error?.message]).toEqual([2, "Current location is unavailable. Make sure that location services are enabled"]);
  });

  test("timeout: TIMEOUT when no position comes in time, counted from the permission; 0 answers only from the cache", async () => {
    const never = fake({ permission: GRANTED, position: () => new Promise(() => {}) });
    const started = Date.now();
    const { error } = await current(never.geolocation, { timeout: 40 });
    expect([error?.code, error?.message]).toEqual([3, "Timeout expired"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    const immediate = fake({ permission: GRANTED });
    expect((await current(immediate.geolocation, { timeout: 0 })).error?.code).toBe(3);
    expect(immediate.calls).toEqual(["get"]);
    // Negative and NaN are 0, as the web's unsigned long conversion makes them.
    expect((await current(immediate.geolocation, { timeout: -5 })).error?.code).toBe(3);
  });

  test("maximumAge: the app's last position, or the system's last known one, when it is young enough", async () => {
    const old = fix(9, 9, {}, Date.now() - 60_000);
    const { geolocation, calls } = fake({ permission: GRANTED, lastKnown: old });
    const first = (await current(geolocation)).position!;
    expect(calls).toEqual(["get", "current 3"]);
    const cached = (await current(geolocation, { maximumAge: 10_000, timeout: 0 })).position!;
    expect([cached.coords.latitude, cached.timestamp]).toEqual([first.coords.latitude, first.timestamp]);
    expect(calls).toEqual(["get", "current 3", "get"]);
    // Too old: the system's last known position (a minute old) is asked for, used when the age allows it, else a new one is taken.
    const fresh = fake({ permission: GRANTED, lastKnown: old });
    expect((await current(fresh.geolocation, { maximumAge: 120_000 })).position?.coords.latitude).toBe(9);
    expect(fresh.calls).toEqual(["get", "last 120000", ]);
    const tooOld = fake({ permission: GRANTED, lastKnown: old });
    expect((await current(tooOld.geolocation, { maximumAge: 30_000 })).position?.coords.latitude).toBe(24.7);
    expect(tooOld.calls).toEqual(["get", "last 30000", "current 3"]);
  });

  test("callers at the same time share one question", async () => {
    const { geolocation, calls } = fake();
    await Promise.all([current(geolocation), current(geolocation), current(geolocation)]);
    expect(calls.filter((call) => call === "request")).toHaveLength(1);
  });

  test("a question that fails at once is not kept: the next call asks again", async () => {
    const { geolocation, native } = fake({ permission: GRANTED });
    const working = native.getForegroundPermissionsAsync;
    native.getForegroundPermissionsAsync = (() => { throw new Error("the module went away"); }) as any;
    expect((await current(geolocation)).error?.code).toBe(2);
    native.getForegroundPermissionsAsync = working;
    expect((await current(geolocation)).position).toBeInstanceOf(GeolocationPosition);
  });

  test("the timeout covers the system's last known position too, which may never answer", async () => {
    const { geolocation, native } = fake({ permission: GRANTED });
    native.getLastKnownPositionAsync = () => new Promise(() => {});
    expect((await current(geolocation, { maximumAge: 60_000, timeout: 40 })).error?.code).toBe(3);
  });

  test("timeout 0: the system's cache answers only within the lookup's bound; one that never answers, or answers later, is TIMEOUT, called back once", async () => {
    const { geolocation, native } = fake({ permission: GRANTED });
    let answer!: (location: unknown) => void;
    native.getLastKnownPositionAsync = () => new Promise((resolve) => { answer = resolve; });
    const results: string[] = [];
    geolocation.getCurrentPosition(() => results.push("position"), (error) => results.push(`error ${error.code}`), { maximumAge: 60_000, timeout: 0 });
    await settle(150);
    expect(results).toEqual(["error 3"]);
    answer(fix(1, 1, {}, Date.now() - 1000));
    await settle(10);
    expect(results).toEqual(["error 3"]);
    // A cache that answers within the bound is the answer.
    native.getLastKnownPositionAsync = async () => { await settle(10); return fix(2, 2, {}, Date.now() - 1000); };
    expect((await current(geolocation, { maximumAge: 60_000, timeout: 0 })).position?.coords.latitude).toBe(2);
  });

  test("a timeout that expires during the cache lookup leaves no native request behind", async () => {
    const { geolocation, native, calls } = fake({ permission: GRANTED });
    native.getLastKnownPositionAsync = () => new Promise(() => {});
    expect((await current(geolocation, { maximumAge: 60_000, timeout: 20, enableHighAccuracy: true })).error?.code).toBe(3);
    await settle(150);
    expect(calls.some((call) => call.startsWith("current"))).toBe(false);
  });

  test("a cache lookup that never answers gives way to a current position when there is no timeout", async () => {
    const { geolocation, native, calls } = fake({ permission: GRANTED });
    native.getLastKnownPositionAsync = () => new Promise(() => {});
    expect((await current(geolocation, { maximumAge: 60_000 })).position?.coords.latitude).toBe(24.7);
    expect(calls).toContain("current 3");
  });

  test("the success callback is required, and the classes cannot be constructed, as on the web", () => {
    const { geolocation } = fake();
    expect(() => geolocation.getCurrentPosition(undefined as any)).toThrow("Failed to execute 'getCurrentPosition' on 'Geolocation': parameter 1 is not of type 'Function'.");
    expect(() => geolocation.watchPosition(null as any)).toThrow(TypeError);
    expect(() => geolocation.getCurrentPosition(() => {}, "not a function" as any)).toThrow("parameter 2 is not of type 'Function'.");
    for (const Class of [GeolocationPositionError, GeolocationPosition, GeolocationCoordinates, PermissionStatus] as any[]) expect(() => new Class()).toThrow("Illegal constructor");
    expect([GeolocationPositionError.POSITION_UNAVAILABLE, GeolocationPositionError.TIMEOUT]).toEqual([2, 3]);
  });
});

describe("watchPosition", () => {
  test("calls back with each position of its own watch, and clearWatch stops it and the subscription", async () => {
    const { geolocation, calls, emit, listeners } = fake({ permission: GRANTED });
    const seen: number[] = [];
    const id = geolocation.watchPosition((position) => seen.push(position.coords.latitude));
    // Far from expo-location's own ids, which count from 1.
    expect(id).toBeGreaterThanOrEqual(1_000_000);
    await settle();
    // Every position: distance filter 0 (Android's default would skip all under 50 to 100 m).
    expect(calls).toEqual(["get", "listen Expo.locationChanged", "listen Expo.locationError", `watch ${id} 3 distance 0`]);
    emit(id, fix(1, 1));
    emit(id + 1, fix(2, 2));
    emit(id, fix(3, 3));
    expect(seen).toEqual([1, 3]);
    geolocation.clearWatch(id);
    await settle();
    expect(calls.slice(4)).toEqual([`remove ${id}`, "unlisten", "unlisten"]);
    expect(listeners.size).toBe(0);
    emit(id, fix(4, 4));
    expect(seen).toEqual([1, 3]);
    // A second clear, or one of an id never given, does nothing; an id as a string is the same id.
    geolocation.clearWatch(id);
    geolocation.clearWatch(42);
    expect(calls.slice(7)).toEqual([]);
    const other = geolocation.watchPosition(() => {});
    await settle();
    geolocation.clearWatch(String(other) as any);
    expect(calls.at(-3)).toBe(`remove ${other}`);
  });

  test("two watches share one subscription, which goes with the last", async () => {
    const { geolocation, calls } = fake({ permission: GRANTED });
    const a = geolocation.watchPosition(() => {});
    const b = geolocation.watchPosition(() => {});
    await settle();
    expect(calls.filter((call) => call.startsWith("listen"))).toEqual(["listen Expo.locationChanged", "listen Expo.locationError"]);
    geolocation.clearWatch(a);
    expect(calls.includes("unlisten")).toBe(false);
    geolocation.clearWatch(b);
    expect(calls.slice(-2)).toEqual(["unlisten", "unlisten"]);
  });

  test("a watch its first callback clears, from the app's last position, never starts natively and leaves no subscription", async () => {
    const { geolocation, calls, listeners } = fake({ permission: GRANTED });
    await current(geolocation);
    let calledBack = 0;
    const id = geolocation.watchPosition(() => { calledBack++; geolocation.clearWatch(id); }, null, { maximumAge: 5000 });
    await settle();
    expect(calledBack).toBe(1);
    expect(calls.some((call) => call.startsWith("watch") || call.startsWith("listen"))).toBe(false);
    expect(listeners.size).toBe(0);
  });

  test("the system's last known position comes alongside the native watch; a watch its callback clears stops the native one and leaves no subscription", async () => {
    const { geolocation, calls, listeners } = fake({ permission: GRANTED, lastKnown: fix(5, 5, {}, Date.now() - 1000) });
    let calledBack = 0;
    const id = geolocation.watchPosition(() => { calledBack++; geolocation.clearWatch(id); }, null, { maximumAge: 5000 });
    await settle();
    expect(calledBack).toBe(1);
    expect(calls.filter((call) => call.startsWith("watch") || call.startsWith("remove"))).toEqual([`watch ${id} 3 distance 0`, `remove ${id}`]);
    expect(listeners.size).toBe(0);
  });

  test("iOS's watch error: POSITION_UNAVAILABLE with the reason, the watch going on; a permission taken away ends it with PERMISSION_DENIED", async () => {
    const { geolocation, native, emitError, emit } = fake({ permission: GRANTED });
    const events: string[] = [];
    const id = geolocation.watchPosition((position) => events.push(`position ${position.coords.latitude}`), (error) => events.push(`error ${error.code} ${error.message}`));
    await settle();
    emitError(id, "The operation couldn't be completed. (kCLErrorDomain error 0.)");
    await settle();
    emit(id, fix(1, 1));
    native.permission = DENIED;
    emitError(id, "denied");
    await settle();
    emit(id, fix(2, 2));
    expect(events).toEqual(["error 2 The operation couldn't be completed. (kCLErrorDomain error 0.)", "position 1", "error 1 User denied Geolocation"]);
  });

  test("a callback that throws does not break the watch or the next call; what it threw is reported later as uncaught", async () => {
    const { geolocation, emit } = fake({ permission: GRANTED });
    const reported: unknown[] = [];
    const { setTimeout: realSetTimeout } = globalThis;
    (globalThis as any).setTimeout = (callback: () => void, ms?: number) => realSetTimeout(() => { try { callback(); } catch (error) { reported.push(error); } }, ms);
    try {
      let seen = 0;
      const id = geolocation.watchPosition(() => { seen++; throw new Error(`callback ${seen}`); });
      await settle();
      expect(() => emit(id, fix(1, 1))).not.toThrow();
      emit(id, fix(2, 2));
      geolocation.getCurrentPosition(() => { throw new Error("once"); });
      await settle(5);
      expect([seen, reported.map((error) => (error as Error).message)]).toEqual([2, ["callback 1", "callback 2", "once"]]);
      geolocation.clearWatch(id);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("a watch cleared before the permission answers never starts", async () => {
    const { geolocation, calls } = fake();
    const id = geolocation.watchPosition(() => { throw new Error("no position expected"); });
    geolocation.clearWatch(id);
    await settle();
    expect(calls.some((call) => call.startsWith("watch"))).toBe(false);
  });

  test("a watch cleared while the native watch starts stops it once it exists", async () => {
    let started!: () => void;
    const { geolocation, calls } = fake({ permission: GRANTED, watch: () => new Promise<void>((resolve) => { started = resolve; }) });
    const id = geolocation.watchPosition(() => {});
    await settle();
    geolocation.clearWatch(id);
    started();
    await settle();
    expect(calls.filter((call) => call === `remove ${id}`).length).toBeGreaterThanOrEqual(1);
    expect(calls.at(-1)).toBe(`remove ${id}`);
  });

  test("a refused permission or a native failure is reported once and ends the watch", async () => {
    const denied = fake({ answer: DENIED });
    const errors: number[] = [];
    denied.geolocation.watchPosition(() => {}, (error) => errors.push(error.code));
    await settle();
    expect(errors).toEqual([1]);
    expect(denied.calls.some((call) => call.startsWith("watch"))).toBe(false);
    const failing = fake({ permission: GRANTED, watch: async () => { throw Object.assign(new Error("Location request failed due to unsatisfied device settings"), { code: "ERR_LOCATION_SETTINGS_UNSATISFIED" }); } });
    const failures: [number, string][] = [];
    const id = failing.geolocation.watchPosition(() => {}, (error) => failures.push([error.code, error.message]));
    await settle();
    expect(failures).toEqual([[2, "Location request failed due to unsatisfied device settings"]]);
    expect(failing.calls.slice(-3)).toEqual([`remove ${id}`, "unlisten", "unlisten"]);
  });

  test("a timeout of 0 is one TIMEOUT error, not one per tick; the next position starts the clock again", async () => {
    const { geolocation, emit } = fake({ permission: GRANTED });
    const events: string[] = [];
    const id = geolocation.watchPosition(() => events.push("position"), (error) => events.push(`error ${error.code}`), { timeout: 0 });
    await settle(30);
    expect(events).toEqual(["error 3"]);
    emit(id, fix(1, 1));
    await settle(30);
    expect(events).toEqual(["error 3", "position", "error 3"]);
    geolocation.clearWatch(id);
  });

  test("timeout: an error each time that long passes without a position, the watch going on", async () => {
    const { geolocation, emit } = fake({ permission: GRANTED });
    const events: string[] = [];
    const id = geolocation.watchPosition(() => events.push("position"), (error) => events.push(`error ${error.code}`), { timeout: 30 });
    await settle(45);
    expect(events).toEqual(["error 3"]);
    emit(id, fix(1, 1));
    await settle(15);
    expect(events).toEqual(["error 3", "position"]);
    await settle(30);
    expect(events).toEqual(["error 3", "position", "error 3"]);
    geolocation.clearWatch(id);
    await settle(45);
    expect(events).toHaveLength(3);
  });

  test("a cache lookup that never answers holds the watch up no longer than its timeout: it starts, reports TIMEOUT, and goes on", async () => {
    const { geolocation, native, calls, emit } = fake({ permission: GRANTED });
    native.getLastKnownPositionAsync = () => new Promise(() => {});
    const events: string[] = [];
    const id = geolocation.watchPosition((position) => events.push(`position ${position.coords.latitude}`), (error) => events.push(`error ${error.code}`), { maximumAge: 60_000, timeout: 20 });
    await settle(100);
    expect(calls).toContain(`watch ${id} 3 distance 0`);
    expect(events).toEqual(["error 3"]);
    emit(id, fix(1, 1));
    expect(events).toEqual(["error 3", "position 1"]);
    geolocation.clearWatch(id);
    await settle(40);
    expect(events).toEqual(["error 3", "position 1"]);
    // Without a timeout the watch starts at once too.
    const late = geolocation.watchPosition(() => {}, null, { maximumAge: 60_000 });
    await settle();
    expect(calls).toContain(`watch ${late} 3 distance 0`);
    geolocation.clearWatch(late);
  });

  test("a cached position that comes after a macrotask still reaches a watch with timeout 0, but not one that has had a position, nor one cleared", async () => {
    const slow = (ms: number) => async () => { await settle(ms); return fix(5, 5, {}, Date.now() - 1000); };
    const zero = fake({ permission: GRANTED });
    zero.native.getLastKnownPositionAsync = slow(5);
    const events: string[] = [];
    const id = zero.geolocation.watchPosition((position) => events.push(`position ${position.coords.latitude}`), (error) => events.push(`error ${error.code}`), { maximumAge: 60_000, timeout: 0 });
    // Waited for, not slept for: on a busy machine a timer of a few milliseconds is late.
    for (const deadline = Date.now() + 2000; events.length < 3 && Date.now() < deadline;) await settle(5);
    // A cached position starts the clock again, as any position does: with timeout 0, one more TIMEOUT.
    expect(events).toEqual(["error 3", "position 5", "error 3"]);
    zero.geolocation.clearWatch(id);
    // The watch's own position came first: the cache is not used.
    const fixed = fake({ permission: GRANTED });
    fixed.native.getLastKnownPositionAsync = slow(20);
    const seen: number[] = [];
    const first = fixed.geolocation.watchPosition((position) => seen.push(position.coords.latitude), null, { maximumAge: 60_000 });
    await settle();
    fixed.emit(first, fix(1, 1));
    await settle(40);
    expect(seen).toEqual([1]);
    fixed.geolocation.clearWatch(first);
    // Cleared while the lookup was on its way.
    const cleared = fake({ permission: GRANTED });
    cleared.native.getLastKnownPositionAsync = slow(10);
    const gone = cleared.geolocation.watchPosition(() => { throw new Error("no callback expected"); }, null, { maximumAge: 60_000 });
    await settle();
    cleared.geolocation.clearWatch(gone);
    await settle(30);
  });

  test("maximumAge: a young enough last position is the first one the watch reports", async () => {
    const { geolocation } = fake({ permission: GRANTED, lastKnown: fix(5, 5, {}, Date.now() - 1000) });
    const seen: number[] = [];
    const id = geolocation.watchPosition((position) => seen.push(position.coords.latitude), null, { maximumAge: 5000 });
    await settle();
    expect(seen).toEqual([5]);
    geolocation.clearWatch(id);
  });
});

describe("navigator.permissions", () => {
  test("the system's permission in the web's states", () => {
    expect([permissionState(GRANTED), permissionState(UNDETERMINED), permissionState(DENIED), permissionState({ status: "denied", granted: false, canAskAgain: true })]).toEqual(["granted", "prompt", "denied", "prompt"]);
  });

  test("query answers for geolocation, and its status follows a request and the app coming back to the foreground", async () => {
    const { geolocation, native, foreground } = fake();
    const permissions = new Permissions(() => geolocation);
    const status = await permissions.query({ name: "geolocation" });
    expect([status.name, status.state, Object.prototype.toString.call(status)]).toEqual(["geolocation", "prompt", "[object PermissionStatus]"]);
    const changes: string[] = [];
    status.onchange = () => changes.push(`onchange ${status.state}`);
    const listener = (event: { target: PermissionStatus }) => changes.push(`listener ${event.target.state}`);
    status.addEventListener("change", listener);
    await current(geolocation);
    expect(changes).toEqual(["onchange granted", "listener granted"]);
    // Taken away in the settings while the app was in the background.
    native.permission = DENIED;
    status.removeEventListener("change", listener);
    foreground();
    await settle();
    expect([status.state, changes]).toEqual(["denied", ["onchange granted", "listener granted", "onchange denied"]]);
  });

  test("other names are refused as a browser refuses one it does not know", async () => {
    const permissions = new Permissions(() => undefined);
    await expect(permissions.query({ name: "camera" })).rejects.toThrow("The provided value 'camera' is not a valid enum value of type PermissionName.");
  });
});
