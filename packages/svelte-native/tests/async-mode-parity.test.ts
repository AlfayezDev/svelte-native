import { expect, jest, test } from "bun:test";
import type { NativeNode } from "../src/renderer.ts";
import { asyncRun } from "./async-run.ts";
import { fabric, loadFork, type ForkModule } from "./fork-harness.ts";

/**
 * What an app sees of Svelte's async mode, apart from `tick()`: the same component (an `{#if}` chain, a keyed `{#each}` with an `{:else}`, a `{#key}`, snippets, `$effect.pre`, `$effect`
 * with a cleanup, an effect that writes state, `onMount`, `onDestroy`) is driven through the same steps with and without the flag, and the tree and the order of every lifecycle
 * call must be identical after each step. The flag is a runtime switch and the compiled components are the same but for one import (`fork.test.ts`), so this pins the runtime half:
 * the offscreen branches async mode builds for every `{#if}`, `{#each}` and `{#key}` update, and the commit that attaches them.
 */
function shape(node: NativeNode, depth = 0): string {
  const { props, children, text } = node.getSnapshot();
  const own = Object.entries(props).map(([key, value]) => `${key}=${typeof value === "function" ? "fn" : JSON.stringify(value)}`).join(" ");
  return [`${" ".repeat(depth)}${node.kind}:${node.name} ${own} ${node.kind === "text" ? JSON.stringify(text) : ""}`.trimEnd(), ...children.map((child) => shape(child, depth + 1))].join("\n");
}
type Parity = Record<"bump" | "bumpTwice" | "toggle" | "reverse" | "removeFirst" | "replaceAll" | "rename" | "batch", () => void> & { add(id: string): void };
type Step = [name: string, run: (app: Parity) => void];
const steps: Step[] = [
  ["bump", (app) => app.bump()],
  ["bumpTwice", (app) => app.bumpTwice()],
  ["toggle on", (app) => app.toggle()],
  ["reverse", (app) => app.reverse()],
  ["removeFirst", (app) => app.removeFirst()],
  ["add", (app) => app.add("d")],
  ["toggle off", (app) => app.toggle()],
  ["rename + toggle + bump", (app) => app.rename()],
  ["batch", (app) => app.batch()],
  ["replaceAll", (app) => app.replaceAll()],
  ["empty", (app) => { app.removeFirst(); app.removeFirst(); }],
  ["bump after empty", (app) => app.bump()],
];

async function run(async: boolean) {
  const m: ForkModule = await loadFork("parity-fixture.svelte", { async });
  const log: string[] = [];
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { log } }) as unknown as Parity;
  await m.tick();
  const recorded: { step: string; tree: string; log: string[] }[] = [{ step: "mount", tree: shape(root), log: log.splice(0) }];
  for (const [name, step] of steps) {
    step(app);
    await m.tick();
    recorded.push({ step: name, tree: shape(root), log: log.splice(0) });
  }
  // A second `tick()` changes nothing: everything the steps started has finished.
  await m.tick();
  recorded.push({ step: "settled", tree: shape(root), log: log.splice(0) });
  return { recorded, flag: m.asyncFlag() };
}

/** The calls one component (or the root) received, in order: `child a: init`, `child a: pre n=1`, ... */
const ofActor = (log: string[]) => {
  const actors = new Map<string, string[]>();
  for (const entry of log) {
    const actor = entry.slice(0, entry.indexOf(":"));
    actors.set(actor, [...(actors.get(actor) ?? []), entry]);
  }
  return actors;
};

test.skipIf(asyncRun)("with and without async mode, the same steps give the same tree, and every component gets the same lifecycle calls in the same order", async () => {
  const [off, on] = [await run(false), await run(true)];
  expect(off.flag).toBe(false);
  expect(on.flag).toBe(true);
  expect(on.recorded.map((entry) => entry.step)).toEqual(off.recorded.map((entry) => entry.step));
  for (let index = 0; index < off.recorded.length; index++) {
    const [plain, asynchronous] = [off.recorded[index], on.recorded[index]];
    expect(asynchronous?.tree, `tree after ${plain?.step}`).toBe(plain?.tree);
    // The calls are the same ones, once each...
    expect([...(asynchronous?.log ?? [])].sort(), `calls after ${plain?.step}`).toEqual([...(plain?.log ?? [])].sort());
    // ...and each component sees its own in the same order. What differs is the order between components in one flush (below).
    for (const [actor, calls] of ofActor(plain?.log ?? [])) expect(ofActor(asynchronous?.log ?? []).get(actor), `${actor} after ${plain?.step}`).toEqual(calls);
  }
  // The steps did something: the last tree has the rows the steps left, and the lifecycle was busy.
  expect(on.recorded.flatMap((entry) => entry.log).length).toBeGreaterThan(60);
  expect(on.recorded.at(-1)?.tree).toContain("empty");
});

test.skipIf(asyncRun)("what async mode reorders in a flush: a new branch is built (script and $effect.pre) before the parent's $effect.pre, and every replaced branch is taken down after every new one is built", async () => {
  const [off, on] = [await run(false), await run(true)];
  const at = (result: Awaited<ReturnType<typeof run>>, step: string) => result.recorded.find((entry) => entry.step === step)?.log ?? [];
  const order = (log: string[], first: string, second: string) => log.indexOf(first) < log.indexOf(second);
  // `{#if}` switches to a branch while the root's own `$effect.pre` also runs in the flush.
  expect(order(at(off, "bumpTwice"), "root: pre n=3", "child if-else: init")).toBe(true);
  expect(order(at(on, "bumpTwice"), "root: pre n=3", "child if-else: init")).toBe(false);
  // Two independent blocks switch in one flush (`{#if}` and `{#key}`): without the flag each block is built and its old branch taken down in turn.
  expect(order(at(off, "toggle on"), "child if-else: destroy", "child key-true: init")).toBe(true);
  expect(order(at(on, "toggle on"), "child if-else: destroy", "child key-true: init")).toBe(false);
  // Within one block the order is the same in both: the new branch is built first, the old one is taken down next, the new one's effects run after.
  for (const result of [off, on]) {
    const log = at(result, "toggle on");
    expect(order(log, "child if-true: init", "child if-else: cleanup n=3")).toBe(true);
    expect(order(log, "child if-else: destroy", "child if-true: effect n=3")).toBe(true);
  }
});

test.skipIf(asyncRun)("a write reaches the tree after the same number of microtasks with and without async mode, and flushSync applies it at once in both", async () => {
  const turns = async (async: boolean, flush: boolean) => {
    const m: ForkModule = await loadFork("parity-fixture.svelte", { async });
    const log: string[] = [];
    const root = new m.NativeNode("fragment");
    const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { log } }) as unknown as Parity;
    await m.tick();
    const before = shape(root);
    app.toggle();
    app.bump();
    expect(shape(root)).toBe(before);
    if (flush) {
      m.flushSync();
      expect(shape(root)).not.toBe(before);
      return 0;
    }
    let count = 0;
    while (shape(root) === before && count < 20) { await Promise.resolve(); count++; }
    return count;
  };
  expect(await turns(true, true)).toBe(0);
  expect(await turns(false, true)).toBe(0);
  const [plain, asynchronous] = [await turns(false, false), await turns(true, false)];
  expect(plain).toBeGreaterThan(0);
  expect(plain).toBeLessThan(20);
  expect(asynchronous).toBe(plain);
});

test.skipIf(asyncRun)("an update the host sees: a write is in Fabric after the same microtasks with and without async mode", async () => {
  // The host flushes from a microtask queued when its nodes are invalidated (`fabric/host.ts`), so what matters is that the Svelte flush that invalidates them is not later.
  const lag = async (async: boolean) => {
    const m: ForkModule = await loadFork("parity-fixture.svelte", { async });
    const log: string[] = [];
    const app = m.startSurface(77, m.Fixture, { log }) as unknown as Parity;
    await m.tick();
    const completed = () => fabric.calls.filter((call) => call === "completeRoot").length;
    const before = completed();
    app.bump();
    let count = 0;
    while (completed() === before && count < 20) { await Promise.resolve(); count++; }
    return count;
  };
  const [plain, asynchronous] = [await lag(false), await lag(true)];
  expect(plain).toBeGreaterThan(0);
  expect(plain).toBeLessThan(20);
  expect(asynchronous).toBe(plain);
});

test.skipIf(asyncRun)("tick() is a microtask without async mode and waits for a timer or a frame with it: under fake timers it resolves when the timers are advanced", async () => {
  jest.useFakeTimers();
  try {
    const pending = async (async: boolean) => {
      const m: ForkModule = await loadFork("parity-fixture.svelte", { async });
      let done = false;
      void m.tick().then(() => { done = true; });
      for (let turn = 0; turn < 50; turn++) await Promise.resolve();
      return { m, resolved: () => done };
    };
    const plain = await pending(false);
    expect(plain.resolved()).toBe(true);
    // The frame (`requestAnimationFrame`) is React Native's, and a timer stands in for it here: both are the fake ones, so nothing resolves until they move. This is why the four
    // test files that fake timers hang with the flag on (`async-mode-setup.ts`).
    const asynchronous = await pending(true);
    expect(asynchronous.resolved()).toBe(false);
    jest.advanceTimersByTime(20);
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    expect(asynchronous.resolved()).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
