import { setTimeout as delay } from "node:timers/promises";

/** Device settle and idle durations are the only reason the harness waits; every wait is a named argument at its call site. */
export function sleep(ms: number): Promise<void> {
	return delay(ms);
}
