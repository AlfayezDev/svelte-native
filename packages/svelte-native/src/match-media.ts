import type * as ReactNative from "react-native";
import { parseMediaQuery, type MediaSource, type MediaState, type ParsedMediaQuery } from "./media-query.ts";
import { Appearance, Dimensions, Platform } from "./platform.ts";

/**
 * `window.matchMedia` on the device (`polyfills.ts` installs a function that loads this file on its first call). A `MediaQueryList` answers `matches` from the system's current state, and tells its
 * listeners when the answer flips. What a query reads is in `media-query.ts`; this file is where the device's state comes from and where the listening happens.
 */

/** A change of a system source, shared by every list that listens: the native listener is added with the first and removed with the last. */
class Source {
  readonly #listeners = new Set<() => void>();
  #stop: (() => void) | undefined;
  readonly #start: () => () => void;

  constructor(start: () => () => void) {
    this.#start = start;
  }

  get active(): boolean {
    return this.#listeners.size > 0;
  }

  add(listener: () => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#stop = this.#start();
    return () => {
      if (!this.#listeners.delete(listener) || this.#listeners.size > 0) return;
      this.#stop?.();
      this.#stop = undefined;
    };
  }

  notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/** React Native's accessibility info, loaded on first use. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
const accessibility = () => (require("react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo") as { default: typeof ReactNative.AccessibilityInfo }).default;

/**
 * An accessibility setting React Native only answers asynchronously (`isReduceMotionEnabled()` is a promise). It is `false` until the system has answered, and then the answer, kept current by the
 * setting's change event while a list listens. It asks when a query that reads it is made (so the first read in a screen has an answer), when a list starts to listen (the setting may have changed
 * while nothing listened), and when a list reads it with nobody listening; an answer that differs is a change, which the lists that listen hear.
 */
class Setting {
  value = false;
  readonly source: Source;
  readonly #ask: () => Promise<boolean>;
  #pending = false;
  /** Counts the events: an answer to a question asked before an event is older than the event. */
  #version = 0;

  constructor(ask: () => Promise<boolean>, listen: (changed: (value: boolean) => void) => { remove(): void }) {
    this.#ask = ask;
    this.source = new Source(() => {
      const subscription = listen((value) => {
        this.#version++;
        this.#set(value);
      });
      this.refresh();
      return () => subscription.remove();
    });
  }

  #set(value: boolean): void {
    if (value === this.value) return;
    this.value = value;
    this.source.notify();
  }

  refresh(): void {
    if (this.#pending) return;
    const version = this.#version;
    let answer: Promise<boolean>;
    try {
      answer = this.#ask();
    } catch {
      return;
    }
    this.#pending = true;
    answer.then(
      (value) => {
        this.#pending = false;
        if (version === this.#version) this.#set(value === true);
      },
      () => { this.#pending = false; },
    );
  }

  read(): boolean {
    if (!this.source.active) this.refresh();
    return this.value;
  }
}

const reducedMotion = new Setting(
  () => accessibility().isReduceMotionEnabled(),
  (changed) => accessibility().addEventListener("reduceMotionChanged", changed),
);

// iOS's Increase Contrast ("darker system colors") and Android's high contrast text are the two contrast settings React Native exposes; they are `prefers-contrast: more`.
const highContrast = new Setting(
  () => (Platform.OS === "android" ? accessibility().isHighTextContrastEnabled() : accessibility().isDarkerSystemColorsEnabled()),
  (changed) => (Platform.OS === "android" ? accessibility().addEventListener("highTextContrastChanged", changed) : accessibility().addEventListener("darkerSystemColorsChanged", changed)),
);

const sources: Record<MediaSource, Source> = {
  window: new Source(() => {
    const subscription = Dimensions.addEventListener("change", () => sources.window.notify());
    return () => subscription.remove();
  }),
  appearance: new Source(() => {
    const subscription = Appearance.addChangeListener(() => sources.appearance.notify());
    return () => subscription.remove();
  }),
  motion: reducedMotion.source,
  contrast: highContrast.source,
};

/** The device's state, read when a query asks for a field and not before. The window's `scale` is `PixelRatio.get()`: that reads it from `Dimensions`. */
const state: MediaState = {
  get width() {
    return Dimensions.get("window").width;
  },
  get height() {
    return Dimensions.get("window").height;
  },
  get scale() {
    return Dimensions.get("window").scale;
  },
  get colorScheme() {
    return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  },
  get reducedMotion() {
    return reducedMotion.read();
  },
  get highContrast() {
    return highContrast.read();
  },
};

type Listener = ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | { handleEvent(event: MediaQueryListEvent): unknown };

/** What a `change` listener is given: `matches` and `media` of the list, as the DOM's event has them. */
export class MediaQueryListEvent {
  readonly type: string;
  readonly matches: boolean;
  readonly media: string;
  readonly timeStamp = Date.now();
  readonly bubbles = false;
  readonly cancelable = false;
  readonly composed = false;
  readonly isTrusted = false;
  defaultPrevented = false;
  cancelBubble = false;
  target: MediaQueryList | null = null;
  currentTarget: MediaQueryList | null = null;

  constructor(type: string, init: { matches?: boolean; media?: string } = {}) {
    this.type = type;
    this.matches = init.matches ?? false;
    this.media = init.media ?? "";
  }

  composedPath(): never[] {
    return [];
  }

  preventDefault(): void {}
  stopPropagation(): void {}
  stopImmediatePropagation(): void {}
}

interface Entry {
  readonly listener: Listener;
  readonly once: boolean;
  /** The one that `onchange` holds. */
  readonly property: boolean;
}

/**
 * The browser's `MediaQueryList`: `matches` is read from the system each time. While the list has a listener (`addEventListener("change", …)`, `addListener`, `onchange`) it listens to the
 * system sources its query reads, and dispatches a `change` event when `matches` differs from what the last event (or the first listener) saw. The last listener to go removes them.
 */
export class MediaQueryList {
  readonly #query: ParsedMediaQuery;
  #entries: Entry[] = [];
  #onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null;
  #last = false;
  #listening: (() => void)[] | undefined;
  readonly #recheck = () => {
    const matches = this.matches;
    if (matches === this.#last) return;
    this.#last = matches;
    this.dispatchEvent(new MediaQueryListEvent("change", { matches, media: this.media }));
  };

  constructor(query: ParsedMediaQuery) {
    this.#query = query;
    // Asked for now, so the answer is there by the time something reads it.
    if (query.sources.has("motion")) reducedMotion.refresh();
    if (query.sources.has("contrast")) highContrast.refresh();
  }

  get media(): string {
    return this.#query.media;
  }

  get matches(): boolean {
    return this.#query.matches(state);
  }

  get onchange(): ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null {
    return this.#onchange;
  }

  set onchange(handler: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null) {
    const callable = typeof handler === "function" ? handler : null;
    this.#onchange = callable;
    const held = this.#entries.findIndex((entry) => entry.property);
    if (callable === null) {
      if (held >= 0) this.#entries.splice(held, 1);
      this.#sleep();
    } else if (held < 0) {
      this.#entries.push({ listener: (event) => this.#onchange?.call(this, event), once: false, property: true });
      this.#wake();
    }
  }

  addEventListener(type: string, listener: Listener | null, options?: boolean | { once?: boolean }): void {
    if (type !== "change" || listener === null || listener === undefined || this.#entries.some((entry) => entry.listener === listener)) return;
    this.#entries.push({ listener, once: typeof options === "object" && options !== null && options.once === true, property: false });
    this.#wake();
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (type !== "change") return;
    const at = this.#entries.findIndex((entry) => entry.listener === listener && !entry.property);
    if (at < 0) return;
    this.#entries.splice(at, 1);
    this.#sleep();
  }

  /** Deprecated, and what older code and libraries still call: `addEventListener("change", listener)`. */
  addListener(listener: Listener | null): void {
    this.addEventListener("change", listener);
  }

  removeListener(listener: Listener | null): void {
    this.removeEventListener("change", listener);
  }

  dispatchEvent(event: MediaQueryListEvent): boolean {
    if (event.type !== "change") return true;
    if (event instanceof MediaQueryListEvent) {
      event.target = this;
      event.currentTarget = this;
    }
    for (const entry of [...this.#entries]) {
      if (!this.#entries.includes(entry)) continue;
      if (entry.once) {
        this.#entries.splice(this.#entries.indexOf(entry), 1);
        this.#sleep();
      }
      try {
        if (typeof entry.listener === "function") entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      } catch (error) {
        // One listener's error is not another's: it is thrown where the host reports uncaught errors.
        setTimeout(() => { throw error; }, 0);
      }
    }
    if (event instanceof MediaQueryListEvent) event.currentTarget = null;
    return true;
  }

  get [Symbol.toStringTag](): string {
    return "MediaQueryList";
  }

  #wake(): void {
    if (this.#listening !== undefined || this.#entries.length === 0) return;
    this.#last = this.matches;
    this.#listening = [...this.#query.sources].map((name) => sources[name].add(this.#recheck));
  }

  #sleep(): void {
    if (this.#listening === undefined || this.#entries.length > 0) return;
    for (const stop of this.#listening) stop();
    this.#listening = undefined;
  }
}

/** `window.matchMedia(query)`: the list for a media query string. */
export function matchMedia(...args: [query: string] | []): MediaQueryList {
  if (args.length === 0) throw new TypeError("Failed to execute 'matchMedia': 1 argument required, but only 0 present.");
  return new MediaQueryList(parseMediaQuery(String(args[0])));
}
