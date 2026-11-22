import { windowSize } from "./window-size.ts";

/**
 * `svelte/reactivity/window` on the device (Metro resolves the import here, `withExpoSvelte`): Svelte's reactive window values, read from
 * React Native's `Dimensions`, so a component shared with the web reads `innerWidth.current` on both. What a native app has no counterpart for
 * (the window's position and scroll, the network state) is `undefined`, as Svelte's own values are on the server.
 */
class ReactiveValue<T> {
  readonly #read: () => T;
  constructor(read: () => T) {
    this.#read = read;
  }
  get current(): T {
    return this.#read();
  }
}

const none = () => undefined;

export const innerWidth = new ReactiveValue<number | undefined>(() => windowSize.width);
export const innerHeight = new ReactiveValue<number | undefined>(() => windowSize.height);
export const outerWidth = new ReactiveValue<number | undefined>(() => windowSize.width);
export const outerHeight = new ReactiveValue<number | undefined>(() => windowSize.height);
export const devicePixelRatio = new ReactiveValue<number | undefined>(() => windowSize.scale);
export const scrollX = new ReactiveValue<number | undefined>(none);
export const scrollY = new ReactiveValue<number | undefined>(none);
export const screenLeft = new ReactiveValue<number | undefined>(none);
export const screenTop = new ReactiveValue<number | undefined>(none);
export const online = new ReactiveValue<boolean | undefined>(none);
