import { afterEach } from "bun:test";
import type { NativeNode } from "../../../src/renderer.ts";
import { snapshotGlobals } from "../../support/globals.ts";
import { fabric, find, loadFork, type ForkModule } from "../../support/fork-harness.ts";

/**
 * What the tests of Svelte's `fork()` on this library's renderer share (`renderer/fork.test.ts`, `navigation/prepare.test.ts`, `compiler/async-mode-fork.test.ts`): waiting for a commit,
 * comparing trees, watching the garbage collector, and the panel fixture mounted on a node tree or on the fake Fabric binding. The harness is `tests/support/fork-harness.ts`.
 */

/** For a file whose tests set globals the fixtures read (`__forkLog`, `__forkHold`, `__forkRows`) and whose loads may add `requestAnimationFrame`: the global object goes back to what it was when the file loaded after each test. */
export function restoreGlobalsAfterEach(): void {
  const world = snapshotGlobals();
  afterEach(() => world.restore());
}

export const settle = async (m: ForkModule) => { m.flushSync(); await Promise.resolve(); await Promise.resolve(); };
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** A tree as one string: kind, name, props (functions by name) and text, so two trees compare by what they show. */
export function shape(node: NativeNode, depth = 0): string {
  const { props, children, text } = node.getSnapshot();
  const own = Object.entries(props).map(([key, value]) => `${key}=${typeof value === "function" ? "fn" : JSON.stringify(value)}`).join(" ");
  return [`${" ".repeat(depth)}${node.kind}:${node.name} ${own} ${node.kind === "text" ? JSON.stringify(text) : ""}`.trimEnd(), ...children.map((child) => shape(child, depth + 1))].join("\n");
}
export const top = (node: NativeNode): NativeNode => { let at = node; while (at.parent) at = at.parent; return at; };
export const reachable = (root: NativeNode, node: NativeNode): boolean => top(node) === root;
/** Whether every object is gone after a garbage collection (a few tries: the engine may need more than one). */
export async function collected(refs: WeakRef<object>[], tries = 20): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    Bun.gc(true);
    await sleep(5);
    if (refs.every((ref) => ref.deref() === undefined)) return true;
  }
  return false;
}

/** Every element the renderer creates from now on goes into `created`: the compiled components use the renderer module itself (`$renderer`), so it is the one to wrap. */
export function recordElements(m: ForkModule, created: NativeNode[]): void {
  const renderer = m.renderer as unknown as { createElement(name: string): NativeNode };
  const create = renderer.createElement;
  renderer.createElement = (name) => { const node = create(name); created.push(node); return node; };
}

export type Panel = { set(value: boolean): void; get(): boolean; bump(): void; countOf(): number };

/** The fixture mounted straight on a node tree, with a renderer that records every element it creates. */
export async function mountPanel(rows = 3) {
  const m = await loadFork("renderer/fixtures/fork-fixture.svelte");
  const created: NativeNode[] = [];
  recordElements(m, created);
  const root = new m.NativeNode("fragment");
  const log: string[] = [];
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { log, rows } }) as unknown as Panel;
  await m.tick();
  const mounted = created.length;
  log.length = 0;
  return { m, root, log, app, created, mounted, nodesSince: () => created.length - mounted };
}

/** The same fixture as a Fabric surface, with the fake `nativeFabricUIManager` of the harness. */
export async function surfacePanel(tag: number, rows = 3) {
  const m = await loadFork("renderer/fixtures/fork-fixture.svelte");
  const log: string[] = [];
  fabric.calls.length = 0;
  const app = m.startSurface(tag, m.Fixture, { log, rows }) as unknown as Panel;
  await settle(m);
  log.length = 0;
  fabric.calls.length = 0;
  const creates = () => fabric.calls.filter((call) => call.startsWith("create")).length;
  const view = (id: string) => find(fabric.roots[tag] ?? [], "RCTView").filter((node) => node.props.testID === id);
  return { m, log, app, creates, view };
}
