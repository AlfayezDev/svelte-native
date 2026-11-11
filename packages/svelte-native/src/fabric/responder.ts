/**
 * A minimal gesture responder system for the React-free host, after React Native's ResponderEventPlugin.
 * One responder at a time: it is negotiated on touch start (capture phase root to target, then bubble target to root),
 * receives move/release/terminate, and can be stolen by an ancestor on move when it allows termination.
 * Nodes answer with `onStartShouldSetResponder(Capture)`, `onMoveShouldSetResponder(Capture)` and `onResponder*`
 * handlers; a node with press handlers gets Pressability's handlers as defaults.
 */
import type { PressEvent, ResponderHandlers } from "./pressability.ts";

type Fn = (event?: PressEvent) => unknown;
export type ResponderTree<Node> = {
  parent(node: Node): Node | null;
  /** The handler an element was given as an attribute, by name; it must return what the user's function returns, as the negotiation reads it. */
  handler(node: Node, name: string): Fn | undefined;
  /** Default responder handlers for nodes that carry press handlers. */
  pressability(node: Node): ResponderHandlers | undefined;
  /**
   * A responder whose `onResponderGrant` answered `true` blocks the native responders: React Native tells its UIManager
   * (`setJSResponder(tag, true)`), and react-native-gesture-handler, which patches that call, makes its recognisers wait. The host wires it to
   * the gesture handler's module once the gesture host is loaded; without it a grant is only JavaScript's.
   */
  blockNativeResponder?(node: Node): void;
  /** The responder that blocked them was released or terminated, or the next one does not block (`UIManager.clearJSResponder()`). */
  releaseNativeResponder?(): void;
  /**
   * Whether the node is still in the tree. A responder that was unmounted while it held the gesture is dropped, with none of its handlers run: React Native resets a
   * `Pressable`'s Pressability when it unmounts, so a link that went away mid-press never presses.
   */
  mounted?(node: Node): boolean;
  /** A responder that was unmounted while it held the gesture was dropped (`mounted` said no): its press state is the host's to clear (Pressability's `reset`). */
  abandon?(node: Node): void;
};

type NativeTouchEvent = { touches?: unknown[]; changedTouches?: { identifier?: number }[]; identifier?: number; target?: unknown; timestamp?: number };
const changedIds = (event: NativeTouchEvent): number[] => event.changedTouches?.length ? event.changedTouches.map((t) => t.identifier ?? 0) : [event.identifier ?? 0];

export function createResponder<Node extends object>(tree: ResponderTree<Node>) {
  let responder: Node | null = null;
  /** The responder's grant blocked the native responders, and they have not been given back. */
  let blocking = false;
  /** Identifiers of the fingers down, as React Native's touch history tracks them: the gesture ends when the last one lifts. */
  const active = new Set<number>();
  /** The responder was unmounted and dropped: the rest of that gesture is nobody's (no new responder is negotiated from its moves), until every finger is up. */
  let orphaned = false;

  const lookup = (node: Node, name: string): Fn | undefined =>
    tree.handler(node, name) ?? (tree.pressability(node) as unknown as Record<string, Fn> | undefined)?.[name];

  const call = (node: Node, name: string, event?: PressEvent): unknown => {
    const handler = lookup(node, name);
    return handler?.(event);
  };

  const ancestors = (from: Node): Node[] => {
    const path: Node[] = [];
    for (let node: Node | null = from; node; node = tree.parent(node)) path.push(node);
    return path; // from `from` up to the root
  };

  const makeEvent = (node: Node, target: Node | null, nativeEvent: object): PressEvent => ({
    nativeEvent: nativeEvent as PressEvent["nativeEvent"],
    target: target ?? node,
    currentTarget: node,
    timeStamp: (nativeEvent as NativeTouchEvent).timestamp,
    persist() {}, stopPropagation() {}, preventDefault() {},
  });

  /** The first node that claims the responder: capture handlers root to `from`, then bubble handlers `from` to root. */
  function negotiate(from: Node, skipSelf: Node | null, kind: "Start" | "Move", event: PressEvent): Node | null {
    const path = ancestors(from);
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i] as Node;
      if (node === skipSelf) continue;
      if (lookup(node, `on${kind}ShouldSetResponderCapture`)?.(makeEvent(node, event.target as Node, event.nativeEvent)) === true) return node;
    }
    for (const node of path) {
      if (node === skipSelf) continue;
      if (lookup(node, `on${kind}ShouldSetResponder`)?.(makeEvent(node, event.target as Node, event.nativeEvent)) === true) return node;
    }
    return null;
  }

  function grant(node: Node, target: Node, nativeEvent: object): void {
    const previous = responder;
    responder = node;
    const event = makeEvent(node, target, nativeEvent);
    if (previous && previous !== node) call(previous, "onResponderTerminate", makeEvent(previous, target, nativeEvent));
    const block = call(node, "onResponderGrant", event) === true;
    if (block) { blocking = true; tree.blockNativeResponder?.(node); }
    else if (blocking) { blocking = false; tree.releaseNativeResponder?.(); }
  }

  /** Drops the responder if it left the tree while it held the gesture; true when it did. */
  function dropIfUnmounted(): boolean {
    const current = responder;
    if (!current || !tree.mounted || tree.mounted(current)) return false;
    responder = null;
    orphaned = true;
    tree.abandon?.(current);
    if (blocking) { blocking = false; tree.releaseNativeResponder?.(); }
    return true;
  }

  function commonAncestor(a: Node, b: Node): Node | null {
    const seen = new Set(ancestors(a));
    for (let node: Node | null = b; node; node = tree.parent(node)) if (seen.has(node)) return node;
    return null;
  }

  function release(nativeEvent: object, name: "onResponderRelease" | "onResponderTerminate"): void {
    const current = responder;
    if (!current) return;
    responder = null;
    call(current, name, makeEvent(current, current, nativeEvent));
    if (blocking) { blocking = false; tree.releaseNativeResponder?.(); }
  }

  return {
    /** The node currently holding the responder, if any. */
    current: (): Node | null => responder,

    /** Routes one `topTouch*` event. Returns true when a responder consumed it. */
    touch(target: Node, topLevelType: string, nativeEvent: object): boolean {
      const event = makeEvent(target, target, nativeEvent);
      switch (topLevelType) {
        case "topTouchStart": {
          const down = changedIds(nativeEvent as NativeTouchEvent);
          // A finger that goes down again without having come up: its end never arrived (native drops the touches of a node that was deleted while it was pressed), and the
          // gesture it belonged to is over. The same finger is the same pointer id, which is how a lost end is told from a second finger.
          if (down.some((id) => active.has(id))) { active.clear(); dropIfUnmounted(); }
          if (active.size === 0 && responder) release(nativeEvent, "onResponderTerminate"); // a lost end event must not wedge the gesture
          orphaned = false;
          for (const id of down) active.add(id);
          if (responder) return true; // a further finger does not take the gesture away
          const next = negotiate(target, null, "Start", event);
          if (next) grant(next, target, nativeEvent);
          return next !== null;
        }
        case "topTouchMove": {
          if (dropIfUnmounted() || orphaned) return false;
          if (!responder) {
            const next = negotiate(target, null, "Move", event);
            if (next) grant(next, target, nativeEvent);
            return next !== null;
          }
          const from = commonAncestor(responder, target);
          if (from) {
            const start = from === responder ? tree.parent(from) : from;
            const candidate = start ? negotiate(start, null, "Move", event) : null;
            if (candidate && candidate !== responder) {
              // Ask the responder, as React Native does; a refusal keeps the gesture where it is.
              const allowed = call(responder, "onResponderTerminationRequest", makeEvent(responder, target, nativeEvent));
              if (allowed !== false) { grant(candidate, target, nativeEvent); return true; }
            }
          }
          call(responder, "onResponderMove", makeEvent(responder, target, nativeEvent));
          return true;
        }
        case "topTouchEnd": {
          for (const id of changedIds(nativeEvent as NativeTouchEvent)) active.delete(id);
          dropIfUnmounted();
          if (active.size === 0) orphaned = false;
          if (!responder) return false;
          if (active.size === 0) release(nativeEvent, "onResponderRelease");
          else call(responder, "onResponderMove", makeEvent(responder, target, nativeEvent));
          return true;
        }
        case "topTouchCancel": {
          active.clear();
          orphaned = false;
          dropIfUnmounted();
          if (!responder) return false;
          release(nativeEvent, "onResponderTerminate");
          return true;
        }
      }
      return false;
    },

    /** Accessibility activation: the nearest enabled pressable's `onPress`. */
    click(target: Node, nativeEvent: object): boolean {
      for (let node: Node | null = target; node; node = tree.parent(node)) {
        const press = tree.pressability(node);
        if (press?.onStartShouldSetResponder()) { press.onClick(makeEvent(node, target, nativeEvent)); return true; }
      }
      return false;
    },
  };
}
