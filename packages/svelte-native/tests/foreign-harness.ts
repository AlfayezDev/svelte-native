import { createHarness as create } from "./foreign/support/harness.ts";

/**
 * The foreign harness lives in `foreign/support/harness.ts`. The svg tests and `refs.test.ts` still import it from here, with their fixtures next to them in `tests/`: delete this
 * file when they move into their own directories and import the harness from there.
 */
export * from "./foreign/support/harness.ts";
export const createHarness: typeof create = (platform, options = {}) => create(platform, { fixtures: import.meta.dirname, ...options });
