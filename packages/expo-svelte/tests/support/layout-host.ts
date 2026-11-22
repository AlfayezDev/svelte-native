import type { AnimLog } from "./reanimated-stubs.ts";
import { type FabricHost, type FakeNode, flatten } from "./host.ts";

/**
 * The layout half of the fake host, for the animation tests: what a transition reads from the host and what Reanimated does to a commit. Attached to a fake host it adds to the binding
 *
 * - `family` on every node, shared by its clones, as React Native's shadow node family is;
 * - the commit hook: Reanimated's props registry (`__anim.registry`, `reanimated-stubs.ts`) is put over the props of every commit of a tag (`shown`), and the registry of a tag that was
 *   marked removable and is in no tree after the commit is let go (the mount hook);
 * - `getBoundingClientRect(node, includeTransform)`: every node is as wide as 100 and as high as 50 and sits at its index among its siblings times 50; a node with `position: absolute`
 *   is out of the flow, at the top; with `includeTransform` the committed transforms of the chain are applied, from the node up, each scaling and moving everything in it about the
 *   centre of its own layout box (a scroll view moves what is inside it by its scroll offset, `scrolled`, and not itself).
 *
 * The binding is the host's own object, and other tests may share it: `detach()` puts its methods back.
 */
export type LayoutNode = FakeNode & { family: object; shown?: Record<string, unknown> };

export type LayoutOptions = {
  /** Nodes with `position: absolute` take no row. Default true. */
  absolute?: boolean;
  /** `getBoundingClientRect(node, true)` applies the committed transforms. Default true. */
  transforms?: boolean;
};

export type Layout = {
  /** Whether the animation layer was loaded at each layout read the host made. */
  reads: boolean[];
  /** How a layout read tells whether the animation layer is loaded: set by the test once it has the bundle (`fabricStats().animationLoaded`). */
  loaded: () => boolean;
  /** The scroll offset of a scroll view by tag. */
  scrolled: Record<number, { x: number; y: number }>;
  /** The box `[x, y, width, height]` of a node of the committed trees as `getBoundingClientRect(node, false)` answers it. */
  locate(node: LayoutNode): number[] | undefined;
  detach(): void;
};

const ROW = 50;
type Binding = Record<string, unknown> & FabricHost["fake"];
const animLog = () => (globalThis as { __anim?: AnimLog }).__anim;

export function attachLayout(host: Pick<FabricHost, "fake" | "roots" | "calls">, options: LayoutOptions = {}): Layout {
  const absolute = options.absolute ?? true;
  const transforms = options.transforms ?? true;
  const binding = host.fake as unknown as Binding;
  const scrolled: Layout["scrolled"] = {};
  const reads: boolean[] = [];
  const layout: Layout = { reads, loaded: () => false, scrolled, locate: (node) => locate(node)?.rect, detach };

  function locate(target: LayoutNode): { rect: number[]; path: LayoutNode[] } | undefined {
    const search = (nodes: LayoutNode[], path: LayoutNode[]): { rect: number[]; path: LayoutNode[] } | undefined => {
      let index = 0;
      for (const node of nodes) {
        const outOfFlow = absolute && node.props.position === "absolute";
        if (node === target) return { rect: [0, outOfFlow ? 0 : index * ROW, 100, ROW], path: [...path, node] };
        if (!outOfFlow) index++;
        const found = search(node.children as LayoutNode[], [...path, node]);
        if (found) return found;
      }
      return undefined;
    };
    for (const root of Object.values(host.roots)) { const found = search(root as LayoutNode[], []); if (found) return found; }
    return undefined;
  }

  function transformed(path: LayoutNode[], rect: number[]): number[] {
    let [x, y, width, height] = rect as [number, number, number, number];
    for (let at = path.length - 1; at >= 0; at--) {
      const node = path[at] as LayoutNode;
      const own = locate(node)?.rect as [number, number, number, number];
      const centre = { x: own[0] + own[2] / 2, y: own[1] + own[3] / 2 };
      let sx = 1;
      let sy = 1;
      let tx = 0;
      let ty = 0;
      for (const entry of (node.props.transform as Record<string, number>[] | null | undefined) ?? []) {
        sx *= entry.scale ?? entry.scaleX ?? 1;
        sy *= entry.scale ?? entry.scaleY ?? 1;
        tx += entry.translateX ?? 0;
        ty += entry.translateY ?? 0;
      }
      x = centre.x + sx * (x - centre.x) + tx;
      y = centre.y + sy * (y - centre.y) + ty;
      width *= sx;
      height *= sy;
      if (at < path.length - 1 && scrolled[node.tag]) { x -= scrolled[node.tag]?.x ?? 0; y -= scrolled[node.tag]?.y ?? 0; }
    }
    return [x, y, width, height];
  }

  const kept = { createNode: binding.createNode, completeRoot: binding.completeRoot, getBoundingClientRect: binding.getBoundingClientRect };
  binding.createNode = (...args) => {
    const node = kept.createNode.apply(binding, args) as LayoutNode;
    node.family = {};
    return node;
  };
  binding.completeRoot = (root, set) => {
    kept.completeRoot.call(binding, root, set);
    const anim = animLog();
    const registry = anim?.registry;
    for (const node of flatten(set.children) as LayoutNode[]) node.shown = { ...node.props, ...registry?.get(node.tag) };
    const marked = anim?.marked ?? [];
    if (anim) anim.marked = [];
    for (const wrapper of marked as LayoutNode[]) {
      const mounted = Object.values(host.roots).some((children) => flatten(children).some((node) => (node as LayoutNode).family === wrapper.family));
      if (!mounted) registry?.delete(wrapper.tag);
    }
  };
  (binding as Record<string, unknown>).getBoundingClientRect = (node: LayoutNode, includeTransform: boolean) => {
    host.calls.push(`rect ${node.tag} ${includeTransform}`);
    reads.push(layout.loaded());
    const found = locate(node);
    if (!found) return undefined;
    return includeTransform && transforms ? transformed(found.path, found.rect) : found.rect;
  };

  function detach(): void {
    binding.createNode = kept.createNode;
    binding.completeRoot = kept.completeRoot;
    if (kept.getBoundingClientRect === undefined) delete (binding as Record<string, unknown>).getBoundingClientRect;
    else (binding as Record<string, unknown>).getBoundingClientRect = kept.getBoundingClientRect;
  }
  return layout;
}
