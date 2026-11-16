/**
 * A snapshot of the global object's own string-keyed properties, taken before a fake sets any, so `restore()` can leave `globalThis` as it was found: a property
 * the test added is deleted, one it replaced or deleted is defined again with its old descriptor. Symbol keys are left alone: the runtime keeps its own state under
 * them, and nothing a fake sets is a symbol.
 *
 * Bun runs every test file in one process, so what one file leaves on the global object is what the next file starts with. A fake that sets globals takes a
 * snapshot first and restores it when its test or file is done (`host.ts`).
 */
export type GlobalSnapshot = { restore(): void };

const same = (a: PropertyDescriptor, b: PropertyDescriptor): boolean =>
  Object.is(a.value, b.value) && a.get === b.get && a.set === b.set && a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;

const keys = (): string[] => Reflect.ownKeys(globalThis).filter((key): key is string => typeof key === "string");

export function snapshotGlobals(): GlobalSnapshot {
  const before = new Map<string, PropertyDescriptor>();
  for (const key of keys()) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) before.set(key, descriptor);
  }
  return {
    restore() {
      for (const key of keys()) if (!before.has(key)) Reflect.deleteProperty(globalThis, key);
      for (const [key, descriptor] of before) {
        const now = Object.getOwnPropertyDescriptor(globalThis, key);
        if (now && same(now, descriptor)) continue;
        // A property that cannot be redefined can still be given its old value.
        if (now && !now.configurable) { if ("value" in descriptor && now.writable) Reflect.set(globalThis, key, descriptor.value); continue; }
        Object.defineProperty(globalThis, key, descriptor);
      }
    },
  };
}
