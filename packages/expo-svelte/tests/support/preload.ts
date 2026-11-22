import { afterAll, afterEach, beforeEach } from "bun:test";
import { beginTest, endTest, restoreStrays } from "./host.ts";
import { beginTimers, endTimers } from "./timers.ts";

// Bun (1.3) with a cold transpiler cache gives the first `require` of the library's `app.plugin.js` (an ES module, which Expo's plugin resolver requires when `getConfig` applies
// the plugins) an object without its default export, and keeps that object for every later require of the run: Metro's reading of the app config (push, the optional libraries)
// then cannot see the plugin's options. Imported once here, before any test, it is right for the whole run. Metro runs on Node, where `require` of it is right every time.
await import(new URL("../../app.plugin.js", import.meta.url).href);

/**
 * Preloaded for every test file (`bunfig.toml`): what a fake host installed while a test ran is put back when the test ends, and what is still installed when the run ends is put
 * back then, so a file does not start with what the one before it left on the global object. The fake timers a test set are cleared when it ends (`timers.ts`).
 */
beforeEach(() => { beginTest(); beginTimers(); });
afterEach(() => { endTest(); endTimers(); });
afterAll(restoreStrays);
