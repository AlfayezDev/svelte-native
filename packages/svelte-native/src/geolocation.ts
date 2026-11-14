/**
 * `navigator.geolocation` and `navigator.permissions` on the device: the W3C Geolocation API over expo-location's native module (`ExpoLocation`), which the
 * app links by turning on the location capability (`capabilities: { location }` in the config plugin, with expo-location installed). `polyfills.ts` defines both
 * lazily: nothing of this loads until one is read, and in a build without the module `navigator.geolocation` reads as `undefined`, with the reason logged once.
 *
 * What it follows of the web: `getCurrentPosition`, `watchPosition` and `clearWatch` call back asynchronously, with a `GeolocationPosition` or a
 * `GeolocationPositionError` (`PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`); the first use asks for the permission, and `timeout` counts from when it is
 * granted; `maximumAge` answers from the last position, the app's or the system's, when it is young enough; `enableHighAccuracy` asks for the GPS. Where it differs: a
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
  watchPositionImplAsync(watchId: number, options: { accuracy: number }): Promise<void>;
  removeWatchAsync(watchId: number): Promise<void>;
  addListener(event: string, listener: (event: Record<string, unknown>) => void): Subscription;
};

/** expo-location's accuracies: `Balanced` (about a city block, network and Wi-Fi) and `High` (the GPS). */
const BALANCED = 3;
const HIGH = 4;
/** The web's default `timeout`: none (2^32 - 1 ms, as `[EnforceRange] unsigned long` allows). */
const NO_TIMEOUT = 0xffffffff;
/**
 * Watch ids start far from expo-location's own (its JavaScript counts from 1): both share the module's watches and its `Expo.locationChanged` events. expo-location's
 * listener stops a watch it does not know when it hears one of its events, so an app should not watch through both at once.
 */
const FIRST_WATCH = 1_000_000;

const ILLEGAL = Symbol("geolocation internal");

function illegal(name: string): TypeError {
  return new TypeError(`Failed to construct '${name}': Illegal constructor`);
}

/** The web's `GeolocationPositionError`: `code` is `PERMISSION_DENIED` (1), `POSITION_UNAVAILABLE` (2) or `TIMEOUT` (3). Not constructible, as on the web. */
export class GeolocationPositionError {
  static readonly PERMISSION_DENIED = 1;
  static readonly POSITION_UNAVAILABLE = 2;
  static readonly TIMEOUT = 3;
  declare readonly PERMISSION_DENIED: 1;
  declare readonly POSITION_UNAVAILABLE: 2;
  declare readonly TIMEOUT: 3;
  readonly code: 1 | 2 | 3;
  readonly message: string;

  constructor(key?: symbol, code: 1 | 2 | 3 = 2, message = "") {
    if (key !== ILLEGAL) throw illegal("GeolocationPositionError");
    this.code = code;
    this.message = message;
  }
}
for (const [name, value] of [["PERMISSION_DENIED", 1], ["POSITION_UNAVAILABLE", 2], ["TIMEOUT", 3]] as const)
  Object.defineProperty(GeolocationPositionError.prototype, name, { value, enumerable: true });
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

/** `[EnforceRange] unsigned long`, clamped as the browsers do for what is out of range. */
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

function requireCallback(value: unknown, method: string): asserts value is SuccessCallback {
  if (typeof value !== "function") throw new TypeError(`Failed to execute '${method}' on 'Geolocation': parameter 1 is not of type 'Function'.`);
}

/** The code of a rejection of the native module: a permission refused, or a position it could not get. */
function failure(error: unknown): GeolocationPositionError {
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return /UNAUTHORIZED/.test(code) ? positionError(1, message || "User denied Geolocation") : positionError(2, message || "Position unavailable");
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
    this.onchange?.(event);
    for (const listener of [...this.#listeners]) listener(event);
  }
}
Object.defineProperty(PermissionStatus.prototype, Symbol.toStringTag, { value: "PermissionStatus", configurable: true });

type Watch = { success: SuccessCallback; error?: ErrorCallback; options: ReturnType<typeof readOptions>; timer?: ReturnType<typeof setTimeout>; started: boolean };

/** The web's `Geolocation` over the native module. `onForeground` subscribes to the app returning to the foreground, when a permission changed in the settings shows. */
export class Geolocation {
  readonly #native: NativeLocationModule;
  readonly #watches = new Map<number, Watch>();
  readonly #statuses = new Set<PermissionStatus>();
  readonly #onForeground: (listener: () => void) => void;
  #nextWatch = FIRST_WATCH;
  #subscription: Subscription | null = null;
  #asking: Promise<boolean> | null = null;
  #last: NativeLocation | null = null;
  #foregroundSubscribed = false;

  constructor(native: NativeLocationModule, onForeground: (listener: () => void) => void = () => {}) {
    this.#native = native;
    this.#onForeground = onForeground;
  }

  getCurrentPosition(success: SuccessCallback, error?: ErrorCallback | null, options?: PositionOptions | null): void {
    requireCallback(success, "getCurrentPosition");
    const read = readOptions(options);
    void this.#once(read).then(
      (position) => success(position),
      (reason: GeolocationPositionError) => error?.(reason),
    );
  }

  watchPosition(success: SuccessCallback, error?: ErrorCallback | null, options?: PositionOptions | null): number {
    requireCallback(success, "watchPosition");
    const id = this.#nextWatch++;
    const watch: Watch = { success, error: error ?? undefined, options: readOptions(options), started: false };
    this.#watches.set(id, watch);
    void this.#startWatch(id, watch);
    return id;
  }

  clearWatch(id: number): void {
    const watch = this.#watches.get(id);
    if (!watch) return;
    this.#watches.delete(id);
    clearTimeout(watch.timer);
    if (watch.started) this.#native.removeWatchAsync(id).catch(() => {});
    if (this.#watches.size === 0) {
      this.#subscription?.remove();
      this.#subscription = null;
    }
  }

  /** `navigator.permissions.query({ name: "geolocation" })`. */
  async query(): Promise<PermissionStatus> {
    const status = new PermissionStatus(ILLEGAL, permissionState(await this.#native.getForegroundPermissionsAsync()));
    this.#statuses.add(status);
    if (!this.#foregroundSubscribed) {
      this.#foregroundSubscribed = true;
      this.#onForeground(() => void this.#refresh());
    }
    return status;
  }

  async #refresh(): Promise<"granted" | "denied" | "prompt"> {
    const state = permissionState(await this.#native.getForegroundPermissionsAsync());
    for (const status of this.#statuses) status.update(state);
    return state;
  }

  /** Whether the app may use the location, asking the user when the system still lets it ask. One question at a time, whatever the number of callers. */
  #permitted(): Promise<boolean> {
    this.#asking ??= (async () => {
      try {
        let permission = await this.#native.getForegroundPermissionsAsync();
        if (permissionState(permission) === "prompt") permission = await this.#native.requestForegroundPermissionsAsync();
        const state = permissionState(permission);
        for (const status of this.#statuses) status.update(state);
        return state === "granted";
      } finally {
        this.#asking = null;
      }
    })();
    return this.#asking;
  }

  /** The newest of the app's last position and the system's, when it is no older than `maximumAge`. */
  async #cached(maximumAge: number): Promise<NativeLocation | null> {
    if (maximumAge <= 0) return null;
    const young = (location: NativeLocation | null) => location !== null && Date.now() - location.timestamp <= maximumAge;
    if (young(this.#last)) return this.#last;
    const system = await this.#native.getLastKnownPositionAsync({ maxAge: maximumAge }).catch(() => null);
    return young(system) ? system : null;
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
    const cached = await this.#cached(options.maximumAge);
    if (cached) return this.#remember(cached);
    if (options.timeout === 0) throw positionError(3, "Timeout expired");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = options.timeout >= NO_TIMEOUT ? null : new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(positionError(3, "Timeout expired")), options.timeout);
    });
    try {
      const located = this.#native.getCurrentPositionAsync({ accuracy: options.accuracy }).then((location) => this.#remember(location), (error: unknown) => { throw failure(error); });
      return await (expired ? Promise.race([located, expired]) : located);
    } finally {
      clearTimeout(timer);
    }
  }

  #listen(): void {
    this.#subscription ??= this.#native.addListener("Expo.locationChanged", (event) => {
      const watch = this.#watches.get(event.watchId as number);
      if (!watch) return;
      const position = this.#remember(event.location as NativeLocation);
      this.#arm(event.watchId as number, watch);
      watch.success(position);
    });
  }

  /** The watch's `timeout`: an error each time that long passes without a position, the watch going on. */
  #arm(id: number, watch: Watch): void {
    clearTimeout(watch.timer);
    if (watch.options.timeout >= NO_TIMEOUT) return;
    watch.timer = setTimeout(() => {
      if (this.#watches.get(id) !== watch) return;
      watch.error?.(positionError(3, "Timeout expired"));
      this.#arm(id, watch);
    }, watch.options.timeout);
  }

  async #startWatch(id: number, watch: Watch): Promise<void> {
    const fail = (error: GeolocationPositionError) => {
      if (this.#watches.get(id) === watch) watch.error?.(error);
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
    if (this.#watches.get(id) !== watch) return;
    const cached = await this.#cached(watch.options.maximumAge);
    if (this.#watches.get(id) !== watch) return;
    if (cached) watch.success(this.#remember(cached));
    this.#listen();
    this.#arm(id, watch);
    try {
      watch.started = true;
      await this.#native.watchPositionImplAsync(id, { accuracy: watch.options.accuracy });
      // Cleared while the native watch was starting: stop it now that it exists.
      if (this.#watches.get(id) !== watch) this.#native.removeWatchAsync(id).catch(() => {});
    } catch (error) {
      fail(failure(error));
      if (this.#watches.get(id) === watch) this.clearWatch(id);
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
