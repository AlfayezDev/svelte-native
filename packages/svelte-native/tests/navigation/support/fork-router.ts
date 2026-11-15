import type { NativeNode } from "../../../src/renderer.ts";
import { loadFork } from "../../fork-harness.ts";
import { recordElements, settle } from "../../renderer/support/fork.ts";

/** The router fixture of the fork tests (`navigation/fixtures/fork-router-fixture.svelte`): a home page, `/b`, `/c` and a heavy one, with loaders a test can hold. */
export type Route = { id: string };
export type Router = {
  node: { routes: Route[] };
  entries: { url: URL }[];
  screens: { entry: { key: number; url: URL }; leaving: boolean }[];
  goto(href: string, navigation?: object): void;
  back(): boolean;
  exited(key: number): void;
  load(route: never): void;
  prepare(href: string, navigation?: object): { ready: Promise<boolean>; commit(): void; discard(): void };
};
export type RouterApp = {
  router: Router; release(id: string): void; fail(id: string): void; loadLog(): string[];
  prepareFromEffect(href: string): void; effectState(): { runs: number; prepared?: ReturnType<Router["prepare"]> };
};

/** The fixture mounted on a node tree with a renderer that records every element it creates; `hold` names the routes whose loaders wait for `release`. */
export async function mountRouter(options: { hold?: string[]; async?: boolean } = {}) {
  const log: string[] = [];
  const scope = globalThis as { __forkLog?: string[]; __forkHold?: string[] };
  scope.__forkLog = log;
  scope.__forkHold = options.hold;
  const m = await loadFork("navigation/fixtures/fork-router-fixture.svelte", { async: options.async ?? true });
  const created: NativeNode[] = [];
  recordElements(m, created);
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: {} }) as unknown as RouterApp;
  await settle(m);
  log.length = 0;
  const mounted = created.length;
  const paths = () => app.router.entries.map((entry) => entry.url.pathname);
  const count = (match: (node: NativeNode) => boolean) => { let found = 0; const visit = (node: NativeNode) => { if (match(node)) found++; node.getSnapshot().children.forEach(visit); }; visit(root); return found; };
  const screens = () => count((node) => node.name === "native-screen");
  const pageTexts = () => { const texts: string[] = []; const visit = (node: NativeNode) => { if (node.kind === "text" && /^page \//.test(node.textValue)) texts.push(node.textValue); node.getSnapshot().children.forEach(visit); }; visit(root); return texts; };
  return { m, root, app, log, paths, screens, pageTexts, created, mounted, route: (id: string) => app.router.node.routes.find((route) => route.id === id) as Route };
}
