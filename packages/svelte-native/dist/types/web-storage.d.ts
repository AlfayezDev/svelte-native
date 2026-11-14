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
export declare function memoryBackend(): StorageBackend;
/**
 * A `Storage` over [backend]. The returned object is a `Proxy`: a string property is an item unless the name is a member (or comes from
 * `Object.prototype`, as in a browser, where `localStorage.toString` is the function). A write to any string name is an item, a member's included
 * (`localStorage.length = 5` stores the item "length", which a browser does too; `getItem("length")` reads it back and `localStorage.length` stays the count).
 */
export declare function createStorage(backend: StorageBackend): Storage;
