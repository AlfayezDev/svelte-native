/**
 * Defines a global that is made when it is first read. Until then the name is an accessor on [scope], so the boot evaluates nothing for it; the first read makes the
 * value with [create] and replaces the accessor by it, an ordinary property from then on. Assigning to the name before or after replaces it, as for any global
 * (a library that installs its own `crypto` over ours wins). A platform that already has the name keeps it: nothing is defined.
 *
 * When [create] throws (the native library behind the global is not in this binary: an update of the JavaScript delivered to an app built before the library was added),
 * the read answers `undefined`, as a platform without the global would, so that `typeof crypto` and `crypto?.randomUUID` are feature probes that work; the reason is
 * logged once with `console.warn`. The accessor stays, and the next read tries again.
 */
export function defineLazyGlobal(scope: object, name: string, create: () => unknown): void {
  if (name in scope) return;
  const replace = (value: unknown): void => {
    Object.defineProperty(scope, name, { value, writable: true, configurable: true, enumerable: false });
  };
  let warned = false;
  Object.defineProperty(scope, name, {
    configurable: true,
    enumerable: false,
    get() {
      let value: unknown;
      try {
        value = create();
      } catch (error) {
        if (!warned) {
          warned = true;
          console.warn(`expo-svelte: \`${name}\` is not available: ${error instanceof Error ? error.message : String(error)}`);
        }
        return undefined;
      }
      replace(value);
      return value;
    },
    set: replace,
  });
}
