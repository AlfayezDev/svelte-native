/**
 * `navigator.geolocation` and `navigator.permissions` on the device: the W3C Geolocation API over expo-location's native module (`ExpoLocation`), which the
 * app links by turning on the location capability (`capabilities: { location }` in the config plugin, with expo-location installed). `polyfills.ts` defines both
 * lazily: nothing of this loads until one is read, and in a build without the module `navigator.geolocation` reads as `undefined`, with the reason logged once.
 *
 * What it follows of the web: `getCurrentPosition`, `watchPosition` and `clearWatch` call back asynchronously, with a `GeolocationPosition` or a
 * `GeolocationPositionError` (`PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`); the first use asks for the permission, and `timeout` counts from when it is
 * granted; `maximumAge` answers from the last position, the app's or the system's, when it is young enough (the system's is a native lookup that may not answer: it is
 * waited for at most `CACHE_LOOKUP_MS`, and for a watch at most its `timeout`, and is otherwise not used); `enableHighAccuracy` asks for the GPS. Where it differs: a
 * position the platform cannot place in altitude, heading or speed reports `null` for them (Android reports 0 when it does not know, and it is read as unknown when its
 * accuracy is 0); and the permission is the system's, so a user who denied it can be asked again where the system still allows it (Android asks twice).
 */

type NativeCoords = {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy?: number | null;
  altitudeAccuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
};
type NativeLocation = { coords: NativeCoords; timestamp: number; mocked?: boolean };
type NativePermission = { status: "granted" | "denied" | "undetermined"; granted: boolean; canAskAgain: boolean };
type Subscription = { remove(): void };

/** What this file uses of expo-location's native module: its permission calls, one-off and last known positions, and the watches it reports with `Expo.locationChanged`. */
export type NativeLocationModule = {
  getForegroundPermissionsAsync(): Promise<NativePermission>;
  requestForegroundPermissionsAsync(): Promise<NativePermission>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<NativeLocation>;
  getLastKnownPositionAsync(options: { maxAge?: number }): Promise<NativeLocation | null>;
  watchPositionImplAsync(watchId: number, options: { accuracy: number; distanceInterval: number }): Promise<void>;
  removeWatchAsync(watchId: number): Promise<void>;
  addListener(event: string, listener: (event: Record<string, unknown>) => void): Subscription;
};

/** expo-location's accuracies: `Balanced` (about a city block, network and Wi-Fi) and `High` (the GPS). */
const BALANCED = 3;
const HIGH = 4;
/** The web's default `timeout`: none (2^32 - 1 ms, as `[EnforceRange] unsigned long` allows). */
const NO_TIMEOUT = 0xffffffff;
/**
 * How long the system's last known position is waited for: a cache answers in no time, but it is a native call that may not answer at all, and a position that never
 * comes from it must not hold up a `timeout: 0` answer, a current position or a watch. A `getCurrentPosition` with `timeout: 0` answers from it only within this.
 */
const CACHE_LOOKUP_MS = 100;
/**
 * Watch ids start far from expo-location's own (its JavaScript counts from 1): both share the module's watches and its `Expo.locationChanged` events. expo-location's
 * listener stops a watch it does not know when it hears one of its events, so an app should not watch through both at once.
 */
const FIRST_WATCH = 1_000_000;

const ILLEGAL = Symbol("geolocation internal");

function illegal(name: string): TypeError {
  return new TypeError(`Failed to construct '${name}': Illegal constructor`);
}

/**
 * The web's `GeolocationPositionError`: `code` is `PERMISSION_DENIED` (1), `POSITION_UNAVAILABLE` (2) or `TIMEOUT` (3), constants of the class and, through
 * getters on the prototype, of each error. Not constructible, as on the web.
 */
export class GeolocationPositionError {
  static readonly PERMISSION_DENIED = 1;
  static readonly POSITION_UNAVAILABLE = 2;
  static readonly TIMEOUT = 3;
  get PERMISSION_DENIED(): 1 { return 1; }
  get POSITION_UNAVAILABLE(): 2 { return 2; }
  get TIMEOUT(): 3 { return 3; }
  readonly code: 1 | 2 | 3;
  readonly message: string;

  constructor(key?: symbol, code: 1 | 2 | 3 = 2, message = "") {
    if (key !== ILLEGAL) throw illegal("GeolocationPositionError");
    this.code = code;
    this.message = message;
  }
}
Object.defineProperty(GeolocationPositionError.prototype, Symbol.toStringTag, { value: "GeolocationPositionError", configurable: true });

const positionError = (code: 1 | 2 | 3, message: string) => new GeolocationPositionError(ILLEGAL, code, message);

/** A finite, non-negative number, else `null` (what the platform reports for a value it does not have: -1 on iOS). */
const known = (value: number | null | undefined): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** The web's `GeolocationCoordinates`. */
export class GeolocationCoordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude: number | null;
  readonly altitudeAccuracy: number | null;
  readonly heading: number | null;
  readonly speed: number | null;

  constructor(key?: symbol, coords?: NativeCoords) {
    if (key !== ILLEGAL || coords === undefined) throw illegal("GeolocationCoordinates");
    this.latitude = coords.latitude;
    this.longitude = coords.longitude;
    this.accuracy = known(coords.accuracy) ?? 0;
    // An altitude without an accuracy above 0 is one the platform does not have (Android's 0, iOS's negative accuracy).
    const altitudeAccuracy = known(coords.altitudeAccuracy);
    const hasAltitude = altitudeAccuracy !== null && altitudeAccuracy > 0 && typeof coords.altitude === "number" && Number.isFinite(coords.altitude);
    this.altitude = hasAltitude ? (coords.altitude as number) : null;
    this.altitudeAccuracy = hasAltitude ? altitudeAccuracy : null;
    this.speed = known(coords.speed);
    // The web's heading of a device that does not move is NaN.
    this.heading = this.speed === 0 ? Number.NaN : this.speed === null ? null : known(coords.heading);
  }

  toJSON(): Record<string, number | null> {
    const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = this;
    return { accuracy, latitude, longitude, altitude, altitudeAccuracy, heading, speed };
  }
}
Object.defineProperty(GeolocationCoordinates.prototype, Symbol.toStringTag, { value: "GeolocationCoordinates", configurable: true });

/** The web's `GeolocationPosition`: `coords` and the `timestamp` (milliseconds since the epoch) the platform took it at. */
export class GeolocationPosition {
  readonly coords: GeolocationCoordinates;
  readonly timestamp: number;

  constructor(key?: symbol, location?: NativeLocation) {
    if (key !== ILLEGAL || location === undefined) throw illegal("GeolocationPosition");
    this.coords = new GeolocationCoordinates(ILLEGAL, location.coords);
    this.timestamp = Math.round(location.timestamp);
  }

  toJSON(): { coords: Record<string, number | null>; timestamp: number } {
    return { coords: this.coords.toJSON(), timestamp: this.timestamp };
  }
}
Object.defineProperty(GeolocationPosition.prototype, Symbol.toStringTag, { value: "GeolocationPosition", configurable: true });

type PositionOptions = { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number };
type SuccessCallback = (position: GeolocationPosition) => void;
type ErrorCallback = (error: GeolocationPositionError) => void;

/** `[Clamp] unsigned long`: out of range is clamped, NaN is 0 (and a fraction is cut, where the web rounds it half to even). */
function milliseconds(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.min(NO_TIMEOUT, Math.max(0, Math.trunc(number)));
}

function readOptions(options: PositionOptions | null | undefined) {
  return {
    accuracy: options?.enableHighAccuracy ? HIGH : BALANCED,
    timeout: milliseconds(options?.timeout, NO_TIMEOUT),
    maximumAge: milliseconds(options?.maximumAge, 0),
  };
}

function requireCallbacks(success: unknown, error: unknown, method: string): asserts success is SuccessCallback {
  if (typeof success !== "function") throw new TypeError(`Failed to execute '${method}' on 'Geolocation': parameter 1 is not of type 'Function'.`);
  if (error !== undefined && error !== null && typeof error !== "function") throw new TypeError(`Failed to execute '${method}' on 'Geolocation': parameter 2 is not of type 'Function'.`);
}

/** Calls the app's callback; what it throws is reported as an uncaught error (as the web reports it) instead of breaking the caller's bookkeeping. */
function invoke<Value>(callback: ((value: Value) => void) | null | undefined, value: Value): void {
  if (!callback) return;
  try {
    callback(value);
  } catch (error) {
    setTimeout(() => { throw error; }, 0);
  }
}

/**
 * The code of a rejection of the native module: a permission refused (Android's `ERR_LOCATION_UNAUTHORIZED`, iOS's `ERR_DENIED_FOREGROUND_LOCATION_PERMISSION`),
 * or a position it could not get.
 */
function failure(error: unknown): GeolocationPositionError {
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return /UNAUTHORIZED|DENIED/.test(code) ? positionError(1, message || "User denied Geolocation") : positionError(2, message || "Position unavailable");
}

/** The permission state the web names: `granted`, `denied` once the system will not ask again, else `prompt`. */
export function permissionState(permission: NativePermission): "granted" | "denied" | "prompt" {
  if (permission.granted || permission.status === "granted") return "granted";
  return permission.status === "denied" && !permission.canAskAgain ? "denied" : "prompt";
}

type StatusListener = (event: { type: "change"; target: PermissionStatus }) => void;

/** The web's `PermissionStatus` for `geolocation`: its `state` follows the system's as the app learns of changes (a request, the app coming back to the foreground). */
export class PermissionStatus {
  readonly name = "geolocation";
  state: "granted" | "denied" | "prompt";
  onchange: StatusListener | null = null;
  readonly #listeners = new Set<StatusListener>();

  constructor(key?: symbol, state: "granted" | "denied" | "prompt" = "prompt") {
    if (key !== ILLEGAL) throw illegal("PermissionStatus");
    this.state = state;
  }

  addEventListener(type: string, listener: StatusListener | null): void {
    if (type === "change" && typeof listener === "function") this.#listeners.add(listener);
  }

  removeEventListener(type: string, listener: StatusListener | null): void {
    if (type === "change" && listener) this.#listeners.delete(listener);
  }

  /** @internal Sets the state and tells the listeners when it changed. */
  update(state: "granted" | "denied" | "prompt"): void {
    if (state === this.state) return;
    this.state = state;
    const event = { type: "change" as const, target: this };
    if (typeof this.onchange === "function") invoke(this.onchange, event);
    for (const listener of [...this.#listeners]) invoke(listener, event);
  }
}
Object.defineProperty(PermissionStatus.prototype, Symbol.toStringTag, { value: "PermissionStatus", configurable: true });

type Watch = { success: SuccessCallback; error?: ErrorCallback; options: ReturnType<typeof readOptions>; timer?: ReturnType<typeof setTimeout>; started: boolean };

/** A set of the statuses `query` gave out that does not keep them alive: a page that queries again and again leaks none (a plain set where the runtime has no `WeakRef`). */
class Statuses {
  readonly #refs = new Set<{ deref(): PermissionStatus | undefined }>();

  add(status: PermissionStatus): void {
    this.#refs.add(typeof WeakRef === "function" ? new WeakRef(status) : { deref: () => status });
  }

  update(state: "granted" | "denied" | "prompt"): void {
    for (const ref of [...this.#refs]) {
      const status = ref.deref();
      if (status) status.update(state);
      else this.#refs.delete(ref);
    }
  }
}

/** The web's `Geolocation` over the native module. `onForeground` subscribes to the app returning to the foreground, when a permission changed in the settings shows. */
export class Geolocation {
  readonly #native: NativeLocationModule;
  readonly #watches = new Map<number, Watch>();
  readonly #statuses = new Statuses();
  readonly #onForeground: (listener: () => void) => void;
  #nextWatch = FIRST_WATCH;
  #subscriptions: Subscription[] | null = null;
  #asking: Promise<boolean> | null = null;
  #last: NativeLocation | null = null;
  #foregroundSubscribed = false;

  constructor(native: NativeLocationModule, onForeground: (listener: () => void) => void = () => {}) {
    this.#native = native;
    this.#onForeground = onForeground;
  }

  getCurrentPosition(success: SuccessCallback, error?: ErrorCallback | null, options?: PositionOptions | null): void {
    requireCallbacks(success, error, "getCurrentPosition");
    const read = readOptions(options);
    void this.#once(read).then(
      (position) => invoke(success, position),
      (reason: GeolocationPositionError) => invoke(error, reason),
    );
  }

  watchPosition(success: SuccessCallback, error?: ErrorCallback | null, options?: PositionOptions | null): number {
    requireCallbacks(success, error, "watchPosition");
    const id = this.#nextWatch++;
    const watch: Watch = { success, error: error ?? undefined, options: readOptions(options), started: false };
    this.#watches.set(id, watch);
    void this.#startWatch(id, watch);
    return id;
  }

  clearWatch(watchId: number): void {
    const id = Number(watchId);
    const watch = this.#watches.get(id);
    if (!watch) return;
    this.#watches.delete(id);
    clearTimeout(watch.timer);
    if (watch.started) this.#native.removeWatchAsync(id).catch(() => {});
    if (this.#watches.size === 0) {
      for (const subscription of this.#subscriptions ?? []) subscription.remove();
      this.#subscriptions = null;
    }
  }

  /** `navigator.permissions.query({ name: "geolocation" })`. */
  async query(): Promise<PermissionStatus> {
    const status = new PermissionStatus(ILLEGAL, permissionState(await this.#native.getForegroundPermissionsAsync()));
    this.#statuses.add(status);
    if (!this.#foregroundSubscribed) {
      this.#foregroundSubscribed = true;
      this.#onForeground(() => { this.#refresh().catch(() => {}); });
    }
    return status;
  }

  async #refresh(): Promise<"granted" | "denied" | "prompt"> {
    const state = permissionState(await this.#native.getForegroundPermissionsAsync());
    this.#statuses.update(state);
    return state;
  }

  /** Whether the app may use the location, asking the user when the system still lets it ask. One question at a time, whatever the number of callers. */
  #permitted(): Promise<boolean> {
    if (this.#asking) return this.#asking;
    // Assigned before it can settle: `finally` runs later, so a call that fails at once does not leave a settled question in place for good.
    const asking = this.#ask().finally(() => {
      if (this.#asking === asking) this.#asking = null;
    });
    this.#asking = asking;
    return asking;
  }

  async #ask(): Promise<boolean> {
    let permission = await this.#native.getForegroundPermissionsAsync();
    if (permissionState(permission) === "prompt") permission = await this.#native.requestForegroundPermissionsAsync();
    const state = permissionState(permission);
    this.#statuses.update(state);
    return state === "granted";
  }

  /** The app's last position, when it is no older than `maximumAge`. */
  #young(location: NativeLocation | null, maximumAge: number): location is NativeLocation {
    return maximumAge > 0 && location !== null && Date.now() - location.timestamp <= maximumAge;
  }

  /** The system's last known position, when it is no older than `maximumAge` and the native lookup answers within `bound` ms (later, it is not used). */
  async #lastKnown(maximumAge: number, bound: number): Promise<NativeLocation | null> {
    if (maximumAge <= 0) return null;
    let lookup: Promise<NativeLocation | null>;
    try {
      lookup = this.#native.getLastKnownPositionAsync({ maxAge: maximumAge }).catch(() => null);
    } catch {
      return null;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), bound);
    });
    try {
      const system = await Promise.race([lookup, late]);
      return this.#young(system, maximumAge) ? system : null;
    } finally {
      clearTimeout(timer);
    }
  }

  #remember(location: NativeLocation): GeolocationPosition {
    if (this.#last === null || location.timestamp >= this.#last.timestamp) this.#last = location;
    return new GeolocationPosition(ILLEGAL, location);
  }

  async #once(options: ReturnType<typeof readOptions>): Promise<GeolocationPosition> {
    try {
      if (!(await this.#permitted())) throw positionError(1, "User denied Geolocation");
    } catch (error) {
      throw error instanceof GeolocationPositionError ? error : failure(error);
    }
    if (this.#young(this.#last, options.maximumAge)) return this.#remember(this.#last);
    if (options.timeout === 0) {
      // Only a cached position can answer in no time: the system's, if its lookup answers within CACHE_LOOKUP_MS.
      const system = await this.#lastKnown(options.maximumAge, CACHE_LOOKUP_MS);
      if (system) return this.#remember(system);
      throw positionError(3, "Timeout expired");
    }
    // The timeout covers the system's cache too, and a lookup that does not answer in CACHE_LOOKUP_MS gives way to a current position.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = options.timeout >= NO_TIMEOUT ? null : new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(positionError(3, "Timeout expired")), options.timeout);
    });
    const located = (async () => {
      const system = await this.#lastKnown(options.maximumAge, CACHE_LOOKUP_MS);
      if (system) return this.#remember(system);
      try {
        return this.#remember(await this.#native.getCurrentPositionAsync({ accuracy: options.accuracy }));
      } catch (error) {
        throw failure(error);
      }
    })();
    try {
      return await (expired ? Promise.race([located, expired]) : located);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The module's watch events: a position (`Expo.locationChanged`), and on iOS a watch that failed (`Expo.locationError`; Android reports none once a watch runs). */
  #listen(): void {
    this.#subscriptions ??= [
      this.#native.addListener("Expo.locationChanged", (event) => {
        const id = event.watchId as number;
        const watch = this.#watches.get(id);
        if (!watch) return;
        const position = this.#remember(event.location as NativeLocation);
        this.#arm(id, watch);
        invoke(watch.success, position);
      }),
      this.#native.addListener("Expo.locationError", (event) => {
        const id = event.watchId as number;
        if (!this.#watches.has(id)) return;
        void this.#watchFailed(id, String(event.reason ?? "Position unavailable"));
      }),
    ];
  }

  /** A running watch failed: a permission taken away ends it with `PERMISSION_DENIED`, as on the web; anything else is `POSITION_UNAVAILABLE`, and it goes on. */
  async #watchFailed(id: number, reason: string): Promise<void> {
    const permission = await this.#native.getForegroundPermissionsAsync().catch(() => null);
    const watch = this.#watches.get(id);
    if (!watch) return;
    const state = permission ? permissionState(permission) : "granted";
    if (permission) this.#statuses.update(state);
    if (state === "granted") {
      invoke(watch.error, positionError(2, reason));
      return;
    }
    invoke(watch.error, positionError(1, "User denied Geolocation"));
    this.clearWatch(id);
  }

  /**
   * The watch's `timeout`: once that long passes without a position, one `TIMEOUT` error, and the clock starts again with the next position (a `timeout` of 0
   * reports one error, not one per tick). The watch goes on.
   */
  #arm(id: number, watch: Watch): void {
    clearTimeout(watch.timer);
    if (watch.options.timeout >= NO_TIMEOUT) return;
    watch.timer = setTimeout(() => {
      if (this.#watches.get(id) !== watch) return;
      invoke(watch.error, positionError(3, "Timeout expired"));
    }, watch.options.timeout);
  }

  async #startWatch(id: number, watch: Watch): Promise<void> {
    const current = () => this.#watches.get(id) === watch;
    const fail = (error: GeolocationPositionError) => {
      if (current()) invoke(watch.error, error);
    };
    try {
      if (!(await this.#permitted())) {
        fail(positionError(1, "User denied Geolocation"));
        this.clearWatch(id);
        return;
      }
    } catch (error) {
      fail(failure(error));
      this.clearWatch(id);
      return;
    }
    if (!current()) return;
    // The system's cache is waited for no longer than the watch's timeout: the watch starts, and its clock runs, without it.
    const cached = this.#young(this.#last, watch.options.maximumAge)
      ? this.#last
      : await this.#lastKnown(watch.options.maximumAge, Math.min(watch.options.timeout, CACHE_LOOKUP_MS));
    if (!current()) return;
    if (cached) invoke(watch.success, this.#remember(cached));
    // The first callback may have cleared the watch.
    if (!current()) return;
    this.#listen();
    try {
      watch.started = true;
      // Every position, not one each 50 to 100 m (Android's default for these accuracies; iOS's is 0), as a browser reports them.
      await this.#native.watchPositionImplAsync(id, { accuracy: watch.options.accuracy, distanceInterval: 0 });
      // Cleared while the native watch was starting: stop it now that it exists.
      if (!current()) {
        this.#native.removeWatchAsync(id).catch(() => {});
        return;
      }
      // The timeout counts from when the watch runs: not while Android's dialog that asks to turn on better accuracy is up.
      this.#arm(id, watch);
    } catch (error) {
      fail(failure(error));
      if (current()) this.clearWatch(id);
    }
  }
}
Object.defineProperty(Geolocation.prototype, Symbol.toStringTag, { value: "Geolocation", configurable: true });

/** The web's `Permissions`: `query` answers for `geolocation`; other names are refused as a browser refuses one it does not know. */
export class Permissions {
  readonly #geolocation: () => Geolocation | undefined;

  constructor(geolocation: () => Geolocation | undefined) {
    this.#geolocation = geolocation;
  }

  async query(descriptor: { name: string }): Promise<PermissionStatus> {
    const name = descriptor?.name;
    if (name !== "geolocation") throw new TypeError(`Failed to execute 'query' on 'Permissions': The provided value '${String(name)}' is not a valid enum value of type PermissionName.`);
    const geolocation = this.#geolocation();
    // A build without the location capability can never be given the permission.
    return geolocation ? geolocation.query() : new PermissionStatus(ILLEGAL, "denied");
  }
}
Object.defineProperty(Permissions.prototype, Symbol.toStringTag, { value: "Permissions", configurable: true });

/** Why `navigator.geolocation` is missing from a build: the capability is off. */
export const MISSING_LOCATION =
  "the location capability is not part of this app's build: install expo-location, add `capabilities: { location: \"<why the app uses the location>\" }` to the @alfayez/svelte-native plugin in the app config, and rebuild the native app";

let shared: Geolocation | undefined;

/** `navigator.geolocation`: expo-location's native module, looked up on the first read. Throws in a build without it (the lazy global then reads as `undefined`). */
export function loadGeolocation(): Geolocation {
  if (shared) return shared;
  /* eslint-disable @typescript-eslint/no-require-imports -- required on the first read of `navigator.geolocation` */
  const registry = require("expo-modules-core") as Partial<typeof import("expo-modules-core")>;
  const native = registry.requireOptionalNativeModule?.<NativeLocationModule>("ExpoLocation") ?? null;
  if (native === null) throw new Error(MISSING_LOCATION);
  const onForeground = (listener: () => void) => {
    const appState = (require("react-native/Libraries/AppState/AppState") as { default: { addEventListener(type: "change", listener: (state: string) => void): unknown } }).default;
    appState.addEventListener("change", (state) => { if (state === "active") listener(); });
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  shared = new Geolocation(native, onForeground);
  return shared;
}

/** `navigator.geolocation` when the build has it, without the warning a read of the lazy global logs when it does not. */
export function optionalGeolocation(): Geolocation | undefined {
  try {
    return loadGeolocation();
  } catch {
    return undefined;
  }
}
