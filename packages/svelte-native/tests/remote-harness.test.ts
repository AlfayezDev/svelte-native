// The test harness itself: a fixture server that does not start in time is killed, not left running behind the tests.
import { expect, test } from "bun:test";
import { ServerStartTimeout, startServer } from "./remote-harness.ts";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("a fixture server that has not started when the timeout ends is killed", async () => {
  const error = await startServer("dev", { timeoutMs: 50 }).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ServerStartTimeout);
  const pid = (error as ServerStartTimeout).pid as number;
  expect(pid).toBeGreaterThan(0);
  for (let wait = 0; wait < 40 && alive(pid); wait++) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(alive(pid)).toBe(false);
});
