import { afterAll, afterEach, beforeEach } from "bun:test";
import { beginTest, endTest, restoreStrays } from "./host.ts";
import { beginTimers, endTimers } from "./timers.ts";

/**
 * Preloaded for every test file (`bunfig.toml`): what a fake host installed while a test ran is put back when the test ends, and what is still installed when the run ends is put
 * back then, so a file does not start with what the one before it left on the global object. The fake timers a test set are cleared when it ends (`timers.ts`).
 */
beforeEach(() => { beginTest(); beginTimers(); });
afterEach(() => { endTest(); endTimers(); });
afterAll(restoreStrays);
