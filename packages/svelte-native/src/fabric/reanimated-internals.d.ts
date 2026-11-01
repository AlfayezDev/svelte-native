import type { SharedValue } from "react-native-reanimated";

export function initialUpdaterRun<T>(updater: () => T): T;
export function updateProps(viewDescriptors: { value: readonly unknown[] }, updates: Record<string, unknown>, isAnimatedProps?: boolean): void;
export type Descriptor = { tag: number; shadowNodeWrapper: object };
export interface ViewDescriptorsSet {
  shareableViewDescriptors: SharedValue<Descriptor[]>;
  add(item: Descriptor): void;
  remove(viewTag: number): void;
  has(viewTag: number): boolean;
}
export function makeViewDescriptorsSet(): ViewDescriptorsSet;
export function isAnimated(prop: unknown): boolean;
export function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean;
export function validateAnimatedStyles(styles: unknown): void;
export class CSSManager {
  constructor(info: { shadowNodeWrapper: object; viewTag: number; reactViewName?: string }, componentDisplayName?: string);
  update(style: Record<string, unknown>): void;
  unmountCleanup(): void;
}
export function markNodeAsRemovable(shadowNodeWrapper: object): void;
export function filterCSSAndStyleProperties(style: Record<string, unknown>): [unknown, unknown, unknown, unknown, Record<string, unknown>];
export function hasInlineStyles(style: Record<string, unknown>): boolean;
export function getInlineStyle(style: Record<string, unknown>, isFirstRender: boolean): Record<string, unknown>;
export class InlinePropManager {
  _inlinePropsViewDescriptors: { add(item: { tag: number; shadowNodeWrapper: object }): void } | null;
  attachInlineProps(component: { props: Record<string, unknown> }, viewInfo: { viewTag: number; shadowNodeWrapper: object | null }): void;
  detachInlineProps(): void;
}
export function maybeBuild(config: unknown): unknown;
export function updateLayoutAnimations(viewTag: number, type: number, config?: unknown, isUnmounting?: boolean, sharedTransitionTag?: string): void;
export const LayoutAnimationType: { readonly ENTERING: 1; readonly EXITING: 2; readonly LAYOUT: 3 };
/** What `updateProps` does to the colours of animated props (`fill`, `stroke`, `backgroundColor`, ...) before they reach the native view: a CSS string or an RGBA number becomes the platform's ARGB integer; anything else throws "Invalid color value". */
export function processColorsInProps(props: Record<string, unknown>): void;
/** `useEvent` without the hook: registers a worklet for native events of the given names on a view tag (the gesture detector's UI-thread route). */
export class WorkletEventHandler<Event extends object = object> {
  constructor(worklet: (event: Event) => void, eventNames: string[]);
  updateEventHandler(newWorklet: (event: Event) => void, newEvents: string[]): void;
  registerForEvents(viewTag: number, fallbackEventName?: string): void;
  unregisterFromEvents(viewTag: number): void;
}
