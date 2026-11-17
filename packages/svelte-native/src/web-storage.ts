/**
 * The web's `Storage` (`localStorage`, `sessionStorage`) over a backend that keeps strings. The object behaves as a browser's does: the five members
 * (`getItem`, `setItem`, `removeItem`, `clear`, `key` and the `length` of the keys), keys and values converted with `String()`, a missing argument a
 * `TypeError`, and a key reachable as a property (`storage.theme`, `storage.theme = "dark"`, `delete storage.theme`, `"theme" in storage`,
 * `Object.keys(storage)`) unless it is the name of a member, which then stays the member. The backend is the only thing that differs: MMKV for
 * `localStorage` (`local-storage.ts`), a `Map` for `sessionStorage`.
 *
 * Nothing here reads `this`: a method taken off the object (`const { getItem } = localStorage`) works, where a browser says "Illegal invocation".
 */

/** Where a `Storage` keeps its strings. The `Storage` converts keys and values before it calls the backend, so these are strings. */
export interface StorageBackend {
  readonly length: number;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
  keys(): string[];
}

/** A backend in memory: `sessionStorage` (it is gone with the process, as a tab's is gone with the tab). */
export function memoryBackend(): StorageBackend {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    get: (key) => entries.get(key),
    set: (key, value) => { entries.set(key, value); },
    remove: (key) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    keys: () => [...entries.keys()],
  };
}

/** WebIDL's check of a call's arguments: `localStorage.getItem()` is a `TypeError` that says how many were wanted. */
function requireArguments(member: string, given: number, wanted: number): void {
  if (given < wanted) throw new TypeError(`Failed to execute '${member}' on 'Storage': ${wanted} argument${wanted === 1 ? "" : "s"} required, but only ${given} present.`);
}

/**
 * A `Storage` over [backend]. The returned object is a `Proxy`: a string property is an item unless the name is a member (or comes from
 * `Object.prototype`, as in a browser, where `localStorage.toString` is the function). A write to any string name is an item, a member's included
 * (`localStorage.length = 5` stores the item "length", which a browser does too; `getItem("length")` reads it back and `localStorage.length` stays the count).
 */
export function createStorage(backend: StorageBackend): Storage {
  const members = {
    getItem(...args: [key: string]): string | null {
      requireArguments("getItem", args.length, 1);
      return backend.get(String(args[0])) ?? null;
    },
    setItem(...args: [key: string, value: string]): void {
      requireArguments("setItem", args.length, 2);
      // Both are converted before either is stored, so a value whose `toString` throws leaves the storage as it was.
      const key = String(args[0]);
      backend.set(key, String(args[1]));
    },
    removeItem(...args: [key: string]): void {
      requireArguments("removeItem", args.length, 1);
      backend.remove(String(args[0]));
    },
    clear(): void {
      backend.clear();
    },
    key(...args: [index: number]): string | null {
      requireArguments("key", args.length, 1);
      // WebIDL's `unsigned long`: `>>> 0` is its conversion (a string of digits, a negative number wrapping round, NaN as 0).
      return backend.keys()[Number(args[0]) >>> 0] ?? null;
    },
  };
  // The members live on a prototype of their own, as a browser's live on `Storage.prototype`, so the object's own properties are only what a
  // program put there: its items (in the backend) and its symbols (on the target, ordinary properties). Every trap below then forwards a symbol
  // to the target as it is, and the proxy's invariants hold whatever a symbol's descriptor says (issue #62: a non-configurable symbol left out of
  // `ownKeys` made `Object.keys` and `JSON.stringify` throw).
  const prototype: object = Object.create(Object.prototype, {
    ...Object.fromEntries(Object.entries(members).map(([name, value]) => [name, { value, writable: true, configurable: true }])),
    length: { get: () => backend.length, configurable: true },
    [Symbol.toStringTag]: { value: "Storage", configurable: true },
  });
  const target: object = Object.create(prototype);
  /**
   * Whether a property of the object is a member (or comes from `Object.prototype`) and so hides an item of that name. The live chain, as a browser's
   * named properties read it: a string is never an own property of the target, so this is its prototypes, whatever `Object.setPrototypeOf` made them.
   */
  const hidden = (property: string): boolean => property in target;
  return new Proxy(target, {
    get(self, property, receiver) {
      if (typeof property === "symbol" || hidden(property)) return Reflect.get(self, property, receiver);
      return backend.get(property);
    },
    set(self, property, value, receiver) {
      if (typeof property === "symbol") return Reflect.set(self, property, value, receiver);
      members.setItem(property, value as string);
      return true;
    },
    has: (self, property) => Reflect.has(self, property) || (typeof property === "string" && backend.get(property) !== undefined),
    deleteProperty(self, property) {
      if (typeof property === "symbol") return Reflect.deleteProperty(self, property);
      backend.remove(property);
      return true;
    },
    // The items first, then the target's own keys, which are symbols only: a string never lands on the target (`set` and `defineProperty` store it).
    ownKeys: (self) => [...backend.keys().filter((key) => !hidden(key)), ...Reflect.ownKeys(self)],
    getOwnPropertyDescriptor(self, property) {
      if (typeof property === "symbol") return Reflect.getOwnPropertyDescriptor(self, property);
      if (hidden(property)) return undefined;
      const value = backend.get(property);
      return value === undefined ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty(self, property, descriptor) {
      if (typeof property === "symbol") return Reflect.defineProperty(self, property, descriptor);
      // As for a browser's named setter: only a data descriptor can be an item, and what it stores is its value.
      if (!("value" in descriptor)) return false;
      members.setItem(property, descriptor.value as string);
      return true;
    },
    // A browser's storage cannot be made non-extensible (WebIDL: a legacy platform object's [[PreventExtensions]] is false), so `Object.freeze`
    // and `Object.preventExtensions` throw. Here that also keeps `ownKeys` honest: a non-extensible target must list exactly its own keys, and the
    // items are not on it.
    preventExtensions: () => false,
  }) as Storage;
}
