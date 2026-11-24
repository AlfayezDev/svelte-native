/**
 * Window insets: the `SvelteEngine` module's `insets` event and `getInsets()` read, plus the padding math of
 * SafeAreaView and KeyboardAvoidingView. No Svelte in here, so the math is unit tested directly.
 * The payload is specified in `native/svelte-core/SPEC.md` ("Insets and keyboard").
 */
import { EventEmitter, requireOptionalNativeModule } from "expo-modules-core";

export type Edge = "top" | "right" | "bottom" | "left";
export type Frame = { x: number; y: number; width: number; height: number };
/**
 * Values in dp. `keyboardHeight` is how much of the overlay the keyboard covers (the height it is going to have, from the start of its animation); `keyboardAnimating` says it
 * is moving (Android; iOS does not send it); `frame` is the overlay in window coordinates.
 */
export type InsetsEvent = { top: number; right: number; bottom: number; left: number; keyboardHeight: number; keyboardVisible: boolean; keyboardAnimating?: boolean; frame: Frame };
type Emitter = { addListener(name: string, listener: (event: InsetsEvent) => void): { remove(): void } };
type EngineModule = Partial<Emitter> & { getInsets?: () => InsetsEvent | null };

/** Subscribes to insets changes and delivers the current value first when the engine already has one. Returns the unsubscribe function, or null without the engine module. */
export function subscribeInsets(listener: (event: InsetsEvent) => void): (() => void) | null {
  // Android: the engine module reports them; iOS: `SvelteInsets` (native/svelte-core/ios/insets) has the same surface and is not the engine.
  const module = requireOptionalNativeModule<EngineModule>("SvelteEngine") ?? requireOptionalNativeModule<EngineModule>("SvelteInsets");
  if (!module) return null;
  const emitter = (typeof module.addListener === "function" ? module : new EventEmitter(module as never)) as unknown as Emitter;
  const subscription = emitter.addListener("insets", listener);
  const current = module.getInsets?.();
  if (current) listener(current);
  return () => subscription.remove();
}

type StyleValue = unknown;
/** Flattens a React Native style (arrays, falsy entries) into one object; sufficient for the padding keys the components read. */
export function flattenStyle(style: StyleValue): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return typeof style === "object" ? style as Record<string, unknown> : {};
}

const sides: Record<Edge, { own: string; axis: string; key: string }> = {
  top: { own: "paddingTop", axis: "paddingVertical", key: "top" },
  bottom: { own: "paddingBottom", axis: "paddingVertical", key: "bottom" },
  left: { own: "paddingLeft", axis: "paddingHorizontal", key: "left" },
  right: { own: "paddingRight", axis: "paddingHorizontal", key: "right" },
};
const number = (value: unknown): number => typeof value === "number" ? value : 0;

/** `[style, padding]` for a SafeAreaView: each selected edge's padding is the style's own padding for that side plus the inset, like safe-area-context's padding mode. */
export function safeAreaStyle(style: StyleValue, insets: Pick<InsetsEvent, Edge>, edges: readonly Edge[] = ["top", "right", "bottom", "left"]): StyleValue[] {
  const flat = flattenStyle(style);
  const padding: Record<string, number> = {};
  for (const edge of edges) {
    const { own, axis } = sides[edge];
    const base = flat[own] ?? flat[axis] ?? flat.padding;
    padding[own] = number(base) + insets[edge];
  }
  return [style, padding];
}

export type AvoidBehavior = "padding" | "height" | "position" | undefined;

/**
 * How far the keyboard overlaps the view, React Native's `_relativeKeyboardHeight`. `viewY` and `viewHeight` are the view's
 * window frame, `rootHeight` the overlay's height and `keyboardHeight` what the keyboard covers of it, so the keyboard's
 * top edge is `rootHeight - keyboardHeight`. For "height" the view has already shrunk by `previous`, which is added back.
 */
export function keyboardOverlap(args: { viewY: number; viewHeight: number; rootHeight: number; keyboardHeight: number; offset?: number; behavior?: AvoidBehavior; previous?: number }): number {
  if (args.keyboardHeight <= 0) return 0;
  const keyboardY = args.rootHeight - args.keyboardHeight - (args.offset ?? 0);
  const shrunk = args.behavior === "height" ? args.previous ?? 0 : 0;
  return Math.max(shrunk + args.viewY + args.viewHeight - keyboardY, 0);
}

/** The style a KeyboardAvoidingView wraps its content in for `bottom` px of overlap (the outer view of "padding" and "height"; the inner container of "position" uses `{ bottom }`). */
export function avoidingStyle(behavior: AvoidBehavior, style: StyleValue, bottom: number, initialHeight: number): StyleValue {
  if (behavior === "padding") return [style, { paddingBottom: bottom }];
  if (behavior === "height" && bottom > 0) return [style, { height: Math.max(0, initialHeight - bottom), flex: 0 }];
  return style;
}
