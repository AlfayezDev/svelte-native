/** An object whose properties resolve on first use: `Easing.inOut(Easing.ease)`, `Gesture.Pan()`. The target loads on the first read of any key. */
export function lazyObject<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => (read() as Record<PropertyKey, unknown>)[key],
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => { const descriptor = Reflect.getOwnPropertyDescriptor(read(), key); return descriptor && { ...descriptor, configurable: true }; },
  });
}
