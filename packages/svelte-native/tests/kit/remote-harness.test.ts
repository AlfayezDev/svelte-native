// The test harness itself (`../remote-harness.ts`): a fixture server that does not start in time is killed, not left running behind the tests; one that dies is reported by how; one at a time.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { remoteHash } from "../../src/remote/transform.ts";
import { fixtureRoot, loadClient, ServerStartTimeout, startServer } from "../remote-harness.ts";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("a fixture server that has not started when the timeout ends is killed", async () => {
  const error = await startServer("dev", { timeoutMs: 50 }).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ServerStartTimeout);
  const pid = (error as ServerStartTimeout).pid as number;
  expect(pid).toBeGreaterThan(0);
  for (let wait = 0; wait < 40 && alive(pid); wait++) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(alive(pid)).toBe(false);
});

test("a server that is killed after it was ready is reported by how it died, not as a refused connection", async () => {
  const server = await startServer("dev");
  try {
    // It has answered a remote call by the time it is handed over: the first test does not pay for the cold start.
    const started = Date.now();
    const response = await fetch(`${server.origin}/_app/remote/${remoteHash(`${fixtureRoot}/src/lib/api.remote.ts`, fixtureRoot)}/buildInfo/`);
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(server.died()).toBeUndefined();
    expect(() => server.assertAlive()).not.toThrow();
    process.kill(server.pid as number, "SIGKILL");
    for (let wait = 0; wait < 100 && !server.died(); wait++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.died()).toMatch(/fixture server \(dev\) died \(signal SIGKILL\)/);
    expect(() => server.assertAlive()).toThrow(/died \(signal SIGKILL\)/);
  } finally {
    server.stop();
  }
}, 120_000);

test("a bundle is made again when esbuild's service was killed with the test process's other children", async () => {
  await loadClient(`export const first = 1;`);
  // What Bun does to every child of the test process when a test times out.
  const children = Bun.spawnSync(["pgrep", "-P", String(process.pid), "-f", "esbuild"]).stdout.toString().split("\n").filter(Boolean);
  expect(children.length).toBeGreaterThan(0);
  for (const pid of children) process.kill(Number(pid), "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const again = await loadClient(`export const second = 2;`);
  expect(again.second).toBe(2);
});

test("only one fixture server runs at a time: a second start waits for the first and says who holds it; a server that was stopped is not reported dead; a lock whose owner is gone is taken over", async () => {
  const first = await startServer("dev");
  try {
    const waiting = await startServer("dev", { timeoutMs: 1200 }).then(() => undefined, (caught: unknown) => caught);
    expect(String(waiting)).toMatch(/another test run \(pid \d+\) holds the fixture server/);
  } finally {
    first.stop();
  }
  // Released when the first one's process has ended; a new one can start.
  const lock = join(fixtureRoot, ".run-lock");
  for (let wait = 0; wait < 100 && existsSync(lock); wait++) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(existsSync(lock)).toBe(false);
  expect(first.died()).toBeUndefined();
  // A run that was killed left its lock behind: the next start takes it over (and, with no time to start, is killed for that and not for the lock).
  const gone = Bun.spawnSync(["true"]);
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), String(gone.pid));
  const takenOver = await startServer("dev", { timeoutMs: 50 }).then(() => undefined, (caught: unknown) => caught);
  expect(takenOver).toBeInstanceOf(ServerStartTimeout);
  for (let wait = 0; wait < 100 && existsSync(lock); wait++) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(existsSync(lock)).toBe(false);
}, 180_000);
