import { releaseNow } from "./environment.ts";

/**
 * A query object that frees its cache entry when the effect that made it is torn down, and takes one again if it is used afterwards.
 *
 * SvelteKit's query cache frees an entry (and closes a live query's stream) when the last query object that uses it is collected. Hermes cannot say when
 * that is (no `FinalizationRegistry`; `environment.ts`) and collects late, so the entry is freed when the effect that made the object is torn down
 * instead: a component that is destroyed, or an expression that runs again for another argument. That is a guess about who else holds the object. An
 * object made by a `$derived` and first read in a branch that goes away is read again later by another branch; one that a command or an `await` still
 * holds outlives its screen. So nothing here may break a reader: the object that is handed out is a stand-in for SvelteKit's, and the first time it is
 * used after its entry was freed it makes SvelteKit's object again (the same call, the same arguments; the data is fetched again unless the entry is still
 * there) and, if an effect is running, is owned by that one. Outside an effect (an event handler, a store) nothing owns the object, and collection decides,
 * as on the web.
 */
export function ownedQuery<T extends object>(make: () => T): T {
  let released = false;
  let current = acquire();

  function acquire(): T {
    const proxy = make();
    try {
      $effect.pre(() => () => {
        if (current === proxy) released = true;
        releaseNow(proxy);
      });
    } catch {
      // No effect to own it.
    }
    return proxy;
  }

  /** SvelteKit's object, made again if its entry was freed. */
  function live(): T {
    if (released) {
      released = false;
      current = acquire();
    }
    return current;
  }

  return new Proxy({} as T, {
    get(_target, property) {
      // What identifies the object (the key `updates()` reads, the string tag) is the same for every object made again: reading it takes nothing.
      const reacquire = typeof property === "string" || property === Symbol.asyncIterator || property === Symbol.iterator;
      const object = reacquire ? live() : current;
      const value = Reflect.get(object, property, object);
      // (SvelteKit's methods and getters use private fields: they run on its object, not on this one.)
      return typeof value === "function" ? value.bind(object) : value;
    },
    has: (_target, property) => Reflect.has(current, property),
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
      // (A proxy may only report a property its target lacks as configurable.)
      return descriptor && { ...descriptor, configurable: true };
    },
    ownKeys: () => Reflect.ownKeys(current),
    getPrototypeOf: () => Reflect.getPrototypeOf(current),
  });
}
